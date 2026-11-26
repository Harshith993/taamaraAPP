import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideApproval } from "@/modules/approvals/service";
import { buildExport } from "@/modules/finance/exports";
import { markRepaid, submitExpense } from "@/modules/finance/expenses";
import { addCharge, markPaid, preparePayment, recordReceipt, removeCharge, requestAdjustment, voidPayment } from "@/modules/finance/payments";
import { financialYearOf, fyMonths, monthlyPnl, monthsBetween } from "@/modules/finance/pnl";
import { reopenBooking, settleBooking, settlementView } from "@/modules/finance/settlement";
import { loadActor, type Actor } from "@/modules/identity/actor";
import { makeEvent, makeReceipt, makeUser, makeVendor, makeWorker, testDb } from "./support/factories";

const actorOf = async (u: { id: string }) => (await loadActor(testDb, u.id))!;
let owner: Actor, owner2: Actor, accountant: Actor, manager: Actor;
let eventId: string, invoiceId: string, crewId: string, vendorId: string, jobId: string, tea: string;
// A past month of its own, so other test files' money doesn't mix into the P&L figures.
const DAY = "2025-02-20";

const approve = async (entityId: string) => decideApproval(testDb, owner, (await testDb.approvalRequest.findFirstOrThrow({ where: { entityId, state: "PENDING" } })).id, "APPROVE", undefined);
const blocking = async () => (await settlementView(testDb, owner, eventId))!.checks.filter((c) => !c.ok && c.level === "block").map((c) => c.key);

beforeAll(async () => {
  owner = await actorOf(await makeUser({ name: "ST Owner", roleKey: "OWNER" }));
  owner2 = await actorOf(await makeUser({ name: "ST Co-founder", roleKey: "OWNER" }));
  accountant = await actorOf(await makeUser({ name: "ST Accountant", roleKey: "ACCOUNTANT" }));
  const m = await makeUser({ name: "ST Manager", roleKey: "EVENT_MANAGER" });
  const ev = await makeEvent({ name: "ST Sangeet" });
  eventId = ev.id;
  await testDb.event.update({ where: { id: eventId }, data: { status: "LIVE", startDate: new Date(`${DAY}T00:00:00Z`), endDate: new Date(`${DAY}T00:00:00Z`) } });
  await testDb.eventMember.create({ data: { eventId, userId: m.id, role: "MANAGER" } });
  manager = await actorOf(m);
  const v = await makeVendor("ST Sound");
  vendorId = v.id;
  const job = await testDb.vendorAssignment.create({ data: { eventId, vendorId, scopeOfWork: "DJ and sound", status: "DELIVERED", agreedAmount: 23600 } });
  jobId = job.id;
  const q = await testDb.quotation.create({ data: { assignmentId: job.id, vendorId, version: 1, status: "APPROVED", subtotal: 20000, taxAmount: 3600, total: 23600 } });
  const wo = await testDb.workOrder.create({ data: { number: `WO-ST-${Date.now()}`, assignmentId: job.id, quotationId: q.id, amount: 23600, status: "ACKNOWLEDGED" } });
  invoiceId = (await testDb.vendorInvoice.create({ data: { vendorId, workOrderId: wo.id, invoiceNumber: "STS/7", invoiceDate: new Date(`${DAY}T00:00:00Z`), taxableAmount: 20000, gstAmount: 3600, total: 23600, status: "SUBMITTED" } })).id;
  const f = await testDb.file.create({ data: { storageKey: `proof/test/st-${Date.now()}/original`, filename: "p.jpg", mimeType: "image/jpeg", sizeBytes: 1, purpose: "PROOF", status: "READY" } });
  await testDb.workProof.create({ data: { eventId, vendorAssignmentId: jobId, kind: "PHOTO", fileId: f.id, uploadedById: owner.userId, status: "APPROVED" } });
  const w = await makeWorker("ST Raju");
  crewId = (await testDb.crewAssignment.create({ data: { eventId, workerId: w.id, duty: "Lights", agreedPay: 1000, status: "CONFIRMED" } })).id;
  // A no-show is listed but not a cost.
  await testDb.crewAssignment.create({ data: { eventId, workerId: (await makeWorker("ST No-show")).id, duty: "Lights", agreedPay: 700, status: "NO_SHOW" } });
  tea = (await testDb.expenseCategory.findFirstOrThrow({ where: { group: "FOOD" } })).id;
  await addCharge(testDb, accountant, { eventId, description: "Sangeet package", amount: 50000, gstRate: 18 });
});
afterAll(() => testDb.$disconnect());

