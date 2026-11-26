/**
 * Cash advances (D57, D62): company cash carried by a manager or supervisor for spending on site.
 *
 *   a host gives it (approved at once) ─────────────────────────────┐
 *   the accountant prepares it ──▶ PENDING_APPROVAL ──a host──▶ APPROVED
 *                                                                    │ handed over (cash, UPI…)
 *                                                                    ▼
 *                                                                  GIVEN ──the holder records spending
 *                                                                    │     as expenses, each with a bill
 *                                                                    │     (expenses.ts, paid via CASH_ADVANCE)
 *                                                                    ▼
 *                       the rest is returned (or a host settles a shortfall) ──▶ CLOSED
 *
 *  - Balance = amount − expenses recorded against it (waiting or approved; rejected ones don't count)
 *    − cash returned. Spending can't go over the balance.
 *  - Like payments: never deleted, voided with a reason (database triggers), locked when the booking
 *    is settled, and an open advance stops a booking from being settled.
 *  - An advance is not a cost. The expenses recorded against it are the costs, once approved.
 *  - Giving and preparing: payments.prepare (hosts, the accountant); approving: approvals.decide (hosts);
 *    handing over and closing: payments.markPaid. Holders see their own (cashAdvanceWhere).
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { inSequence, type Db, type DbTx } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatINR, todayInIndia, toNumber } from "@/lib/format";
import { parseInput } from "@/lib/validate";
import { recordAudit, type RequestMeta } from "@/modules/audit/audit";
import { MEDIA_SELECT, mediaView } from "@/modules/files/media";
import type { Actor } from "@/modules/identity/actor";
import { assertCan, can, cashAdvanceWhere } from "@/modules/identity/policy";
import { assertBookingOpen } from "@/modules/events/lock";
import { notify, ownerUserIds } from "@/modules/notifications/notify";

const round2 = (n: number) => Math.round(n * 100) / 100;
const TOLERANCE = 0.5;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
const METHODS = ["CASH", "UPI", "BANK"] as const;
/** Advances whose cash may still be with the holder (or is about to be). */
export const OPEN_ADVANCE_STATUSES = ["PENDING_APPROVAL", "APPROVED", "GIVEN"] as const;
/** Roles that carry company cash (D57). */
const HOLDER_ROLES = ["EVENT_MANAGER", "SUPERVISOR"];

/** Spent, waiting and left on one advance, inside a transaction (lock the row first when changing it). */
export async function advanceBalance(tx: DbTx, advanceId: string) {
  const [a, spent] = await inSequence([
    tx.cashAdvance.findUniqueOrThrow({ where: { id: advanceId }, select: { amount: true, returnedAmount: true } }),
    tx.expense.groupBy({ by: ["status"], where: { cashAdvanceId: advanceId, status: { not: "REJECTED" } }, _sum: { amount: true } }),
  ]);
  const waiting = toNumber(spent.find((s) => s.status === "SUBMITTED")?._sum.amount);
  const approved = round2(spent.filter((s) => s.status !== "SUBMITTED").reduce((t, s) => t + toNumber(s._sum.amount), 0));
  const amount = toNumber(a.amount);
  const returned = toNumber(a.returnedAmount);
  return { amount, approved, waiting, returned, left: round2(amount - approved - waiting - returned) };
}

/** Holds the advance's row until the transaction ends, so two spends can't both use the same balance. */
export async function lockAdvance(tx: DbTx, advanceId: string) {
  await tx.$queryRaw`SELECT "id" FROM "cash_advances" WHERE "id" = ${advanceId} FOR UPDATE`;
}

// ───────────────────────────── Giving ─────────────────────────────

export const advanceSchema = z.object({
  holderId: z.string().uuid("Pick who carries the cash."),
  eventId: z.union([z.literal(""), z.string().uuid()]).optional(),
  amount: z.coerce.number({ message: "Enter the amount." }).positive("The amount must be more than ₹0.").max(500_000, "That is too much cash for one advance."),
  purpose: z.string().trim().min(3, "Say what it is for, e.g. Flowers and tea on the wedding day.").max(200),
  method: z.enum(METHODS).default("CASH"),
  /** Hosts only: the cash is handed over now, so the advance is given at once. */
  handedOver: z.boolean().default(false),
  givenOn: date.optional(),
  reference: z.string().trim().max(80).optional(),
});
export type AdvanceInput = z.input<typeof advanceSchema>;

