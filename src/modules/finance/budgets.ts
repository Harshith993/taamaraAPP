/**
 * Booking budgets: what each kind of cost is expected to be, against what it actually is.
 *
 *   The manager (finance.budget on their booking) writes a draft, line by line, and sends it to the
 *   owners; an owner approves it in the approvals inbox. An approved budget is fixed; changing it
 *   starts a new draft version from it, which is approved the same way.
 *
 * Actuals come from the rest of the system, by expense category group:
 *   VENDOR  agreed amounts of booked vendors        LABOUR  crew pay with approved extras
 *   others  approved expenses in that category
 */
import { z } from "zod";
import type { Db, DbTx } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatINR, toNumber } from "@/lib/format";
import { parseInput } from "@/lib/validate";
import { recordAudit, type RequestMeta } from "@/modules/audit/audit";
import type { Actor } from "@/modules/identity/actor";
import { assertCan, assertEventAccess, can } from "@/modules/identity/policy";
import { notify, ownerUserIds } from "@/modules/notifications/notify";

const round2 = (n: number) => Math.round(n * 100) / 100;

async function guard(tx: DbTx, actor: Actor, eventId: string) {
  if (actor.accountType !== "INTERNAL") throw new ForbiddenError("Budgets are for the team.");
  assertCan(actor, "finance.budget", "You can't work on budgets.");
  await assertEventAccess(tx, actor, eventId, "finance.budget");
  const ev = await tx.event.findUnique({ where: { id: eventId }, select: { name: true, status: true } });
  if (!ev) throw new NotFoundError("That booking");
  return ev;
}

/** The draft to edit: the current draft, or a new version copied from the latest approved one. */
async function draftFor(tx: DbTx, eventId: string) {
  const latest = await tx.budget.findFirst({ where: { eventId }, orderBy: { version: "desc" }, include: { lines: true } });
  if (latest?.status === "DRAFT") return latest;
  return tx.budget.create({
    data: {
      eventId,
      version: (latest?.version ?? 0) + 1,
      lines: latest ? { create: latest.lines.map((l) => ({ categoryId: l.categoryId, description: l.description, estimatedAmount: l.estimatedAmount })) } : undefined,
    },
    include: { lines: true },
  });
}

export const budgetLineSchema = z.object({
  categoryId: z.string().uuid("Pick a kind of cost."),
  description: z.string().trim().max(160).optional(),
  estimatedAmount: z.coerce.number({ message: "Enter the estimate." }).min(0, "Can't be negative.").max(100_000_000),
});

export async function addBudgetLine(db: Db, actor: Actor, eventId: string, input: z.input<typeof budgetLineSchema>, meta: RequestMeta = {}) {
  const v = parseInput(budgetLineSchema, input);
  return db.$transaction(async (tx) => {
    const ev = await guard(tx, actor, eventId);
    if (["CANCELLED", "SETTLED"].includes(ev.status)) throw new ConflictError("This booking is closed.");
    if (!(await tx.expenseCategory.count({ where: { id: v.categoryId } }))) throw new ValidationError("Pick a kind of cost.", { categoryId: "Pick a kind of cost." });
    const draft = await draftFor(tx, eventId);
    if (await tx.approvalRequest.count({ where: { type: "BUDGET", entityId: draft.id, state: "PENDING" } })) throw new ConflictError("This budget is waiting for an owner. Wait for the decision before changing it.");
    await tx.budgetLine.create({ data: { budgetId: draft.id, categoryId: v.categoryId, description: v.description || null, estimatedAmount: v.estimatedAmount } });
    await recordAudit(tx, actor, { action: "update", entityType: "budget", entityId: draft.id, summary: `Budget v${draft.version} (${ev.name}): +${formatINR(v.estimatedAmount)}${v.description ? ` ${v.description}` : ""}`, financial: true }, meta);
    return { budgetId: draft.id };
  });
}

export async function removeBudgetLine(db: Db, actor: Actor, eventId: string, lineId: string, meta: RequestMeta = {}) {
  return db.$transaction(async (tx) => {
    const ev = await guard(tx, actor, eventId);
    const line = await tx.budgetLine.findFirst({ where: { id: lineId, budget: { eventId } }, include: { budget: true } });
    if (!line) throw new NotFoundError("That line");
    if (line.budget.status !== "DRAFT") throw new ConflictError("An approved budget can't be changed; edit it to start a new version.");
    if (await tx.approvalRequest.count({ where: { type: "BUDGET", entityId: line.budgetId, state: "PENDING" } })) throw new ConflictError("This budget is waiting for an owner.");
    await tx.budgetLine.delete({ where: { id: line.id } });
    await recordAudit(tx, actor, { action: "update", entityType: "budget", entityId: line.budgetId, summary: `Budget v${line.budget.version} (${ev.name}): removed ${formatINR(line.estimatedAmount)}${line.description ? ` ${line.description}` : ""}`, financial: true }, meta);
  });
}

/** Starts a new draft from the approved budget, so it can be changed. */
export async function reviseBudget(db: Db, actor: Actor, eventId: string) {
  return db.$transaction(async (tx) => {
    await guard(tx, actor, eventId);
    const d = await draftFor(tx, eventId);
    return { budgetId: d.id, version: d.version };
  });
}

