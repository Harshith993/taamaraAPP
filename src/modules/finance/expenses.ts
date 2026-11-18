/**
 * Expenses with receipts: tea for the crew, a last-minute auto, extra flowers bought at the market.
 *
 *   recorded (expenses.record: managers and supervisors on their bookings, the accountant, owners)
 *     ──▶ an owner approves or rejects in the approvals inbox
 *     ──▶ if someone paid from their own pocket, the accountant marks it repaid, which records the
 *         payment out in the books
 *
 *  - A receipt (photo or PDF) is required above ₹500 (D34).
 *  - Expenses on a booking count towards its costs once approved.
 *  - Approved and repaid expenses are never deleted (database trigger).
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatINR, todayInIndia, toNumber } from "@/lib/format";
import { parseInput } from "@/lib/validate";
import { recordAudit, type RequestMeta } from "@/modules/audit/audit";
import { MEDIA_SELECT, mediaView } from "@/modules/files/media";
import type { Actor } from "@/modules/identity/actor";
import { assertCan, assertEventAccess, can, eventWhere } from "@/modules/identity/policy";
import { notify, ownerUserIds } from "@/modules/notifications/notify";

export const RECEIPT_REQUIRED_ABOVE = 500;

export const expenseSchema = z.object({
  eventId: z.union([z.literal(""), z.string().uuid()]).optional(),
  categoryId: z.string().uuid("Pick what it was for."),
  description: z.string().trim().min(3, "Say what was bought, e.g. Tea and snacks for the crew.").max(200),
  amount: z.coerce.number({ message: "Enter the amount." }).positive("The amount must be more than ₹0.").max(1_000_000, "That is too large for one expense."),
  spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date."),
  paidVia: z.enum(["COMPANY", "OWN_POCKET"]).default("OWN_POCKET"),
  receiptFileId: z.union([z.literal(""), z.string().uuid()]).optional(),
});
export type ExpenseInput = z.input<typeof expenseSchema>;

export async function submitExpense(db: Db, actor: Actor, input: ExpenseInput, meta: RequestMeta = {}) {
  const v = parseInput(expenseSchema, input);
  if (actor.accountType !== "INTERNAL") throw new ForbiddenError("Only the team records expenses.");
  const scope = assertCan(actor, "expenses.record", "You can't record expenses.");
  if (v.spentOn > todayInIndia()) throw new ValidationError("The date is in the future.", { spentOn: "Pick today or earlier." });
  if (!v.receiptFileId && v.amount > RECEIPT_REQUIRED_ABOVE) throw new ValidationError(`Attach the bill or receipt (needed above ${formatINR(RECEIPT_REQUIRED_ABOVE)}).`, { receiptFileId: "Attach the receipt." });
  return db.$transaction(async (tx) => {
    if (v.eventId) await assertEventAccess(tx, actor, v.eventId, "expenses.record");
    else if (scope !== "ALL") throw new ValidationError("Pick the booking this was for.", { eventId: "Pick the booking." });
    if (!(await tx.expenseCategory.count({ where: { id: v.categoryId } }))) throw new ValidationError("Pick what it was for.", { categoryId: "Pick what it was for." });
    if (v.receiptFileId) {
      const f = await tx.file.findFirst({ where: { id: v.receiptFileId, uploadedById: actor.userId, purpose: "DOCUMENT", status: "READY" }, select: { _count: { select: { expenseReceipts: true } } } });
      if (!f || f._count.expenseReceipts) throw new ValidationError("Attach the receipt and wait for it to finish uploading.", { receiptFileId: "Attach the receipt." });
    }
    const event = v.eventId ? await tx.event.findUniqueOrThrow({ where: { id: v.eventId }, select: { name: true } }) : null;
    const exp = await tx.expense.create({
      data: {
        eventId: v.eventId || null,
        categoryId: v.categoryId,
        description: v.description,
        amount: v.amount,
        spentOn: new Date(`${v.spentOn}T00:00:00Z`),
        paidVia: v.paidVia,
        receiptFileId: v.receiptFileId || null,
        submittedById: actor.userId,
      },
    });
    const summary = `${actor.name} · ${v.description}${event ? ` · ${event.name}` : ""}`;
    await tx.approvalRequest.create({ data: { type: "EXPENSE", entityId: exp.id, eventId: v.eventId || null, amount: v.amount, summary, requestedById: actor.userId } });
    await notify(tx, await ownerUserIds(tx), { type: "approval.requested", title: `Expense to approve: ${formatINR(v.amount)}`, body: summary, link: "/approvals", entityType: "expense", entityId: exp.id }, { exceptUserId: actor.userId });
    await recordAudit(tx, actor, { action: "create", entityType: "expense", entityId: exp.id, summary: `Expense ${formatINR(v.amount)}: ${summary} (${v.paidVia === "OWN_POCKET" ? "own pocket" : "company"})`, financial: true }, meta);
    return { id: exp.id };
  });
}

/** Repays someone who paid from their own pocket; the payment is recorded in the books. */
export async function markRepaid(db: Db, actor: Actor, expenseId: string, input: { method: "CASH" | "UPI" | "BANK"; reference?: string }, meta: RequestMeta = {}) {
  if (actor.accountType !== "INTERNAL") throw new ForbiddenError("Only the office repays expenses.");
  assertCan(actor, "payments.markPaid", "You can't repay expenses.");
  if (input.method !== "CASH" && !input.reference?.trim()) throw new ValidationError("Enter the UPI or bank reference.", { reference: "A reference is needed (not for cash)." });
  return db.$transaction(async (tx) => {
    const e = await tx.expense.findUnique({ where: { id: expenseId }, include: { event: { select: { name: true } } } });
    if (!e) throw new NotFoundError("That expense");
    if (e.status !== "APPROVED" || e.paidVia !== "OWN_POCKET") throw new ConflictError(e.status === "REIMBURSED" ? "Already repaid." : "Only approved expenses paid from someone's own pocket are repaid.");
    const who = e.submittedById ? await tx.user.findUnique({ where: { id: e.submittedById }, select: { name: true } }) : null;
    await tx.payment.create({
      data: {
        direction: "OUT",
        eventId: e.eventId,
        partyType: "OTHER",
        partyName: who?.name ?? "Team member",
        amount: e.amount,
        method: input.method,
        reference: input.reference?.trim() || null,
        paidOn: new Date(`${todayInIndia()}T00:00:00Z`),
        status: "PAID",
        note: `Expense repaid: ${e.description}`,
        requestedById: actor.userId,
        approvedById: e.decidedById,
        approvedAt: e.decidedAt,
        paidById: actor.userId,
      },
    });
    await tx.expense.update({ where: { id: e.id }, data: { status: "REIMBURSED" } });
    await notify(tx, [e.submittedById], { type: "expense.repaid", title: `Repaid: ${formatINR(e.amount)}`, body: e.description, link: "/expenses", entityType: "expense", entityId: e.id }, { exceptUserId: actor.userId });
    await recordAudit(tx, actor, { action: "pay", entityType: "expense", entityId: e.id, summary: `Repaid ${formatINR(e.amount)} to ${who?.name ?? "team member"} for ${e.description}${e.event ? ` (${e.event.name})` : ""}`, financial: true }, meta);
  });
}