/** A host gives an advance (approved at once), or the accountant prepares one for a host to approve. */
export async function giveAdvance(db: Db, actor: Actor, input: AdvanceInput, meta: RequestMeta = {}) {
  if (actor.accountType !== "INTERNAL") throw new ForbiddenError();
  assertCan(actor, "payments.prepare", "Only hosts and the accountant give cash advances.");
  const v = parseInput(advanceSchema, input);
  const host = can(actor, "approvals.decide");
  if (v.handedOver && !host) throw new ForbiddenError("A host approves the advance before it is handed over.");
  const givenOn = v.givenOn ?? todayInIndia();
  if (v.handedOver && givenOn > todayInIndia()) throw new ValidationError("The date is in the future.", { givenOn: "Pick today or earlier." });
  if (v.handedOver && v.method !== "CASH" && !v.reference) throw new ValidationError("Enter the UPI or bank reference.", { reference: "A reference is needed (not for cash)." });
  return db.$transaction(async (tx) => {
    const holder = await tx.user.findFirst({
      where: { id: v.holderId, status: "ACTIVE", accountType: "INTERNAL", roles: { some: { role: { key: { in: HOLDER_ROLES } } } } },
      select: { id: true, name: true, roles: { select: { role: { select: { isOwner: true } } } } },
    });
    if (!holder || holder.roles.some((r) => r.role.isOwner)) throw new ValidationError("Pick an active manager or supervisor.", { holderId: "Pick a manager or supervisor." });
    let eventName: string | null = null;
    if (v.eventId) {
      await assertBookingOpen(tx, v.eventId);
      const ev = await tx.event.findUnique({ where: { id: v.eventId }, select: { name: true, status: true, members: { where: { userId: holder.id }, select: { userId: true } } } });
      if (!ev) throw new ValidationError("Pick a booking.", { eventId: "Pick a booking." });
      if (ev.status === "CANCELLED") throw new ConflictError("This booking is cancelled.");
      if (!ev.members.length) throw new ValidationError(`${holder.name} isn't on the team for ${ev.name}.`, { holderId: "Pick someone on the booking's team." });
      eventName = ev.name;
    }
    const now = new Date();
    const status = !host ? "PENDING_APPROVAL" : v.handedOver ? "GIVEN" : "APPROVED";
    const adv = await tx.cashAdvance.create({
      data: {
        userId: holder.id,
        eventId: v.eventId || null,
        amount: v.amount,
        purpose: v.purpose,
        method: v.method,
        status,
        requestedById: actor.userId,
        ...(host ? { approvedById: actor.userId, approvedAt: now } : {}),
        ...(v.handedOver ? { givenOn: new Date(`${givenOn}T00:00:00Z`), givenById: actor.userId, reference: v.reference || null } : {}),
      },
    });
    const summary = `Cash advance for ${holder.name}: ${v.purpose}${eventName ? ` · ${eventName}` : ""}`;
    if (status === "PENDING_APPROVAL") {
      await tx.approvalRequest.create({ data: { type: "CASH_ADVANCE", entityId: adv.id, eventId: v.eventId || null, amount: v.amount, summary, requestedById: actor.userId } });
      await notify(tx, await ownerUserIds(tx), { type: "approval.requested", title: `Cash advance to approve: ${formatINR(v.amount)}`, body: summary, link: "/approvals", entityType: "cash_advance", entityId: adv.id }, { exceptUserId: actor.userId });
    }
    if (status === "GIVEN") {
      await notify(tx, [holder.id], { type: "advance.given", title: `Company cash with you: ${formatINR(v.amount)}`, body: `${v.purpose}. Record what you spend, with the bill, and return the rest.`, link: "/advances", entityType: "cash_advance", entityId: adv.id });
    }
    await recordAudit(tx, actor, { action: "create", entityType: "cash_advance", entityId: adv.id, summary: `${status === "GIVEN" ? "Gave" : status === "APPROVED" ? "Approved" : "Prepared"} ${formatINR(v.amount)} · ${summary}`, financial: true }, meta);
    return { id: adv.id, status };
  });
}

