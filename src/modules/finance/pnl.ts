/**
 * Monthly profit and loss for the owners and the accountant (finance.company).
 *
 * Two views side by side, because they answer different questions:
 *   - Bookings, by the month of the booking's first day: billed (before GST), vendor, crew and
 *     expense costs, and margin before tax (D33). "How did the work we did in October do?"
 *   - Cash, by payment date: received from clients and paid out. "What came in and went out?"
 * Office expenses (approved expenses not tied to a booking) are shown per month by the date spent,
 * and taken off the margin to give "after office costs".
 *
 * Bookings without dates (no functions yet) and cancelled bookings with no money are left out.
 * Financial years run April to March (Indian FY).
 */
import type { Db } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { todayInIndia, toNumber } from "@/lib/format";
import type { Actor } from "@/modules/identity/actor";
import { assertCan } from "@/modules/identity/policy";
import { bookingFigures, round2 } from "./figures";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const MAX_MONTHS = 24;

export interface PnlMonth {
  month: string; // YYYY-MM
  bookings: number;
  settled: number;
  billed: number;
  vendorCost: number;
  crewCost: number;
  expenseCost: number;
  margin: number;
  officeCost: number;
  afterOffice: number;
  received: number;
  paidOut: number;
  net: number;
}

export interface PnlBooking {
  id: string;
  code: string;
  name: string;
  month: string;
  status: string;
  billed: number;
  gst: number;
  received: number;
  vendorCost: number;
  crewCost: number;
  expenseCost: number;
  paidOut: number;
  margin: number;
}

/** The financial year (April–March) a date falls in, by its starting year: 2026-11-18 → 2026. */
export function financialYearOf(ymd: string = todayInIndia()): number {
  const [y, m] = ymd.split("-").map(Number);
  return m >= 4 ? y : y - 1;
}

export function fyMonths(startYear: number): { from: string; to: string } {
  return { from: `${startYear}-04`, to: `${startYear + 1}-03` };
}

export const fyLabel = (startYear: number) => `${startYear}–${String((startYear + 1) % 100).padStart(2, "0")}`;

export function monthsBetween(from: string, to: string): string[] {
  if (!MONTH.test(from) || !MONTH.test(to) || from > to) throw new ValidationError("Pick a range of months.");
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (key > to) break;
    out.push(key);
    if (out.length > MAX_MONTHS) throw new ValidationError(`Pick at most ${MAX_MONTHS} months.`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

const monthOf = (d: Date) => d.toISOString().slice(0, 7);

export async function monthlyPnl(db: Db, actor: Actor, range: { from: string; to: string }) {
  assertCan(actor, "finance.company", "Only owners and the accountant see company money.");
  const months = monthsBetween(range.from, range.to);
  const start = new Date(`${months[0]}-01T00:00:00Z`);
  const [ly, lm] = months[months.length - 1].split("-").map(Number);
  const end = new Date(Date.UTC(ly, lm, 0)); // last day of the last month

  const [events, payments, office] = await Promise.all([
    db.event.findMany({ where: { startDate: { gte: start, lte: end } }, orderBy: [{ startDate: "asc" }, { code: "asc" }], select: { id: true, code: true, name: true, status: true, startDate: true } }),
    db.payment.findMany({ where: { status: "PAID", paidOn: { gte: start, lte: end } }, select: { direction: true, amount: true, paidOn: true } }),
    db.expense.findMany({ where: { eventId: null, status: { in: ["APPROVED", "REIMBURSED"] }, spentOn: { gte: start, lte: end } }, select: { amount: true, spentOn: true } }),
  ]);
  const figures = await bookingFigures(db, events.map((e) => e.id));

  const rows = new Map<string, PnlMonth>(months.map((m) => [m, { month: m, bookings: 0, settled: 0, billed: 0, vendorCost: 0, crewCost: 0, expenseCost: 0, margin: 0, officeCost: 0, afterOffice: 0, received: 0, paidOut: 0, net: 0 }]));
  const bookings: PnlBooking[] = [];
  for (const e of events) {
    const f = figures.get(e.id)!;
    const hasMoney = f.billed || f.vendorCost || f.crewCost || f.expenseCost || f.received || f.paidOut;
    if (e.status === "CANCELLED" && !hasMoney) continue;
    const month = monthOf(e.startDate!);
    const r = rows.get(month)!;
    r.bookings += 1;
    if (e.status === "SETTLED") r.settled += 1;
    r.billed += f.billed;
    r.vendorCost += f.vendorCost;
    r.crewCost += f.crewCost;
    r.expenseCost += f.expenseCost;
    r.margin += f.margin;
    bookings.push({ id: e.id, code: e.code, name: e.name, month, status: e.status, ...f });
  }
  for (const p of payments) {
    const r = rows.get(monthOf(p.paidOn!))!;
    if (p.direction === "IN") r.received += toNumber(p.amount);
    else r.paidOut += toNumber(p.amount);
  }
  for (const x of office) rows.get(monthOf(x.spentOn))!.officeCost += toNumber(x.amount);

  const list = [...rows.values()].map((r) => {
    const out = { ...r };
    for (const k of ["billed", "vendorCost", "crewCost", "expenseCost", "margin", "officeCost", "received", "paidOut"] as const) out[k] = round2(out[k]);
    out.afterOffice = round2(out.margin - out.officeCost);
    out.net = round2(out.received - out.paidOut);
    return out;
  });
  const total = list.reduce(
    (t, r) => {
      for (const k of ["bookings", "settled", "billed", "vendorCost", "crewCost", "expenseCost", "margin", "officeCost", "afterOffice", "received", "paidOut", "net"] as const) t[k] = round2(t[k] + r[k]);
      return t;
    },
    { month: "Total", bookings: 0, settled: 0, billed: 0, vendorCost: 0, crewCost: 0, expenseCost: 0, margin: 0, officeCost: 0, afterOffice: 0, received: 0, paidOut: 0, net: 0 } as PnlMonth,
  );
  return { months: list, total, bookings };
}

export type MonthlyPnl = Awaited<ReturnType<typeof monthlyPnl>>;