/** Expenses this person may see: their own, plus every expense on bookings they reach with expenses.record (all for ALL). */
export async function listExpenses(db: Db, actor: Actor, filter: { eventId?: string; status?: string; mine?: boolean } = {}) {
  if (actor.accountType !== "INTERNAL" || !can(actor, "expenses.record")) return [];
  const scope = actor.grants.get("expenses.record");
  const reach: Prisma.ExpenseWhereInput = filter.mine || scope !== "ALL" ? { OR: [{ submittedById: actor.userId }, ...(filter.mine ? [] : [{ event: eventWhere(actor, "expenses.record") }])] } : {};
  const rows = await db.expense.findMany({
    where: { AND: [reach, filter.eventId ? { eventId: filter.eventId } : {}, filter.status && filter.status !== "all" ? { status: filter.status as "SUBMITTED" } : {}] },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { category: { select: { name: true } }, event: { select: { id: true, name: true } }, receiptFile: { select: MEDIA_SELECT } },
  });
  const people = await db.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.submittedById, r.decidedById]).filter((x): x is string => Boolean(x)))] } }, select: { id: true, name: true } });
  const name = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;
  return rows.map((e) => ({
    id: e.id,
    description: e.description,
    amount: toNumber(e.amount),
    spentOn: e.spentOn,
    paidVia: e.paidVia,
    status: e.status,
    category: e.category.name,
    event: e.event,
    submittedBy: name(e.submittedById),
    mine: e.submittedById === actor.userId,
    decidedBy: name(e.decidedById),
    decisionNote: e.decisionNote,
    receipt: e.receiptFile ? mediaView(actor.userId, e.receiptFile, { original: true }) : null,
  }));
}

export type ExpenseItem = Awaited<ReturnType<typeof listExpenses>>[number];