/** Called from the approvals inbox (approvals/service.ts) inside its transaction. */
export async function decideAdvance(tx: DbTx, actor: Actor, advanceId: string, approve: boolean, now: Date) {
  const a = await tx.cashAdvance.findUnique({ where: { id: advanceId }, include: { user: { select: { name: true } } } });
  if (!a) throw new NotFoundError("That cash advance");
  if (a.status !== "PENDING_APPROVAL") throw new ConflictError("This advance is no longer waiting.");
  await tx.cashAdvance.update({ where: { id: a.id }, data: approve ? { status: "APPROVED", approvedById: actor.userId, approvedAt: now } : { status: "REJECTED" } });
  return `${approve ? "Approved" : "Rejected"} cash advance ${formatINR(a.amount)} for ${a.user.name}`;
}

export const handOverSchema = z.object({ method: z.enum(METHODS), reference: z.string().trim().max(80).optional(), givenOn: date });

/** The approved cash is handed over to the holder. */
export async function markAdvanceGiven(db: Db, actor: Actor, advanceId: string, input: z.input<typeof handOverSchema>, meta: RequestMeta = {}) {
  if (actor.accountType !== "INTERNAL") throw new ForbiddenError();
  assertCan(actor, "payments.markPaid", "You can't hand over advances.");
  const v = parseInput(handOverSchema, input);
  if (v.givenOn > todayInIndia()) throw new ValidationError("The date is in the future.", { givenOn: "Pick today or earlier." });
  if (v.method !== "CASH" && !v.reference) throw new ValidationError("Enter the UPI or bank reference.", { reference: "A reference is needed (not for cash)." });
  return db.$transaction(async (tx) => {
    const a = await tx.cashAdvance.findUnique({ where: { id: advanceId }, include: { user: { select: { name: true } } } });
    if (!a) throw new NotFoundError("That cash advance");
    if (a.status !== "APPROVED") throw new ConflictError(a.status === "PENDING_APPROVAL" ? "A host has to approve this advance first." : "This advance is not waiting to be handed over.");
    await assertBookingOpen(tx, a.eventId);
    await tx.cashAdvance.update({ where: { id: a.id }, data: { status: "GIVEN", method: v.method, reference: v.reference || null, givenOn: new Date(`${v.givenOn}T00:00:00Z`), givenById: actor.userId } });
    await notify(tx, [a.userId], { type: "advance.given", title: `Company cash with you: ${formatINR(a.amount)}`, body: `${a.purpose}. Record what you spend, with the bill, and return the rest.`, link: "/advances", entityType: "cash_advance", entityId: a.id });
    await recordAudit(tx, actor, { action: "pay", entityType: "cash_advance", entityId: a.id, summary: `Handed over ${formatINR(a.amount)} to ${a.user.name} (${v.method.toLowerCase()}${v.reference ? ` ${v.reference}` : ""}) · ${a.purpose}`, financial: true }, meta);
  });
}

// ───────────────────────────── Closing ─────────────────────────────

export const closeSchema = z.object({
  returned: z.coerce.number({ message: "Enter the cash returned (0 if none)." }).min(0, "Can't be negative."),
  note: z.string().trim().max(300).optional(),
});

/**
 * The holder brings back what is left and the advance is closed. A shortfall (less returned than is
 * left) is settled only by a host, with a note saying how (e.g. "taken from pay", "written off").
 */