describe("the settlement checklist", () => {
  it("is for people who see client billing; managers don't get it", async () => {
    expect(await settlementView(testDb, manager, eventId)).toBeNull();
    const a = await settlementView(testDb, accountant, eventId);
    expect(a?.canSettle).toBe(false);
    expect((await settlementView(testDb, owner, eventId))?.canSettle).toBe(true);
  });

  it("lists everything still open", async () => {
    const s = (await settlementView(testDb, owner, eventId))!;
    expect(s.ready).toBe(false);
    expect(await blocking()).toEqual(["completed", "client", "vendors", "crew"]);
    const details = s.checks.flatMap((c) => c.details).join(" | ");
    expect(details).toMatch(/still owes ₹59,000/);
    expect(details).toMatch(/isn't signed off/);
    expect(details).toMatch(/STS\/7 hasn't been checked/);
    expect(details).toMatch(/ST Raju: ₹1,000.00 still to pay/);
    expect(details).not.toMatch(/No-show/);
    expect(s.figures).toMatchObject({ billed: 50000, gst: 9000, vendorCost: 23600, crewCost: 1000, margin: 25400 });
  });

  it("can't be settled until it is clear, and only by an owner", async () => {
    await expect(settleBooking(testDb, accountant, eventId)).rejects.toThrow(/Only a host/);
    await expect(settleBooking(testDb, owner, eventId)).rejects.toThrow(/Not ready to settle/);
  });

  it("clears as the money is paid", async () => {
    await testDb.event.update({ where: { id: eventId }, data: { status: "COMPLETED" } });
    await testDb.vendorAssignment.update({ where: { id: jobId }, data: { status: "COMPLETED" } });
    await recordReceipt(testDb, accountant, { eventId, amount: 59000, method: "BANK", reference: "NEFT1", paidOn: DAY });
    await testDb.vendorInvoice.update({ where: { id: invoiceId }, data: { status: "VERIFIED" } });
    const vp = (await preparePayment(testDb, accountant, { kind: "VENDOR_INVOICE", invoiceId, amount: 23600 })).id;
    const cp = (await preparePayment(testDb, accountant, { kind: "CREW", assignmentId: crewId, amount: 1000 })).id;
    expect(await blocking()).toEqual(["vendors", "crew", "waiting"]);
    await approve(vp);
    await approve(cp);
    await markPaid(testDb, accountant, vp, { method: "BANK", reference: "UTR-ST", paidOn: DAY });
    await markPaid(testDb, accountant, cp, { method: "CASH", paidOn: DAY });
    expect(await blocking()).toEqual([]);
  });

  it("waits for crew extras, and for expenses to be approved and repaid", async () => {
    await requestAdjustment(testDb, manager, { assignmentId: crewId, type: "EXTRA", amount: 200, reason: "Stayed till 2 am" });
    const exp = (await submitExpense(testDb, manager, { eventId, categoryId: tea, description: "Tea for the crew", amount: 240, spentOn: DAY, receiptFileId: await makeReceipt(manager.userId) })).id;
    expect(await blocking()).toEqual(["crew", "expenses"]);
    await approve((await testDb.crewPayAdjustment.findFirstOrThrow({ where: { assignmentId: crewId } })).id);
    await approve(exp);
    const s = await settlementView(testDb, owner, eventId);
    expect(s!.checks.find((c) => c.key === "crew")!.details.join()).toMatch(/₹200.00 still to pay/);
    expect(s!.checks.find((c) => c.key === "expenses")!.details.join()).toMatch(/not yet repaid/);
    const extra = (await preparePayment(testDb, accountant, { kind: "CREW", assignmentId: crewId, amount: 200 })).id;
    await approve(extra);
    await markPaid(testDb, accountant, extra, { method: "UPI", reference: "UPI-ST", paidOn: DAY });
    await markRepaid(testDb, accountant, exp, { method: "CASH" });
    expect(await blocking()).toEqual([]);
    expect((await settlementView(testDb, owner, eventId))!.ready).toBe(true);
  });
});

describe("settling", () => {
  it("an owner settles: figures are stored, people are told, it is audited", async () => {
    const r = await settleBooking(testDb, owner, eventId, { note: "All square" });
    // 50,000 billed − 23,600 vendor − 1,200 crew − 240 tea.
    expect(r.figures.margin).toBe(24960);
    const ev = await testDb.event.findUniqueOrThrow({ where: { id: eventId } });
    expect(ev.status).toBe("SETTLED");
    expect(ev.settledById).toBe(owner.userId);
    expect(ev.settlementSnapshot).toMatchObject({ margin: 24960, received: 59000, note: "All square" });
    expect(await testDb.notification.count({ where: { userId: owner2.userId, type: "booking.settled", entityId: eventId } })).toBe(1);
    const mgr = await testDb.notification.findFirstOrThrow({ where: { userId: manager.userId, type: "booking.settled", entityId: eventId } });
    expect(`${mgr.title} ${mgr.body ?? ""}`).not.toMatch(/₹/);
    expect(await testDb.auditLog.count({ where: { action: "settle", entityId: eventId, financial: true } })).toBe(1);
    const view = (await settlementView(testDb, accountant, eventId))!;
    expect(view.settled?.figures.margin).toBe(24960);
    expect(view.settled?.by).toBe("ST Owner");
    await expect(settleBooking(testDb, owner, eventId)).rejects.toThrow(/already settled/);
  });

  it("locks the money, in the services and in the database", async () => {
    await expect(addCharge(testDb, accountant, { eventId, description: "Extra hour", amount: 5000, gstRate: 18 })).rejects.toThrow(/settled/);
    await expect(recordReceipt(testDb, accountant, { eventId, amount: 10, method: "CASH", paidOn: DAY })).rejects.toThrow(/settled/);
    await expect(requestAdjustment(testDb, manager, { assignmentId: crewId, type: "EXTRA", amount: 100, reason: "Late night" })).rejects.toThrow(/settled/);
    await expect(submitExpense(testDb, manager, { eventId, categoryId: tea, description: "More tea", amount: 50, spentOn: DAY })).rejects.toThrow(/settled/);
    const paid = await testDb.payment.findFirstOrThrow({ where: { eventId, direction: "IN", status: "PAID" } });
    await expect(voidPayment(testDb, owner, paid.id, "Bounced")).rejects.toThrow(/settled/);
    const charge = await testDb.clientCharge.findFirstOrThrow({ where: { eventId } });
    await expect(removeCharge(testDb, accountant, charge.id)).rejects.toThrow(/settled/);
    // Straight to the database: the triggers refuse.
    await expect(testDb.payment.create({ data: { direction: "IN", eventId, partyType: "CLIENT", amount: 1, method: "CASH", status: "PAID" } })).rejects.toThrow(/settled/);
    await expect(testDb.clientCharge.delete({ where: { id: charge.id } })).rejects.toThrow(/settled/);
    await expect(testDb.crewPayAdjustment.create({ data: { assignmentId: crewId, type: "EXTRA", amount: 1, reason: "x" } })).rejects.toThrow(/settled/);
    await expect(testDb.vendorAssignment.create({ data: { eventId, vendorId, scopeOfWork: "More", status: "INVITED" } })).rejects.toThrow(/settled/);
    await expect(testDb.event.update({ where: { id: eventId }, data: { status: "LIVE" } })).rejects.toThrow(/only be reopened/);
  });

  it("an owner can reopen it with a reason; then money can change again", async () => {
    await expect(reopenBooking(testDb, accountant, eventId, { reason: "Corrected invoice" })).rejects.toThrow(/Only a host/);
    await expect(reopenBooking(testDb, owner2, eventId, { reason: "no" })).rejects.toThrow(/Say why/);
    await reopenBooking(testDb, owner2, eventId, { reason: "Client asked for an extra hour" });
    const ev = await testDb.event.findUniqueOrThrow({ where: { id: eventId } });
    expect(ev.status).toBe("COMPLETED");
    expect(ev.settledAt).toBeNull();
    expect(await testDb.auditLog.count({ where: { action: "reopen", entityId: eventId } })).toBe(1);
    expect(await testDb.notification.count({ where: { userId: owner.userId, type: "booking.reopened" } })).toBe(1);
    const c = await addCharge(testDb, accountant, { eventId, description: "Extra hour", amount: 5000, gstRate: 18 });
    expect(await blocking()).toEqual(["client"]);
    await removeCharge(testDb, accountant, c.id);
    await settleBooking(testDb, owner2, eventId);
  });
});

describe("monthly P&L", () => {
  it("financial years run April to March", () => {
    expect(financialYearOf("2026-11-18")).toBe(2026);
    expect(financialYearOf("2027-02-01")).toBe(2026);
    expect(fyMonths(2026)).toEqual({ from: "2026-04", to: "2027-03" });
    expect(monthsBetween("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(() => monthsBetween("2027-02", "2026-11")).toThrow(/range/);
    expect(() => monthsBetween("2020-01", "2026-01")).toThrow(/at most/);
  });

  it("puts a booking in the month of its first day, and cash by payment date", async () => {
    const office = await submitExpense(testDb, owner, { categoryId: tea, description: "Office tea", amount: 300, spentOn: "2025-02-03", paidVia: "COMPANY", receiptFileId: await makeReceipt(owner.userId) });
    await decideApproval(testDb, owner2, (await testDb.approvalRequest.findFirstOrThrow({ where: { entityId: office.id } })).id, "APPROVE", undefined);
    const p = await monthlyPnl(testDb, accountant, { from: "2025-01", to: "2025-03" });
    expect(p.months.map((m) => m.month)).toEqual(["2025-01", "2025-02", "2025-03"]);
    const feb = p.months[1];
    expect(feb).toMatchObject({ bookings: 1, settled: 1, billed: 50000, vendorCost: 23600, crewCost: 1200, expenseCost: 240, margin: 24960, officeCost: 300, afterOffice: 24660, received: 59000 });
    // Paid out by payment date: vendor and crew on DAY; the tea was repaid today, outside this range.
    expect(feb.paidOut).toBe(24800);
    expect(p.total.margin).toBe(24960);
    expect(p.bookings.find((b) => b.id === eventId)?.status).toBe("SETTLED");
    await expect(monthlyPnl(testDb, manager, { from: "2025-01", to: "2025-03" })).rejects.toThrow(/Only hosts and the accountant/);
  });

  it("exports to Excel with a sheet per month and per booking", async () => {
    const { filename, buffer } = await buildExport(testDb, owner, "pnl", "2025-02-01", "2025-02-28");
    expect(filename).toBe("taamara-pnl-2025-02-01-to-2025-02-28.xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const months = wb.getWorksheet("Monthly P&L")!.getSheetValues().slice(2).map((r) => (r as unknown[]).slice(1));
    expect(months[0][0]).toBe("2025-02");
    expect(months[0][7]).toBe(24960);
    const rows = wb.getWorksheet("Bookings")!.getSheetValues().slice(2).map((r) => (r as unknown[]).slice(1));
    expect(rows.some((r) => String(r[1]).includes("ST Sangeet"))).toBe(true);
  });
});
