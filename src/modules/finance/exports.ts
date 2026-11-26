/**
 * Excel exports for the outside accountant (reports.finance: owners and the accountant).
 *
 *   purchases   vendor invoices: vendor, GSTIN, number, date, taxable, GST, total, status, booking
 *   payments    every payment in and out: date, direction, party, booking, method, reference, amount, status
 *   expenses    expenses: date, booking, kind, what, who, paid by, amount, status
 *   crew-pay    per booking and crew member: agreed, approved extras/deductions, total, paid
 *   sales       client GST invoices issued (and cancelled) in the range: the sales register for GSTR-1
 *   advances    cash advances given to managers and supervisors (D57): given, spent, returned, left
 *   pnl         monthly P&L for the months the range touches (pnl.ts), plus each booking's figures
 *
 * Dates are a range of calendar days in India time. Every export is written to the audit log.
 */
import ExcelJS from "exceljs";
import type { Db } from "@/lib/db";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { toNumber } from "@/lib/format";
import { stateName } from "@/lib/gst";
import { recordAudit, type RequestMeta } from "@/modules/audit/audit";
import type { Actor } from "@/modules/identity/actor";
import { assertCan } from "@/modules/identity/policy";
import { monthlyPnl } from "./pnl";

export const EXPORT_KINDS = ["pnl", "sales", "purchases", "payments", "expenses", "crew-pay", "advances"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];
export const EXPORT_LABELS: Record<ExportKind, string> = { pnl: "Monthly profit and loss", sales: "Sales register (client GST invoices)", purchases: "Purchase register (vendor invoices)", payments: "Payments in and out", expenses: "Expenses", "crew-pay": "Crew pay by booking", advances: "Cash advances" };

const ymd = /^\d{4}-\d{2}-\d{2}$/;
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const MONEY_FMT = '#,##,##0.00;[Red]-#,##,##0.00';

function sheet(wb: ExcelJS.Workbook, name: string, columns: { header: string; key: string; width: number; money?: boolean }[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width, style: c.money ? { numFmt: MONEY_FMT } : {} }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F0E3" } };
  return ws;
}

