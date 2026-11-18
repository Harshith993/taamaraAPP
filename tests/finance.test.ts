import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideApproval } from "@/modules/approvals/service";
import { bookingLedger, moneyOverview } from "@/modules/finance/overview";
import { addCharge, crewOwed, invoiceBalance, markPaid, preparePayment, recordReceipt, requestAdjustment, voidPayment } from "@/modules/finance/payments";
import { loadActor, type Actor } from "@/modules/identity/actor";
import { makeEvent, makeUser, makeVendor, makeWorker, testDb } from "./support/factories";

const actorOf = async (u: { id: string }) => (await loadActor(testDb, u.id))!;
let owner: Actor, manager: Actor, supervisor: Actor, accountant: Actor, vendor: Actor;
let eventId: string, invoiceId: string, jobId: string, crewId: string;
const today = new Date().toISOString().slice(0, 10);

async function approvalFor(paymentOrAdjId: string) {
  return testDb.approvalRequest.findFirstOrThrow({ where: { entityId: paymentOrAdjId, state: "PENDING" } });
}

beforeAll(async () => {
  owner = await actorOf(await makeUser({ name: "FN Owner", roleKey: "OWNER" }));
  const m = await makeUser({ name: "FN Manager", roleKey: "EVENT_MANAGER" });
  const s = await makeUser({ name: "FN Supervisor", roleKey: "SUPERVISOR" });
  accountant = await actorOf(await makeUser({ name: "FN Accountant", roleKey: "ACCOUNTANT" }));
  const ev = await makeEvent({ name: "FN Wedding" });
  eventId = ev.id;
  await testDb.eventMember.createMany({ data: [{ eventId, userId: m.id, role: "MANAGER" }, { eventId, userId: s.id, role: "SUPERVISOR" }] });
  manager = await actorOf(m);
  supervisor = await actorOf(s);
  const v = await makeVendor("FN Decor");
  const vu = await makeUser({ name: "FN Decor login", roleKey: "VENDOR", accountType: "VENDOR" });
  await testDb.vendorUser.create({ data: { vendorId: v.id, userId: vu.id } });
  vendor = await actorOf(vu);
  const job = await testDb.vendorAssignment.create({ data: { eventId, vendorId: v.id, scopeOfWork: "Mandap", status: "DELIVERED", agreedAmount: 59000 } });
  jobId = job.id;
  const q = await testDb.quotation.create({ data: { assignmentId: job.id, vendorId: v.id, version: 1, status: "APPROVED", subtotal: 50000, taxAmount: 9000, total: 59000 } });
  const wo = await testDb.workOrder.create({ data: { number: `WO-F-${Date.now()}`, assignmentId: job.id, quotationId: q.id, amount: 59000, status: "ACKNOWLEDGED" } });
  invoiceId = (await testDb.vendorInvoice.create({ data: { vendorId: v.id, workOrderId: wo.id, invoiceNumber: "FD/1", invoiceDate: new Date(), taxableAmount: 50000, gstAmount: 9000, total: 59000, status: "VERIFIED" } })).id;
  const w = await makeWorker("FN Sunil");
  crewId = (await testDb.crewAssignment.create({ data: { eventId, workerId: w.id, duty: "Drapes", agreedPay: 900, status: "CONFIRMED" } })).id;
});
afterAll(() => testDb.$disconnect());

