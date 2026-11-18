import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadActor, type Actor } from "@/modules/identity/actor";
import { invoicesForJob, listInvoices, reviewInvoice, submitInvoice, workOrderBalance } from "@/modules/vendors/invoices";
import { makeEvent, makeUser, makeVendor, testDb } from "./support/factories";

const actorOf = async (u: { id: string }) => (await loadActor(testDb, u.id))!;
let owner: Actor, manager: Actor, accountant: Actor, vendor: Actor, otherVendor: Actor;
let jobId: string, unbookedJobId: string, woId: string;
const today = new Date().toISOString().slice(0, 10);

let n = 0;
async function doc(actor: Actor) {
  return (await testDb.file.create({ data: { storageKey: `document/test/${Date.now()}-${n++}/original`, filename: "inv.pdf", mimeType: "application/pdf", sizeBytes: 100, purpose: "DOCUMENT", status: "READY", uploadedById: actor.userId } })).id;
}

beforeAll(async () => {
  owner = await actorOf(await makeUser({ name: "IN Owner", roleKey: "OWNER" }));
  manager = await actorOf(await makeUser({ name: "IN Manager", roleKey: "EVENT_MANAGER" }));
  accountant = await actorOf(await makeUser({ name: "IN Accountant", roleKey: "ACCOUNTANT" }));
  const ev = await makeEvent({ name: "IN Wedding" });
  await testDb.eventMember.create({ data: { eventId: ev.id, userId: manager.userId, role: "MANAGER" } });
  const v = await makeVendor("IN Lights");
  const v2 = await makeVendor("IN Decor");
  const vu = await makeUser({ name: "IN Lights login", roleKey: "VENDOR", accountType: "VENDOR" });
  const vu2 = await makeUser({ name: "IN Decor login", roleKey: "VENDOR", accountType: "VENDOR" });
  await testDb.vendorUser.createMany({ data: [{ vendorId: v.id, userId: vu.id }, { vendorId: v2.id, userId: vu2.id }] });
  vendor = await actorOf(vu);
  otherVendor = await actorOf(vu2);

  const job = await testDb.vendorAssignment.create({ data: { eventId: ev.id, vendorId: v.id, scopeOfWork: "Lights", status: "IN_PROGRESS", agreedAmount: 59000 } });
  const q = await testDb.quotation.create({ data: { assignmentId: job.id, vendorId: v.id, version: 1, status: "APPROVED", subtotal: 50000, taxAmount: 9000, total: 59000 } });
  woId = (await testDb.workOrder.create({ data: { number: `WO-T-${Date.now()}`, assignmentId: job.id, quotationId: q.id, amount: 59000, status: "ACKNOWLEDGED" } })).id;
  jobId = job.id;
  const unbooked = await testDb.vendorAssignment.create({ data: { eventId: ev.id, vendorId: v.id, scopeOfWork: "Generator", status: "APPROVED" } });
  const q2 = await testDb.quotation.create({ data: { assignmentId: unbooked.id, vendorId: v.id, version: 1, status: "APPROVED", subtotal: 1000, total: 1180 } });
  await testDb.workOrder.create({ data: { number: `WO-T2-${Date.now()}`, assignmentId: unbooked.id, quotationId: q2.id, amount: 1180, status: "ISSUED" } });
  unbookedJobId = unbooked.id;
});
afterAll(() => testDb.$disconnect());

