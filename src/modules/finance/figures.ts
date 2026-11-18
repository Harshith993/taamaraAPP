/**
 * The money figures of one or more bookings, computed the same way everywhere they are final:
 * settlement (settlement.ts) and the monthly P&L (pnl.ts).
 *
 *   billed       client charges before GST          gst        GST on those charges
 *   received     client payments marked paid       paidOut    vendor, crew and expense payments paid
 *   vendorCost   agreed amounts of booked vendor jobs (as quoted, GST included; D33)
 *   crewCost     agreed pay + approved extras − approved deductions, for crew who were on the booking
 *                (no-shows are not paid, so they are not a cost)
 *   expenseCost  approved and repaid expenses on the booking
 *   margin       billed − vendorCost − crewCost − expenseCost ("margin before tax", D33)
 *
 * No permission checks here: callers check before asking.
 */
import { inSequence, type DbTx } from "@/lib/db";
import { toNumber } from "@/lib/format";

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Vendor jobs that count as booked (a quote was approved and the job wasn't dropped). */
export const BOOKED_JOB_STATUSES = ["APPROVED", "ACCEPTED", "IN_PROGRESS", "DELIVERED", "COMPLETED"] as const;
/** Crew who were (or are) on the booking and are owed their pay. */
export const PAID_CREW_STATUSES = ["CONFIRMED", "COMPLETED"] as const;

export interface BookingFigures {
  billed: number;
  gst: number;
  received: number;
  vendorCost: number;
  crewCost: number;
  expenseCost: number;
  paidOut: number;
  margin: number;
}

const empty = (): BookingFigures => ({ billed: 0, gst: 0, received: 0, vendorCost: 0, crewCost: 0, expenseCost: 0, paidOut: 0, margin: 0 });

export async function bookingFigures(tx: DbTx, eventIds: string[]): Promise<Map<string, BookingFigures>> {
  const out = new Map<string, BookingFigures>(eventIds.map((id) => [id, empty()]));
  if (eventIds.length === 0) return out;
  const inIds = { in: eventIds };
  const [charges, jobs, crew, expenses, payments] = await inSequence([
    tx.clientCharge.findMany({ where: { eventId: inIds }, select: { eventId: true, amount: true, gstRate: true } }),
    tx.vendorAssignment.findMany({ where: { eventId: inIds, status: { in: [...BOOKED_JOB_STATUSES] } }, select: { eventId: true, agreedAmount: true } }),
    tx.crewAssignment.findMany({ where: { eventId: inIds, status: { in: [...PAID_CREW_STATUSES] } }, select: { eventId: true, agreedPay: true, adjustments: { where: { state: "APPROVED" }, select: { type: true, amount: true } } } }),
    tx.expense.groupBy({ by: ["eventId"], where: { eventId: inIds, status: { in: ["APPROVED", "REIMBURSED"] } }, _sum: { amount: true } }),
    tx.payment.groupBy({ by: ["eventId", "direction"], where: { eventId: inIds, status: "PAID" }, _sum: { amount: true } }),
  ]);
  for (const c of charges) {
    const f = out.get(c.eventId)!;
    f.billed += toNumber(c.amount);
    f.gst += (toNumber(c.amount) * toNumber(c.gstRate)) / 100;
  }
  for (const j of jobs) out.get(j.eventId)!.vendorCost += toNumber(j.agreedAmount);
  for (const a of crew) out.get(a.eventId)!.crewCost += toNumber(a.agreedPay) + a.adjustments.reduce((s, x) => s + (x.type === "EXTRA" ? 1 : -1) * toNumber(x.amount), 0);
  for (const e of expenses) if (e.eventId) out.get(e.eventId)!.expenseCost += toNumber(e._sum.amount);
  for (const p of payments) {
    if (!p.eventId) continue;
    const f = out.get(p.eventId)!;
    if (p.direction === "IN") f.received += toNumber(p._sum.amount);
    else f.paidOut += toNumber(p._sum.amount);
  }
  for (const f of out.values()) {
    for (const k of Object.keys(f) as (keyof BookingFigures)[]) f[k] = round2(f[k]);
    f.margin = round2(f.billed - f.vendorCost - f.crewCost - f.expenseCost);
  }
  return out;
}
