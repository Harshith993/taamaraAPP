/**
 * Settling a booking (Phase 7): the last step of a booking's life.
 *
 *   COMPLETED ──(an owner settles, once everything below is true)──▶ SETTLED (locked)
 *       ▲                                                              │
 *       └────────────(an owner reopens it, with a reason)──────────────┘
 *
 * Ready to settle when:
 *   - the booking is marked completed
 *   - the client has paid everything billed (with GST)
 *   - every booked vendor's work is signed off, invoiced, checked and paid
 *   - every crew member on it is paid in full, with no extras waiting
 *   - no payments, expenses or other approvals are waiting, and nobody is owed for an expense
 *
 * Settling stores the final figures on the booking and locks its money: no new charges,
 * payments, expenses, crew extras, invoices, budgets, vendor jobs or crew (database triggers).
 * Only owners settle and reopen (D36). The checklist is shown to people who see client billing.
 */
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { inSequence, type Db, type DbTx } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { formatINR, toNumber } from "@/lib/format";
import { parseInput } from "@/lib/validate";
import { recordAudit, type RequestMeta } from "@/modules/audit/audit";
import type { Actor } from "@/modules/identity/actor";
import { can } from "@/modules/identity/policy";
import { bookingTeamUserIds, notify, ownerUserIds } from "@/modules/notifications/notify";
import { BOOKED_JOB_STATUSES, bookingFigures, PAID_CREW_STATUSES, round2, type BookingFigures } from "./figures";

/** Rupee rounding tolerance: a balance within 50 paise counts as zero. */
const TOLERANCE = 0.5;

export interface SettlementCheck {
  key: "completed" | "client" | "vendors" | "crew" | "waiting" | "expenses" | "charged";
  ok: boolean;
  /** "block" stops settling; "warn" is shown but doesn't stop it. */
  level: "block" | "warn";
  label: string;
  details: string[];
}

