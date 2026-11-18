import { afterAll, describe, expect, it } from "vitest";
import { makeEvent, makeFile, makeUser, makeVendor, makeWorker, testDb } from "../support/factories";

afterAll(() => testDb.$disconnect());

async function paidClientPayment() {
  const event = await makeEvent();
  const payment = await testDb.payment.create({
    data: { direction: "IN", eventId: event.id, partyType: "CLIENT", clientId: event.clientId, amount: 50000, method: "UPI", status: "PAID", paidOn: new Date() },
  });
  return { event, payment };
}

describe("payments are a ledger", () => {
  it("cannot be deleted", async () => {
    const { payment } = await paidClientPayment();
    await expect(testDb.payment.delete({ where: { id: payment.id } })).rejects.toThrow(/never deleted/);
  });

  it("cannot change the amount once paid", async () => {
    const { payment } = await paidClientPayment();
    await expect(testDb.payment.update({ where: { id: payment.id }, data: { amount: 60000 } })).rejects.toThrow(/cannot be edited/);
  });

  it("needs a reason to be voided, and is final once voided", async () => {
    const { payment } = await paidClientPayment();
    await expect(testDb.payment.update({ where: { id: payment.id }, data: { status: "VOIDED" } })).rejects.toThrow(/needs a reason/);
    await testDb.payment.update({ where: { id: payment.id }, data: { status: "VOIDED", voidReason: "Entered twice", voidedAt: new Date() } });
    await expect(testDb.payment.update({ where: { id: payment.id }, data: { note: "edit" } })).rejects.toThrow(/voided payment cannot be changed/);
  });

  it("may still change before it is paid", async () => {
    const event = await makeEvent();
    const vendor = await makeVendor();
    const p = await testDb.payment.create({ data: { direction: "OUT", eventId: event.id, partyType: "VENDOR", vendorId: vendor.id, amount: 1000, method: "BANK" } });
    const updated = await testDb.payment.update({ where: { id: p.id }, data: { amount: 1200 } });
    expect(updated.amount.toString()).toBe("1200");
  });

  it("must be positive and match its party", async () => {
    const event = await makeEvent();
    await expect(
      testDb.payment.create({ data: { direction: "IN", eventId: event.id, partyType: "CLIENT", clientId: event.clientId, amount: 0, method: "CASH" } }),
    ).rejects.toThrow(/payments_amount_positive/);
    await expect(
      testDb.payment.create({ data: { direction: "OUT", eventId: event.id, partyType: "VENDOR", amount: 100, method: "CASH" } }),
    ).rejects.toThrow(/payments_party_matches/);
    await expect(
      testDb.payment.create({ data: { direction: "IN", eventId: event.id, partyType: "VENDOR", vendorId: (await makeVendor()).id, amount: 100, method: "CASH" } }),
    ).rejects.toThrow(/payments_direction_matches_party/);
  });
});

describe("audit log", () => {
  it("is append-only", async () => {
    const entry = await testDb.auditLog.create({ data: { action: "create", entityType: "test", summary: "Test entry" } });
    await expect(testDb.auditLog.update({ where: { id: entry.id }, data: { summary: "changed" } })).rejects.toThrow(/cannot be changed/);
    await expect(testDb.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow(/cannot be changed/);
  });
});

describe("client invoices", () => {
  it("can be deleted only as drafts and are fixed once issued", async () => {
    const event = await makeEvent();
    const draft = await testDb.clientInvoice.create({ data: { eventId: event.id, clientId: event.clientId, type: "ADVANCE", subtotal: 100, total: 118, sgst: 9, cgst: 9 } });
    await testDb.clientInvoice.delete({ where: { id: draft.id } });

    const issued = await testDb.clientInvoice.create({
      data: { eventId: event.id, clientId: event.clientId, type: "ADVANCE", subtotal: 100, total: 118, number: `INV-T-${Date.now()}`, status: "DRAFT", items: { create: [{ description: "Advance", rate: 100, amount: 100 }] } },
    });
    await testDb.clientInvoice.update({ where: { id: issued.id }, data: { status: "ISSUED", issueDate: new Date() } });
    await expect(testDb.clientInvoice.update({ where: { id: issued.id }, data: { total: 200 } })).rejects.toThrow(/cannot be edited/);
    await expect(testDb.clientInvoice.delete({ where: { id: issued.id } })).rejects.toThrow(/cannot be deleted/);
    await expect(testDb.clientInvoiceItem.updateMany({ where: { invoiceId: issued.id }, data: { amount: 1 } })).rejects.toThrow(/issued invoice cannot be changed/);
    await expect(testDb.clientInvoice.update({ where: { id: issued.id }, data: { status: "CANCELLED" } })).rejects.toThrow(/needs a reason/);
    await testDb.clientInvoice.update({ where: { id: issued.id }, data: { status: "CANCELLED", cancelReason: "Wrong client" } });
  });
});

describe("vendor invoices and expenses", () => {
  it("vendor invoices are never deleted", async () => {
    const vendor = await makeVendor();
    const inv = await testDb.vendorInvoice.create({ data: { vendorId: vendor.id, invoiceNumber: `V-${Date.now()}`, invoiceDate: new Date(), taxableAmount: 100, total: 100 } });
    await expect(testDb.vendorInvoice.delete({ where: { id: inv.id } })).rejects.toThrow(/never deleted/);
  });

  it("approved expenses cannot be deleted, submitted ones can", async () => {
    const event = await makeEvent();
    const category = await testDb.expenseCategory.findFirstOrThrow();
    const submitted = await testDb.expense.create({ data: { eventId: event.id, categoryId: category.id, description: "Tea", amount: 200, spentOn: new Date() } });
    await testDb.expense.delete({ where: { id: submitted.id } });
    const approved = await testDb.expense.create({ data: { eventId: event.id, categoryId: category.id, description: "Diesel", amount: 900, spentOn: new Date(), status: "APPROVED" } });
    await expect(testDb.expense.delete({ where: { id: approved.id } })).rejects.toThrow(/cannot be deleted/);
  });
});

describe("work proof", () => {
  it("belongs to exactly one task or assignment", async () => {
    const event = await makeEvent();
    const uploader = await makeUser();
    const file = await makeFile(uploader.id);
    await expect(
      testDb.workProof.create({ data: { eventId: event.id, kind: "PHOTO", fileId: file.id, uploadedById: uploader.id } }),
    ).rejects.toThrow(/work_proofs_one_parent/);

    const worker = await makeWorker();
    const crew = await testDb.crewAssignment.create({ data: { eventId: event.id, workerId: worker.id, duty: "Helper", agreedPay: 700 } });
    const task = await testDb.task.create({ data: { eventId: event.id, title: "Drapes" } });
    await expect(
      testDb.workProof.create({ data: { eventId: event.id, kind: "PHOTO", fileId: file.id, uploadedById: uploader.id, taskId: task.id, crewAssignmentId: crew.id } }),
    ).rejects.toThrow(/work_proofs_one_parent/);
    const ok = await testDb.workProof.create({ data: { eventId: event.id, kind: "PHOTO", fileId: file.id, uploadedById: uploader.id, taskId: task.id } });
    expect(ok.status).toBe("PENDING_REVIEW");
  });
});

describe("single company profile", () => {
  it("allows only id 1", async () => {
    await expect(testDb.companyProfile.create({ data: { id: 2, legalName: "Other" } })).rejects.toThrow(/company_profile_single_row/);
  });
});