export async function closeAdvance(db: Db, actor: Actor, advanceId: string, input: z.input<typeof closeSchema>, meta: RequestMeta = {}) {
  if (actor.accountType !== "INTERNAL") throw new ForbiddenError();
  assertCan(actor, "payments.markPaid", "You can't close advances.");
  const v = parseInput(closeSchema, input);
  return db.$transaction(async (tx) => {
    await lockAdvance(tx, advanceId);
    const a = await tx.cashAdvance.findUnique({ where: { id: advanceId }, include: { user: { select: { name: true } } } });
    if (!a) throw new NotFoundError("That cash advance");
    if (a.status !== "GIVEN") throw new ConflictError("Only an advance that has been handed over can be closed.");
    await assertBookingOpen(tx, a.eventId);
    const b = await advanceBalance(tx, a.id);
    if (b.waiting > 0) throw new ConflictError(`${formatINR(b.waiting)} of spending is still waiting for a host. Decide those expenses first.`);
    if (v.returned > b.left + 0.005) throw new ValidationError(`Only ${formatINR(b.left, { decimals: true })} is left on this advance.`, { returned: `At most ${formatINR(b.left, { decimals: true })}.` });
    const short = round2(b.left - v.returned);
    if (short > TOLERANCE) {
      if (!can(actor, "approvals.decide")) throw new ConflictError(`${formatINR(short, { decimals: true })} is missing. A host settles a shortfall.`);
      if (!v.note) throw new ValidationError("Say how the missing cash is settled, e.g. taken from pay.", { note: "A note is needed for a shortfall." });
    }
    await tx.cashAdvance.update({ where: { id: a.id }, data: { status: "CLOSED", returnedAmount: v.returned, settledAt: new Date(), closedById: actor.userId, closeNote: v.note || null } });
    await notify(tx, [a.userId], { type: "advance.closed", title: `Advance closed: ${formatINR(a.amount)}`, body: `${formatINR(b.approved)} spent, ${formatINR(v.returned)} returned${short > TOLERANCE ? `, ${formatINR(short)} settled: ${v.note}` : ""}.`, link: "/advances", entityType: "cash_advance", entityId: a.id }, { exceptUserId: actor.userId });
    await recordAudit(tx, actor, { action: "close", entityType: "cash_advance", entityId: a.id, summary: `Closed ${a.user.name}'s advance of ${formatINR(a.amount)}: spent ${formatINR(b.approved)}, returned ${formatINR(v.returned)}${short > TOLERANCE ? `, shortfall ${formatINR(short)} settled · ${v.note}` : ""}`, financial: true }, meta);
    return { spent: b.approved, returned: v.returned, shortfall: short > TOLERANCE ? short : 0 };
  });
}

/** Cancels a mistaken advance, with a reason. Once the cash is handed over, only a host, and only with nothing spent. */
export async function voidAdvance(db: Db, actor: Actor, advanceId: string, reason: string, meta: RequestMeta = {}) {
  if (actor.accountType !== "INTERNAL") throw new ForbiddenError();
  assertCan(actor, "payments.prepare", "You can't void advances.");
  const why = reason.trim();
  if (!why) throw new ValidationError("Write a short reason.", { reason: "A reason is needed." });
  return db.$transaction(async (tx) => {
    await lockAdvance(tx, advanceId);
    const a = await tx.cashAdvance.findUnique({ where: { id: advanceId }, include: { user: { select: { name: true } } } });
    if (!a) throw new NotFoundError("That cash advance");
    if (!(OPEN_ADVANCE_STATUSES as readonly string[]).includes(a.status)) throw new ConflictError("This advance is already closed.");
    await assertBookingOpen(tx, a.eventId);
    if (a.status === "GIVEN") {
      if (!can(actor, "approvals.decide")) throw new ForbiddenError("The cash has been handed over, so only a host can void it.");
      const used = await tx.expense.count({ where: { cashAdvanceId: a.id, status: { not: "REJECTED" } } });
      if (used) throw new ConflictError("Spending is recorded against this advance. Close it instead.");
    }
    await tx.cashAdvance.update({ where: { id: a.id }, data: { status: "VOIDED", voidReason: why, voidedById: actor.userId, voidedAt: new Date() } });
    await tx.approvalRequest.updateMany({ where: { type: "CASH_ADVANCE", entityId: a.id, state: "PENDING" }, data: { state: "CANCELLED", decidedById: actor.userId, decidedAt: new Date(), comment: why } });
    await notify(tx, [a.userId], { type: "advance.voided", title: `Advance cancelled: ${formatINR(a.amount)}`, body: why, link: "/advances", entityType: "cash_advance", entityId: a.id }, { exceptUserId: actor.userId });
    await recordAudit(tx, actor, { action: "void", entityType: "cash_advance", entityId: a.id, summary: `Voided ${a.user.name}'s advance of ${formatINR(a.amount)} · ${why}`, financial: true }, meta);
  });
}

// ───────────────────────────── Seeing them ─────────────────────────────