async function computeChecks(tx: DbTx, eventId: string) {
  const event = await tx.event.findUnique({ where: { id: eventId }, select: { id: true, name: true, code: true, status: true, settledAt: true, settledById: true, settlementSnapshot: true } });
  if (!event) throw new NotFoundError("That booking");
  const figures = (await bookingFigures(tx, [eventId])).get(eventId)!;
  const [jobs, crew, waitingPayments, expenses, approvals] = await inSequence([
    tx.vendorAssignment.findMany({
      where: { eventId, status: { in: [...BOOKED_JOB_STATUSES] } },
      orderBy: { createdAt: "asc" },
      select: {
        vendorId: true,
        status: true,
        agreedAmount: true,
        vendor: { select: { companyName: true } },
        workOrders: { select: { invoices: { select: { invoiceNumber: true, status: true, total: true, payments: { where: { status: "PAID" }, select: { amount: true } } } } } },
      },
    }),
    tx.crewAssignment.findMany({
      where: { eventId, status: { in: [...PAID_CREW_STATUSES] } },
      orderBy: { createdAt: "asc" },
      select: { agreedPay: true, worker: { select: { name: true } }, adjustments: { select: { type: true, amount: true, state: true } }, payments: { where: { status: "PAID" }, select: { amount: true } } },
    }),
    tx.payment.findMany({ where: { eventId, status: { in: ["PENDING_APPROVAL", "APPROVED"] } }, select: { amount: true, status: true, direction: true } }),
    tx.expense.findMany({ where: { eventId, OR: [{ status: "SUBMITTED" }, { status: "APPROVED", paidVia: "OWN_POCKET" }] }, select: { description: true, amount: true, status: true } }),
    tx.approvalRequest.findMany({ where: { eventId, state: "PENDING", type: { in: ["QUOTATION", "BUDGET"] } }, select: { type: true, summary: true } }),
  ]);
  const paidOutTo = (vendorId: string) => tx.payment.aggregate({ where: { eventId, vendorId, direction: "OUT", status: "PAID" }, _sum: { amount: true } });

  const checks: SettlementCheck[] = [];
  checks.push({
    key: "completed",
    ok: event.status === "COMPLETED" || event.status === "SETTLED",
    level: "block",
    label: "The booking is marked completed",
    details: event.status === "COMPLETED" || event.status === "SETTLED" ? [] : [`It is ${event.status.toLowerCase()}. Mark it completed once the last function is over.`],
  });
  checks.push({ key: "charged", ok: figures.billed > 0, level: "warn", label: "The client has been charged", details: figures.billed > 0 ? [] : ["Nothing is charged to the client on this booking."] });

  const balance = figures.due;
  checks.push({ key: "client", ok: balance <= TOLERANCE, level: "block", label: "The client has paid in full", details: balance > TOLERANCE ? [`The client still owes ${formatINR(balance, { decimals: true })} (with GST).`] : [] });
  if (balance < -TOLERANCE) checks.push({ key: "client", ok: false, level: "warn", label: "The client paid more than was billed", details: [`${formatINR(-balance, { decimals: true })} more than billed. Add the missing charge, or note the refund.`] });

  const vendorIssues: string[] = [];
  for (const j of jobs) {
    const name = j.vendor.companyName;
    if (j.status !== "COMPLETED") vendorIssues.push(`${name}: the work isn't signed off yet (${j.status.toLowerCase().replace("_", " ")}).`);
    const invoices = j.workOrders.flatMap((w) => w.invoices);
    for (const i of invoices) {
      if (i.status === "SUBMITTED") vendorIssues.push(`${name}: invoice ${i.invoiceNumber} hasn't been checked.`);
      else if (i.status === "DISPUTED") vendorIssues.push(`${name}: invoice ${i.invoiceNumber} is with the vendor to correct.`);
      else if (i.status !== "VOID") {
        const left = round2(toNumber(i.total) - i.payments.reduce((s, p) => s + toNumber(p.amount), 0));
        if (left > TOLERANCE) vendorIssues.push(`${name}: ${formatINR(left, { decimals: true })} left to pay on invoice ${i.invoiceNumber}.`);
      }
    }
    const live = invoices.filter((i) => !["VOID", "DISPUTED"].includes(i.status));
    if (live.length === 0) {
      const paid = toNumber((await paidOutTo(j.vendorId))._sum.amount);
      if (paid < toNumber(j.agreedAmount) - TOLERANCE) vendorIssues.push(`${name}: no invoice yet (agreed ${formatINR(j.agreedAmount)}).`);
    }
  }
  checks.push({ key: "vendors", ok: vendorIssues.length === 0, level: "block", label: jobs.length ? `Vendors are paid (${jobs.length})` : "Vendors are paid (none booked)", details: vendorIssues });

  const crewIssues: string[] = [];
  for (const a of crew) {
    const approved = a.adjustments.filter((x) => x.state === "APPROVED").reduce((s, x) => s + (x.type === "EXTRA" ? 1 : -1) * toNumber(x.amount), 0);
    const left = round2(toNumber(a.agreedPay) + approved - a.payments.reduce((s, p) => s + toNumber(p.amount), 0));
    if (left > TOLERANCE) crewIssues.push(`${a.worker.name}: ${formatINR(left, { decimals: true })} still to pay.`);
    const pending = a.adjustments.filter((x) => x.state === "PENDING").length;
    if (pending) crewIssues.push(`${a.worker.name}: ${pending === 1 ? "an extra or deduction is" : `${pending} extras or deductions are`} waiting for a host.`);
  }
  checks.push({ key: "crew", ok: crewIssues.length === 0, level: "block", label: crew.length ? `Crew are paid (${crew.length})` : "Crew are paid (none on it)", details: crewIssues });

  const waiting: string[] = [];
  const pendingPay = waitingPayments.filter((p) => p.status === "PENDING_APPROVAL");
  const approvedPay = waitingPayments.filter((p) => p.status === "APPROVED");
  if (pendingPay.length) waiting.push(`${pendingPay.length} payment${pendingPay.length === 1 ? "" : "s"} waiting for a host's approval.`);
  if (approvedPay.length) waiting.push(`${approvedPay.length} approved payment${approvedPay.length === 1 ? "" : "s"} not yet marked paid.`);
  for (const a of approvals) waiting.push(`${a.type === "QUOTATION" ? "Quote" : a.type === "BUDGET" ? "Budget" : "Approval"} waiting: ${a.summary}`);
  checks.push({ key: "waiting", ok: waiting.length === 0, level: "block", label: "Nothing is waiting for approval or payment", details: waiting });

  checks.push({
    key: "expenses",
    ok: expenses.length === 0,
    level: "block",
    label: "Expenses are approved and repaid",
    details: expenses.map((e) => `${e.description} (${formatINR(e.amount)}): ${e.status === "SUBMITTED" ? "waiting for a host" : "not yet repaid"}.`),
  });

  const ready = event.status === "COMPLETED" && checks.every((c) => c.ok || c.level === "warn");
  return { event, figures, balance, checks, ready };
}

export interface SettlementView {
  status: string;
  settled: { at: Date; by: string | null; figures: BookingFigures; note: string | null } | null;
  figures: BookingFigures;
  checks: SettlementCheck[];
  ready: boolean;
  canSettle: boolean;
}