describe("paying a vendor", () => {
  let first: string;

  it("the accountant prepares a part payment; managers can't; never more than is left", async () => {
    await expect(preparePayment(testDb, manager, { kind: "VENDOR_INVOICE", invoiceId, amount: 1000 })).rejects.toThrow(/can't prepare payments/);
    await expect(preparePayment(testDb, accountant, { kind: "VENDOR_INVOICE", invoiceId, amount: 60000 })).rejects.toThrow(/more than is left/);
    first = (await preparePayment(testDb, accountant, { kind: "VENDOR_INVOICE", invoiceId, amount: 30000, note: "Advance" })).id;
    expect((await invoiceBalance(testDb, invoiceId)).left).toBe(29000);
    await expect(preparePayment(testDb, accountant, { kind: "VENDOR_INVOICE", invoiceId, amount: 29500 })).rejects.toThrow(/more than is left/);
    expect(await testDb.notification.count({ where: { userId: owner.userId, type: "approval.requested", entityId: first } })).toBe(1);
  });

  it("is paid only after an owner approves, with a reference", async () => {
    await expect(markPaid(testDb, accountant, first, { method: "BANK", reference: "UTR1", paidOn: today })).rejects.toThrow(/approve this payment first/);
    await decideApproval(testDb, owner, (await approvalFor(first)).id, "APPROVE", undefined);
    await expect(markPaid(testDb, accountant, first, { method: "BANK", paidOn: today })).rejects.toThrow(/reference/);
    await expect(markPaid(testDb, accountant, first, { method: "BANK", reference: "UTR1", paidOn: "2099-01-01" })).rejects.toThrow(/future/);
    await expect(markPaid(testDb, manager, first, { method: "BANK", reference: "UTR1", paidOn: today })).rejects.toThrow(/can't mark payments/);
    await markPaid(testDb, accountant, first, { method: "BANK", reference: "UTR1", paidOn: today });
    expect((await testDb.vendorInvoice.findUniqueOrThrow({ where: { id: invoiceId } })).status).toBe("PART_PAID");
    expect(await testDb.notification.count({ where: { userId: vendor.userId, type: "payment.paid" } })).toBe(1);
  });

  it("a paid payment can only be voided, with a reason; the invoice goes back", async () => {
    await expect(voidPayment(testDb, accountant, first, " ")).rejects.toThrow(/Write why/);
    await expect(testDb.payment.update({ where: { id: first }, data: { amount: 1 } })).rejects.toThrow(/cannot be edited/);
    await voidPayment(testDb, accountant, first, "Paid to the wrong account");
    expect((await testDb.payment.findUniqueOrThrow({ where: { id: first } })).status).toBe("VOIDED");
    expect((await testDb.vendorInvoice.findUniqueOrThrow({ where: { id: invoiceId } })).status).toBe("VERIFIED");
    await expect(voidPayment(testDb, accountant, first, "again")).rejects.toThrow(/already closed/);
  });

  it("the final payment needs approved proof of the work", async () => {
    const all = (await preparePayment(testDb, accountant, { kind: "VENDOR_INVOICE", invoiceId, amount: 59000 })).id;
    await expect(decideApproval(testDb, owner, (await approvalFor(all)).id, "APPROVE", undefined)).rejects.toThrow(/no proof of this vendor's work/);
    const f = await testDb.file.create({ data: { storageKey: `proof/test/fn-${Date.now()}/original`, filename: "p.jpg", mimeType: "image/jpeg", sizeBytes: 1, purpose: "PROOF", status: "READY" } });
    await testDb.workProof.create({ data: { eventId, vendorAssignmentId: jobId, kind: "PHOTO", fileId: f.id, uploadedById: vendor.userId, status: "APPROVED" } });
    await decideApproval(testDb, owner, (await approvalFor(all)).id, "APPROVE", undefined);
    await markPaid(testDb, accountant, all, { method: "UPI", reference: "UPI-99", paidOn: today });
    expect((await testDb.vendorInvoice.findUniqueOrThrow({ where: { id: invoiceId } })).status).toBe("PAID");
    await expect(preparePayment(testDb, accountant, { kind: "VENDOR_INVOICE", invoiceId, amount: 1 })).rejects.toThrow(/can't be paid|Nothing is left/);
  });
});

describe("crew pay", () => {
  it("the supervisor asks for an extra; once approved it is owed and can be paid, never more", async () => {
    const adj = await requestAdjustment(testDb, supervisor, { assignmentId: crewId, type: "EXTRA", amount: 300, reason: "Late night after the Sangeet" });
    expect((await crewOwed(testDb, crewId)).total).toBe(900);
    await decideApproval(testDb, owner, (await approvalFor(adj.id)).id, "APPROVE", undefined);
    const owed = await crewOwed(testDb, crewId);
    expect(owed.total).toBe(1200);
    await expect(preparePayment(testDb, accountant, { kind: "CREW", assignmentId: crewId, amount: 1300 })).rejects.toThrow(/more than is left/);
    const p = (await preparePayment(testDb, accountant, { kind: "CREW", assignmentId: crewId, amount: 1200 })).id;
    expect((await crewOwed(testDb, crewId)).left).toBe(0);
    await decideApproval(testDb, owner, (await approvalFor(p)).id, "APPROVE", undefined);
    await markPaid(testDb, accountant, p, { method: "CASH", paidOn: today });
    expect((await crewOwed(testDb, crewId)).paid).toBe(1200);
    await expect(requestAdjustment(testDb, accountant, { assignmentId: crewId, type: "EXTRA", amount: 100, reason: "Tea" })).rejects.toThrow(/can't ask for crew extras/);
  });
});

describe("client money and what each person sees", () => {
  it("owners set charges, the accountant records receipts; managers do neither", async () => {
    await expect(addCharge(testDb, manager, { eventId, description: "Package", amount: 100000, gstRate: 18 })).rejects.toThrow(/Only owners and the accountant/);
    await addCharge(testDb, owner, { eventId, description: "Wedding package", amount: 200000, gstRate: 18 });
    await expect(recordReceipt(testDb, manager, { eventId, amount: 50000, method: "UPI", paidOn: today })).rejects.toThrow(/can't record client payments/);
    await recordReceipt(testDb, accountant, { eventId, amount: 100000, method: "BANK", reference: "NEFT-1", paidOn: today });
    const forOwner = (await bookingLedger(testDb, owner, eventId))!;
    expect(forOwner.billed).toBe(200000);
    expect(forOwner.billedGst).toBe(36000);
    expect(forOwner.received).toBe(100000);
    expect(forOwner.clientBalance).toBe(136000);
    expect(forOwner.vendorCost).toBe(59000);
    expect(forOwner.crewCost).toBe(1200);
    expect(forOwner.margin).toBe(139800);
    expect(forOwner.paidOut).toBe(60200);
  });

  it("managers see costs but never client billing or margin; supervisors see nothing", async () => {
    const forManager = (await bookingLedger(testDb, manager, eventId))!;
    expect(forManager.billing).toBe(false);
    expect(forManager.charges).toEqual([]);
    expect(forManager.clientBalance).toBeNull();
    expect(forManager.margin).toBeNull();
    expect(forManager.payments.every((p) => p.direction === "OUT")).toBe(true);
    expect(forManager.vendorCost).toBe(59000);
    expect(await bookingLedger(testDb, supervisor, eventId)).toBeNull();
    await expect(moneyOverview(testDb, manager)).rejects.toThrow(/Only owners and the accountant/);
    const overview = await moneyOverview(testDb, accountant);
    const row = overview.bookings.find((b) => b.id === eventId)!;
    expect(row.margin).toBe(139800);
    expect(row.due).toBe(136000);
  });
});

describe("advances", () => {
  it("count towards what a vendor has been paid even without an invoice", async () => {
    const v = await testDb.vendorAssignment.findUniqueOrThrow({ where: { id: jobId } });
    await testDb.payment.create({ data: { direction: "OUT", eventId, partyType: "VENDOR", vendorId: v.vendorId, amount: 5000, method: "BANK", status: "PAID", paidOn: new Date(), note: "Advance" } });
    const row = (await bookingLedger(testDb, owner, eventId))!.vendors.find((x) => x.id === jobId)!;
    expect(row.paid).toBe(64000);
  });
});