/** Advances this person may see (all for hosts and the accountant; their own for a holder), with balances. */
export async function listAdvances(db: Db, actor: Actor, filter: { open?: boolean; eventId?: string; mine?: boolean } = {}) {
  if (actor.accountType !== "INTERNAL") return [];
  const where: Prisma.CashAdvanceWhereInput = {
    AND: [cashAdvanceWhere(actor), filter.open ? { status: { in: [...OPEN_ADVANCE_STATUSES] } } : {}, filter.eventId ? { eventId: filter.eventId } : {}, filter.mine ? { userId: actor.userId } : {}],
  };
  const rows = await db.cashAdvance.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    take: 300,
    include: {
      user: { select: { id: true, name: true } },
      event: { select: { id: true, name: true, status: true } },
      expenses: { orderBy: { spentOn: "asc" }, include: { category: { select: { name: true } }, receiptFile: { select: MEDIA_SELECT } } },
    },
  });
  const order = { GIVEN: 0, APPROVED: 1, PENDING_APPROVAL: 2, CLOSED: 3, REJECTED: 4, VOIDED: 5 } as const;
  return rows
    .map((a) => {
      const live = a.expenses.filter((e) => e.status !== "REJECTED");
      const approved = round2(live.filter((e) => e.status !== "SUBMITTED").reduce((s, e) => s + toNumber(e.amount), 0));
      const waiting = round2(live.filter((e) => e.status === "SUBMITTED").reduce((s, e) => s + toNumber(e.amount), 0));
      const amount = toNumber(a.amount);
      const returned = toNumber(a.returnedAmount);
      const left = ["GIVEN"].includes(a.status) ? round2(amount - approved - waiting - returned) : 0;
      return {
        id: a.id,
        holder: a.user,
        mine: a.userId === actor.userId,
        event: a.event,
        amount,
        purpose: a.purpose,
        status: a.status,
        method: a.method,
        reference: a.reference,
        givenOn: a.givenOn,
        createdAt: a.createdAt,
        closedAt: a.settledAt,
        closeNote: a.closeNote,
        voidReason: a.voidReason,
        approved,
        waiting,
        returned,
        left,
        shortfall: a.status === "CLOSED" ? round2(amount - approved - returned) : 0,
        expenses: a.expenses.map((e) => ({
          id: e.id,
          description: e.description,
          category: e.category.name,
          amount: toNumber(e.amount),
          spentOn: e.spentOn,
          status: e.status,
          receipt: e.receiptFile ? mediaView(actor.userId, e.receiptFile, { original: true }) : null,
        })),
      };
    })
    .sort((x, y) => order[x.status] - order[y.status] || y.createdAt.getTime() - x.createdAt.getTime());
}

export type AdvanceItem = Awaited<ReturnType<typeof listAdvances>>[number];

/** Company cash held per person right now (handed over, not yet spent or returned). */
export async function advanceBalances(db: Db, actor: Actor) {
  const open = await listAdvances(db, actor, { open: true });
  const people = new Map<string, { userId: string; name: string; held: number; waiting: number; open: number; toHandOver: number }>();
  for (const a of open) {
    const p = people.get(a.holder.id) ?? { userId: a.holder.id, name: a.holder.name, held: 0, waiting: 0, open: 0, toHandOver: 0 };
    if (a.status === "GIVEN") {
      p.held = round2(p.held + a.left + a.waiting);
      p.waiting = round2(p.waiting + a.waiting);
      p.open += 1;
    } else p.toHandOver = round2(p.toHandOver + a.amount);
    people.set(a.holder.id, p);
  }
  const list = [...people.values()].sort((x, y) => y.held - x.held);
  return { people: list, held: round2(list.reduce((s, p) => s + p.held, 0)) };
}

/** The holder's own advances they can still spend from (for the expense form and their home screen). */
export async function spendableAdvances(db: Db, actor: Actor) {
  if (actor.accountType !== "INTERNAL" || !can(actor, "expenses.record")) return [];
  const mine = await listAdvances(db, actor, { open: true, mine: true });
  return mine.filter((a) => a.status === "GIVEN").map((a) => ({ id: a.id, purpose: a.purpose, left: a.left, waiting: a.waiting, amount: a.amount, event: a.event }));
}

/** People who can carry company cash, for the "give an advance" form. */
export async function advanceHolders(db: Db, actor: Actor) {
  if (!can(actor, "payments.prepare")) return [];
  return db.user.findMany({
    where: { status: "ACTIVE", accountType: "INTERNAL", roles: { some: { role: { key: { in: HOLDER_ROLES } } }, none: { role: { isOwner: true } } } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}