describe("sending an invoice", () => {
  it("the vendor invoices the advance; the accountant and owners are told", async () => {
    const r = await submitInvoice(testDb, vendor, jobId, { invoiceNumber: "INL/41", invoiceDate: today, taxableAmount: 25000, gstAmount: 4500, fileId: await doc(vendor) });
    expect(r.total).toBe(29500);
    expect(await testDb.notification.count({ where: { userId: { in: [accountant.userId, owner.userId] }, type: "invoice.received" } })).toBe(2);
    expect((await workOrderBalance(testDb, woId)).left).toBe(29500);
  });

  it("refuses more than the work order, repeated numbers, future dates and missing files", async () => {
    await expect(submitInvoice(testDb, vendor, jobId, { invoiceNumber: "INL/42", invoiceDate: today, taxableAmount: 30000, gstAmount: 5400, fileId: await doc(vendor) })).rejects.toThrow(/more than what is left/);
    await expect(submitInvoice(testDb, vendor, jobId, { invoiceNumber: "INL/41", invoiceDate: today, taxableAmount: 100, gstAmount: 18, fileId: await doc(vendor) })).rejects.toThrow(/already been sent/);
    await expect(submitInvoice(testDb, vendor, jobId, { invoiceNumber: "INL/43", invoiceDate: "2099-01-01", taxableAmount: 100, gstAmount: 18, fileId: await doc(vendor) })).rejects.toThrow(/future/);
    await expect(submitInvoice(testDb, vendor, jobId, { invoiceNumber: "INL/44", invoiceDate: today, taxableAmount: 100, gstAmount: 18, fileId: await doc(otherVendor) })).rejects.toThrow(/Attach the invoice/);
    await expect(submitInvoice(testDb, vendor, jobId, { invoiceNumber: "INL/45", invoiceDate: today, taxableAmount: 100, gstAmount: 50, fileId: await doc(vendor) })).rejects.toThrow(/GST looks too high/);
  });

  it("only for the vendor's own job with an accepted work order", async () => {
    await expect(submitInvoice(testDb, otherVendor, jobId, { invoiceNumber: "X1", invoiceDate: today, taxableAmount: 100, gstAmount: 18, fileId: await doc(otherVendor) })).rejects.toThrow(/not found/);
    await expect(submitInvoice(testDb, vendor, unbookedJobId, { invoiceNumber: "INL/46", invoiceDate: today, taxableAmount: 100, gstAmount: 18, fileId: await doc(vendor) })).rejects.toThrow(/work order is accepted/);
    await expect(submitInvoice(testDb, manager, jobId, { invoiceNumber: "M1", invoiceDate: today, taxableAmount: 100, gstAmount: 18, fileId: await doc(manager) })).rejects.toThrow(/can't send invoices/);
  });

  it("the accountant can enter a paper invoice on the vendor's behalf", async () => {
    const r = await submitInvoice(testDb, accountant, jobId, { invoiceNumber: "INL/47-paper", invoiceDate: today, taxableAmount: 1000, gstAmount: 180, fileId: await doc(accountant) });
    expect(r.total).toBe(1180);
  });
});

describe("checking invoices", () => {
  it("the accountant verifies; managers and vendors can't check", async () => {
    const inv = await testDb.vendorInvoice.findFirstOrThrow({ where: { invoiceNumber: "INL/41" } });
    await expect(reviewInvoice(testDb, manager, inv.id, { decision: "VERIFY" })).rejects.toThrow(/can't check invoices/);
    await expect(reviewInvoice(testDb, vendor, inv.id, { decision: "VERIFY" })).rejects.toThrow(/Only the office/);
    await reviewInvoice(testDb, accountant, inv.id, { decision: "VERIFY" });
    expect((await testDb.vendorInvoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("VERIFIED");
    expect(await testDb.notification.count({ where: { userId: vendor.userId, type: "invoice.verified" } })).toBe(1);
    await expect(reviewInvoice(testDb, accountant, inv.id, { decision: "VERIFY" })).rejects.toThrow(/already verified/);
  });

  it("a disputed invoice tells the vendor why and stops counting; a void one needs a reason", async () => {
    const paper = await testDb.vendorInvoice.findFirstOrThrow({ where: { invoiceNumber: "INL/47-paper" } });
    await expect(reviewInvoice(testDb, accountant, paper.id, { decision: "DISPUTE" })).rejects.toThrow(/Tell the vendor/);
    await reviewInvoice(testDb, accountant, paper.id, { decision: "DISPUTE", note: "GSTIN missing" });
    const note = await testDb.notification.findFirstOrThrow({ where: { userId: vendor.userId, type: "invoice.disputed" } });
    expect(note.body).toBe("GSTIN missing");
    expect((await workOrderBalance(testDb, woId)).invoiced).toBe(29500);
    await expect(reviewInvoice(testDb, accountant, paper.id, { decision: "VOID" })).rejects.toThrow(/why it is void/);
    await reviewInvoice(testDb, accountant, paper.id, { decision: "VOID", note: "Entered twice" });
    await expect(reviewInvoice(testDb, accountant, paper.id, { decision: "VERIFY" })).rejects.toThrow(/void/);
    await expect(testDb.vendorInvoice.delete({ where: { id: paper.id } })).rejects.toThrow(/never deleted/);
  });

  it("the balance can then be invoiced; the office list shows what is invoiced per work order", async () => {
    await submitInvoice(testDb, vendor, jobId, { invoiceNumber: "INL/48", invoiceDate: today, taxableAmount: 25000, gstAmount: 4500, fileId: await doc(vendor) });
    expect((await workOrderBalance(testDb, woId)).left).toBe(0);
    const list = await listInvoices(testDb, accountant, { status: "all" });
    const mine = list.filter((i) => i.workOrder?.id === woId);
    expect(mine.every((i) => i.workOrder!.invoiced === 59000)).toBe(true);
    expect(mine.find((i) => i.number === "INL/48")?.file?.originalUrl).toMatch(/\/original\?/);
    expect(await listInvoices(testDb, manager)).toEqual([]);
    expect((await invoicesForJob(testDb, vendor, jobId)).length).toBe(3);
    expect(await invoicesForJob(testDb, otherVendor, jobId)).toEqual([]);
  });
});