/** The checklist for a booking, for people who see client billing (owners, the accountant). */
export async function settlementView(db: Db, actor: Actor, eventId: string): Promise<SettlementView | null> {
  if (actor.accountType !== "INTERNAL" || !can(actor, "finance.billing")) return null;
  const r = await computeChecks(db, eventId);
  let settled: SettlementView["settled"] = null;
  if (r.event.status === "SETTLED" && r.event.settledAt) {
    const by = r.event.settledById ? await db.user.findUnique({ where: { id: r.event.settledById }, select: { name: true } }) : null;
    const snap = (r.event.settlementSnapshot ?? {}) as Partial<BookingFigures> & { note?: string | null };
    settled = { at: r.event.settledAt, by: by?.name ?? null, figures: { ...r.figures, ...snap }, note: snap.note ?? null };
  }
  return { status: r.event.status, settled, figures: r.figures, checks: r.checks, ready: r.ready, canSettle: actor.isOwner };
}

export const settleSchema = z.object({ note: z.string().trim().max(300).optional() });

export async function settleBooking(db: Db, actor: Actor, eventId: string, input: z.input<typeof settleSchema> = {}, meta: RequestMeta = {}) {
  const v = parseInput(settleSchema, input);
  if (actor.accountType !== "INTERNAL" || !actor.isOwner) throw new ForbiddenError("Only a host settles a booking.");
  return db.$transaction(async (tx) => {
    const r = await computeChecks(tx, eventId);
    if (r.event.status === "SETTLED") throw new ConflictError("This booking is already settled.");
    const blocking = r.checks.filter((c) => !c.ok && c.level === "block");
    if (!r.ready) throw new ConflictError(`Not ready to settle: ${blocking.map((c) => c.details[0] ?? c.label).join(" ")}`);
    const snapshot = { ...r.figures, note: v.note || null };
    await tx.event.update({ where: { id: eventId }, data: { status: "SETTLED", settledAt: new Date(), settledById: actor.userId, settlementSnapshot: snapshot } });
    const f = r.figures;
    await recordAudit(
      tx,
      actor,
      {
        action: "settle",
        entityType: "event",
        entityId: eventId,
        summary: `Settled ${r.event.name}: billed ${formatINR(f.billed)}, received ${formatINR(f.received)}, costs ${formatINR(f.vendorCost + f.crewCost + f.expenseCost)}, margin ${formatINR(f.margin)}${v.note ? ` · ${v.note}` : ""}`,
        financial: true,
        after: snapshot,
      },
      meta,
    );
    await notify(tx, await ownerUserIds(tx), { type: "booking.settled", title: `Settled: ${r.event.name}`, body: `Margin before tax ${formatINR(f.margin)}`, link: `/bookings/${eventId}?tab=money`, entityType: "event", entityId: eventId }, { exceptUserId: actor.userId });
    // The booking team hears it is closed, without the figures (D11).
    await notify(tx, await bookingTeamUserIds(tx, eventId, ["MANAGER"]), { type: "booking.settled", title: `${r.event.name} is settled and closed`, link: `/bookings/${eventId}`, entityType: "event", entityId: eventId }, { exceptUserId: actor.userId });
    return { figures: f };
  });
}

export const reopenSchema = z.object({ reason: z.string().trim().min(5, "Say why it is being reopened, e.g. Vendor sent a corrected invoice.").max(300) });

export async function reopenBooking(db: Db, actor: Actor, eventId: string, input: z.input<typeof reopenSchema>, meta: RequestMeta = {}) {
  const v = parseInput(reopenSchema, input);
  if (actor.accountType !== "INTERNAL" || !actor.isOwner) throw new ForbiddenError("Only a host reopens a settled booking.");
  return db.$transaction(async (tx) => {
    const ev = await tx.event.findUnique({ where: { id: eventId }, select: { name: true, status: true, settlementSnapshot: true } });
    if (!ev) throw new NotFoundError("That booking");
    if (ev.status !== "SETTLED") throw new ConflictError("This booking isn't settled.");
    await tx.event.update({ where: { id: eventId }, data: { status: "COMPLETED", settledAt: null, settledById: null, settlementSnapshot: Prisma.DbNull } });
    await recordAudit(tx, actor, { action: "reopen", entityType: "event", entityId: eventId, summary: `Reopened settled booking ${ev.name} · ${v.reason}`, financial: true, before: (ev.settlementSnapshot ?? undefined) as never }, meta);
    await notify(tx, await ownerUserIds(tx), { type: "booking.reopened", title: `Reopened: ${ev.name}`, body: v.reason, link: `/bookings/${eventId}?tab=money`, entityType: "event", entityId: eventId }, { exceptUserId: actor.userId });
  });
}