export async function buildExport(db: Db, actor: Actor, kind: string, from: string, to: string, meta: RequestMeta = {}): Promise<{ filename: string; buffer: Buffer }> {
  if (actor.accountType !== "INTERNAL") throw new ForbiddenError();
  assertCan(actor, "reports.finance", "Only hosts and the accountant export the books.");
  if (!(EXPORT_KINDS as readonly string[]).includes(kind)) throw new ValidationError("Unknown export.");
  if (!ymd.test(from) || !ymd.test(to) || from > to) throw new ValidationError("Pick a date range.");
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Taamara Taamara";
  wb.created = new Date();
  let rows = 0;

  if (kind === "pnl") {
    const pnl = await monthlyPnl(db, actor, { from: from.slice(0, 7), to: to.slice(0, 7) });
    const ws = sheet(wb, "Monthly P&L", [
      { header: "Month", key: "month", width: 10 },
      { header: "Bookings", key: "bookings", width: 9 },
      { header: "Settled", key: "settled", width: 8 },
      { header: "Billed (before GST)", key: "billed", width: 15, money: true },
      { header: "Vendor costs", key: "vendorCost", width: 14, money: true },
      { header: "Crew pay", key: "crewCost", width: 12, money: true },
      { header: "Booking expenses", key: "expenseCost", width: 13, money: true },
      { header: "Margin before tax", key: "margin", width: 15, money: true },
      { header: "Office expenses", key: "officeCost", width: 13, money: true },
      { header: "After office costs", key: "afterOffice", width: 15, money: true },
      { header: "Received (by payment date)", key: "received", width: 16, money: true },
      { header: "Paid out (by payment date)", key: "paidOut", width: 16, money: true },
      { header: "Net cash", key: "net", width: 14, money: true },
    ]);
    for (const m of pnl.months) ws.addRow(m);
    ws.addRow(pnl.total).font = { bold: true };
    const bs = sheet(wb, "Bookings", [
      { header: "Month", key: "month", width: 10 },
      { header: "Booking", key: "booking", width: 34 },
      { header: "Status", key: "status", width: 11 },
      { header: "Billed (before GST)", key: "billed", width: 15, money: true },
      { header: "GST billed", key: "gst", width: 12, money: true },
      { header: "Received", key: "received", width: 14, money: true },
      { header: "Vendor costs", key: "vendorCost", width: 14, money: true },
      { header: "Crew pay", key: "crewCost", width: 12, money: true },
      { header: "Expenses", key: "expenseCost", width: 12, money: true },
      { header: "Paid out", key: "paidOut", width: 14, money: true },
      { header: "Margin before tax", key: "margin", width: 15, money: true },
    ]);
    for (const b of pnl.bookings) bs.addRow({ ...b, booking: `${b.code} ${b.name}` });
    rows = pnl.months.length;
  } else if (kind === "sales") {
    const ws = sheet(wb, "Sales", [
      { header: "Invoice date", key: "date", width: 13 },
      { header: "Invoice no.", key: "number", width: 17 },
      { header: "Client", key: "client", width: 28 },
      { header: "Client GSTIN", key: "gstin", width: 18 },
      { header: "Place of supply", key: "pos", width: 18 },
      { header: "B2B / B2C", key: "b2x", width: 9 },
      { header: "Type", key: "type", width: 11 },
      { header: "Taxable", key: "taxable", width: 14, money: true },
      { header: "CGST", key: "cgst", width: 12, money: true },
      { header: "SGST", key: "sgst", width: 12, money: true },
      { header: "IGST", key: "igst", width: 12, money: true },
      { header: "Total", key: "total", width: 14, money: true },
      { header: "Status", key: "status", width: 11 },
      { header: "Booking", key: "booking", width: 28 },
      { header: "Cancelled because", key: "reason", width: 28 },
    ]);
    const list = await db.clientInvoice.findMany({
      where: { status: { not: "DRAFT" }, issueDate: { gte: start, lte: end } },
      orderBy: [{ issueDate: "asc" }, { number: "asc" }],
      include: { event: { select: { code: true, name: true } } },
    });
    for (const i of list) {
      const r = (i.recipient ?? {}) as { name?: string; gstin?: string | null };
      const cancelled = i.status === "CANCELLED";
      // Cancelled invoices keep their number in the register, with nothing to report.
      const amt = (d: unknown) => (cancelled ? 0 : toNumber(d as number));
      ws.addRow({ date: day(i.issueDate), number: i.number, client: r.name ?? "", gstin: r.gstin ?? "", pos: i.placeOfSupply ? `${i.placeOfSupply}-${stateName(i.placeOfSupply) ?? ""}` : "", b2x: r.gstin ? "B2B" : "B2C", type: i.type, taxable: amt(i.subtotal), cgst: amt(i.cgst), sgst: amt(i.sgst), igst: amt(i.igst), total: amt(i.total), status: i.status, booking: `${i.event.code} ${i.event.name}`, reason: i.cancelReason ?? "" });
    }
    rows = list.length;
  } else if (kind === "purchases") {
    const ws = sheet(wb, "Purchases", [
      { header: "Invoice date", key: "date", width: 13 },
      { header: "Vendor", key: "vendor", width: 28 },
      { header: "GSTIN", key: "gstin", width: 18 },
      { header: "Invoice no.", key: "number", width: 16 },
      { header: "Taxable", key: "taxable", width: 14, money: true },
      { header: "GST", key: "gst", width: 12, money: true },
      { header: "Total", key: "total", width: 14, money: true },
      { header: "Status", key: "status", width: 12 },
      { header: "Work order", key: "wo", width: 14 },
      { header: "Booking", key: "booking", width: 28 },
    ]);
    const list = await db.vendorInvoice.findMany({
      where: { invoiceDate: { gte: start, lte: end }, status: { not: "VOID" } },
      orderBy: [{ invoiceDate: "asc" }, { invoiceNumber: "asc" }],
      include: { vendor: { select: { companyName: true, gstin: true } }, workOrder: { select: { number: true, assignment: { select: { event: { select: { code: true, name: true } } } } } } },
    });
    for (const i of list) ws.addRow({ date: day(i.invoiceDate), vendor: i.vendor.companyName, gstin: i.vendor.gstin ?? "", number: i.invoiceNumber, taxable: toNumber(i.taxableAmount), gst: toNumber(i.gstAmount), total: toNumber(i.total), status: i.status, wo: i.workOrder?.number ?? "", booking: i.workOrder ? `${i.workOrder.assignment.event.code} ${i.workOrder.assignment.event.name}` : "" });
    rows = list.length;
  } else if (kind === "payments") {
    const ws = sheet(wb, "Payments", [
      { header: "Date", key: "date", width: 12 },
      { header: "In / out", key: "dir", width: 8 },
      { header: "Party", key: "party", width: 28 },
      { header: "Party type", key: "ptype", width: 10 },
      { header: "Booking", key: "booking", width: 28 },
      { header: "Against", key: "against", width: 16 },
      { header: "Method", key: "method", width: 9 },
      { header: "Reference", key: "ref", width: 18 },
      { header: "Amount", key: "amount", width: 14, money: true },
      { header: "TDS by client", key: "tds", width: 12, money: true },
      { header: "Status", key: "status", width: 10 },
      { header: "Note", key: "note", width: 30 },
    ]);
    const list = await db.payment.findMany({
      where: { OR: [{ paidOn: { gte: start, lte: end } }, { paidOn: null, createdAt: { gte: new Date(`${from}T00:00:00+05:30`), lte: new Date(`${to}T23:59:59+05:30`) } }] },
      orderBy: [{ paidOn: "asc" }, { createdAt: "asc" }],
      include: { vendor: { select: { companyName: true } }, worker: { select: { name: true } }, client: { select: { name: true } }, event: { select: { code: true, name: true } }, vendorInvoice: { select: { invoiceNumber: true } } },
    });
    for (const p of list)
      ws.addRow({
        date: day(p.paidOn) || day(p.createdAt),
        dir: p.direction,
        party: p.vendor?.companyName ?? p.worker?.name ?? p.client?.name ?? p.partyName ?? "",
        ptype: p.partyType,
        booking: p.event ? `${p.event.code} ${p.event.name}` : "",
        against: p.vendorInvoice?.invoiceNumber ?? "",
        method: p.method,
        ref: p.reference ?? "",
        amount: (p.direction === "OUT" ? -1 : 1) * toNumber(p.amount),
        tds: toNumber(p.tdsAmount),
        status: p.status,
        note: [p.note, p.voidReason ? `Void: ${p.voidReason}` : null].filter(Boolean).join(" · "),
      });
    rows = list.length;
  } else if (kind === "expenses") {
    const ws = sheet(wb, "Expenses", [
      { header: "Date", key: "date", width: 12 },
      { header: "Booking", key: "booking", width: 28 },
      { header: "Kind", key: "kind", width: 18 },
      { header: "What", key: "what", width: 34 },
      { header: "Recorded by", key: "who", width: 18 },
      { header: "Paid by", key: "via", width: 12 },
      { header: "Amount", key: "amount", width: 12, money: true },
      { header: "Status", key: "status", width: 12 },
      { header: "Receipt", key: "receipt", width: 9 },
    ]);
    const list = await db.expense.findMany({ where: { spentOn: { gte: start, lte: end } }, orderBy: { spentOn: "asc" }, include: { category: { select: { name: true } }, event: { select: { code: true, name: true } } } });
    const people = await db.user.findMany({ where: { id: { in: list.map((e) => e.submittedById).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } });
    for (const e of list) ws.addRow({ date: day(e.spentOn), booking: e.event ? `${e.event.code} ${e.event.name}` : "Company", kind: e.category.name, what: e.description, who: people.find((p) => p.id === e.submittedById)?.name ?? "", via: e.paidVia === "OWN_POCKET" ? "Own pocket" : e.paidVia === "CASH_ADVANCE" ? "Cash advance" : "Company", amount: toNumber(e.amount), status: e.status, receipt: e.receiptFileId ? "Yes" : "No" });
    rows = list.length;
  } else if (kind === "advances") {
    const ws = sheet(wb, "Cash advances", [
      { header: "Given on", key: "givenOn", width: 12 },
      { header: "Holder", key: "holder", width: 22 },
      { header: "Booking", key: "booking", width: 30 },
      { header: "For", key: "purpose", width: 32 },
      { header: "How", key: "method", width: 8 },
      { header: "Reference", key: "reference", width: 16 },
      { header: "Given", key: "amount", width: 12, money: true },
      { header: "Spent (approved)", key: "spent", width: 13, money: true },
      { header: "Spent (waiting)", key: "waiting", width: 13, money: true },
      { header: "Returned", key: "returned", width: 12, money: true },
      { header: "Left / shortfall", key: "left", width: 13, money: true },
      { header: "Status", key: "status", width: 12 },
      { header: "Closed on", key: "closedOn", width: 12 },
      { header: "Note", key: "note", width: 30 },
    ]);
    const list = await db.cashAdvance.findMany({
      where: { status: { in: ["GIVEN", "CLOSED", "VOIDED"] }, givenOn: { gte: start, lte: end } },
      orderBy: { givenOn: "asc" },
      include: { user: { select: { name: true } }, event: { select: { code: true, name: true } }, expenses: { where: { status: { not: "REJECTED" } }, select: { amount: true, status: true } } },
    });
    for (const a of list) {
      const spent = a.expenses.filter((e) => e.status !== "SUBMITTED").reduce((s, e) => s + toNumber(e.amount), 0);
      const waiting = a.expenses.filter((e) => e.status === "SUBMITTED").reduce((s, e) => s + toNumber(e.amount), 0);
      const left = a.status === "VOIDED" ? 0 : toNumber(a.amount) - spent - waiting - toNumber(a.returnedAmount);
      ws.addRow({ givenOn: day(a.givenOn), holder: a.user.name, booking: a.event ? `${a.event.code} ${a.event.name}` : "Company", purpose: a.purpose, method: a.method, reference: a.reference ?? "", amount: toNumber(a.amount), spent, waiting, returned: toNumber(a.returnedAmount), left, status: a.status, closedOn: day(a.settledAt), note: a.closeNote ?? a.voidReason ?? "" });
    }
    rows = list.length;
  } else {
    const ws = sheet(wb, "Crew pay", [
      { header: "Booking", key: "booking", width: 30 },
      { header: "First day", key: "date", width: 12 },
      { header: "Crew member", key: "name", width: 22 },
      { header: "Duty", key: "duty", width: 24 },
      { header: "Agreed", key: "agreed", width: 11, money: true },
      { header: "Extras − deductions", key: "extras", width: 12, money: true },
      { header: "Total", key: "total", width: 11, money: true },
      { header: "Paid", key: "paid", width: 11, money: true },
      { header: "Still owed", key: "owed", width: 11, money: true },
    ]);
    const list = await db.crewAssignment.findMany({
      where: { status: { in: ["CONFIRMED", "COMPLETED", "NO_SHOW"] }, event: { startDate: { gte: start, lte: end } } },
      orderBy: [{ event: { startDate: "asc" } }, { createdAt: "asc" }],
      include: { event: { select: { code: true, name: true, startDate: true } }, worker: { select: { name: true } }, adjustments: { where: { state: "APPROVED" }, select: { type: true, amount: true } }, payments: { where: { status: "PAID" }, select: { amount: true } } },
    });
    for (const a of list) {
      const extras = a.adjustments.reduce((s, x) => s + (x.type === "EXTRA" ? 1 : -1) * toNumber(x.amount), 0);
      const total = toNumber(a.agreedPay) + extras;
      const paid = a.payments.reduce((s, p) => s + toNumber(p.amount), 0);
      ws.addRow({ booking: `${a.event.code} ${a.event.name}`, date: day(a.event.startDate), name: a.worker.name, duty: a.duty, agreed: toNumber(a.agreedPay), extras, total, paid, owed: total - paid });
    }
    rows = list.length;
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  await recordAudit(db, actor, { action: "export", entityType: "report", entityId: kind, summary: `Exported ${EXPORT_LABELS[kind as ExportKind].toLowerCase()} for ${from} to ${to} (${rows} rows)`, financial: true }, meta);
  return { filename: `taamara-${kind}-${from}-to-${to}.xlsx`, buffer };
}