export async function submitBudget(db: Db, actor: Actor, eventId: string, meta: RequestMeta = {}) {
  return db.$transaction(async (tx) => {
    const ev = await guard(tx, actor, eventId);
    const draft = await tx.budget.findFirst({ where: { eventId, status: "DRAFT" }, orderBy: { version: "desc" }, include: { lines: true } });
    if (!draft || draft.lines.length === 0) throw new ConflictError("Add at least one line first.");
    if (await tx.approvalRequest.count({ where: { type: "BUDGET", entityId: draft.id, state: "PENDING" } })) throw new ConflictError("Already sent to the owners.");
    const total = round2(draft.lines.reduce((s, l) => s + toNumber(l.estimatedAmount), 0));
    await tx.approvalRequest.create({ data: { type: "BUDGET", entityId: draft.id, eventId, amount: total, summary: `${ev.name} · budget v${draft.version}`, requestedById: actor.userId } });
    await notify(tx, await ownerUserIds(tx), { type: "approval.requested", title: `Budget to approve: ${formatINR(total)}`, body: `${ev.name} · v${draft.version}`, link: "/approvals", entityType: "budget", entityId: draft.id }, { exceptUserId: actor.userId });
    await recordAudit(tx, actor, { action: "submit", entityType: "budget", entityId: draft.id, summary: `Sent budget v${draft.version} for ${ev.name} (${formatINR(total)}) to the owners`, financial: true }, meta);
  });
}

/** Called from the approvals inbox. */
export async function decideBudget(tx: DbTx, actorId: string, budgetId: string, approve: boolean, now: Date) {
  const b = await tx.budget.findUnique({ where: { id: budgetId }, include: { event: { select: { name: true } }, lines: { select: { estimatedAmount: true } } } });
  if (!b) throw new NotFoundError("That budget");
  if (b.status !== "DRAFT") throw new ConflictError("This budget was already decided.");
  if (approve) await tx.budget.update({ where: { id: b.id }, data: { status: "APPROVED", approvedById: actorId, approvedAt: now } });
  const total = b.lines.reduce((s, l) => s + toNumber(l.estimatedAmount), 0);
  return `${approve ? "Approved" : "Sent back"} budget v${b.version} for ${b.event.name} (${formatINR(total)})`;
}

/** Estimate vs actual, by kind of cost: the approved budget, plus the draft being worked on. */
export async function budgetView(db: Db, actor: Actor, eventId: string) {
  if (actor.accountType !== "INTERNAL" || !can(actor, "finance.budget")) return null;
  await assertEventAccess(db, actor, eventId, "finance.budget");
  const [budgets, categories, vendorAgreed, crew, expenses] = await Promise.all([
    db.budget.findMany({ where: { eventId }, orderBy: { version: "desc" }, take: 2, include: { lines: { include: { category: { select: { id: true, name: true, group: true } } } } } }),
    db.expenseCategory.findMany({ orderBy: { sortOrder: "asc" } }),
    db.vendorAssignment.aggregate({ where: { eventId, status: { notIn: ["DECLINED", "CANCELLED", "INVITED", "QUOTED"] } }, _sum: { agreedAmount: true } }),
    db.crewAssignment.findMany({ where: { eventId, status: { in: ["CONFIRMED", "COMPLETED", "NO_SHOW"] } }, select: { agreedPay: true, adjustments: { where: { state: "APPROVED" }, select: { type: true, amount: true } } } }),
    db.expense.groupBy({ by: ["categoryId"], where: { eventId, status: { in: ["APPROVED", "REIMBURSED"] } }, _sum: { amount: true } }),
  ]);
  const approved = budgets.find((b) => b.status === "APPROVED") ?? null;
  const draft = budgets[0]?.status === "DRAFT" ? budgets[0] : null;
  const pending = draft ? (await db.approvalRequest.count({ where: { type: "BUDGET", entityId: draft.id, state: "PENDING" } })) > 0 : false;
  const crewTotal = crew.reduce((s, a) => s + toNumber(a.agreedPay) + a.adjustments.reduce((x, j) => x + (j.type === "EXTRA" ? 1 : -1) * toNumber(j.amount), 0), 0);
  const vendorTotal = toNumber(vendorAgreed._sum.agreedAmount);
  const actualFor = (c: { id: string; group: string }) =>
    round2((c.group === "VENDOR" ? vendorTotal : c.group === "LABOUR" ? crewTotal : 0) + toNumber(expenses.find((e) => e.categoryId === c.id)?._sum.amount));
  const shape = (b: (typeof budgets)[number] | null) =>
    b
      ? {
          id: b.id,
          version: b.version,
          status: b.status,
          approvedAt: b.approvedAt,
          lines: b.lines.map((l) => ({ id: l.id, category: l.category.name, description: l.description, amount: toNumber(l.estimatedAmount) })),
          total: round2(b.lines.reduce((s, l) => s + toNumber(l.estimatedAmount), 0)),
        }
      : null;
  const base = approved ?? draft;
  const rows = categories
    .map((c) => {
      const estimate = round2((base?.lines ?? []).filter((l) => l.categoryId === c.id).reduce((s, l) => s + toNumber(l.estimatedAmount), 0));
      const actual = actualFor(c);
      return { category: c.name, estimate, actual, over: estimate > 0 && actual > estimate };
    })
    .filter((r) => r.estimate > 0 || r.actual > 0);
  return {
    approved: shape(approved),
    draft: shape(draft),
    pending,
    rows,
    estimateTotal: round2(rows.reduce((s, r) => s + r.estimate, 0)),
    actualTotal: round2(rows.reduce((s, r) => s + r.actual, 0)),
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
  };
}
