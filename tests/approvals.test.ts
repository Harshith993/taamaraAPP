import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideApproval, listPendingApprovals } from "@/modules/approvals/service";
import { loadActor, type Actor } from "@/modules/identity/actor";
import { makeEvent, makeFile, makeUser, makeVendor, makeWorker, testDb } from "./support/factories";

let ownerA: Actor;
let ownerB: Actor;
let manager: Actor;
let accountantId: string;

beforeAll(async () => {
  ownerA = (await loadActor(testDb, (await makeUser({ name: "Owner A", roleKey: "OWNER" })).id))!;
  ownerB = (await loadActor(testDb, (await makeUser({ name: "Owner B", roleKey: "OWNER" })).id))!;
  manager = (await loadActor(testDb, (await makeUser({ name: "Approvals Manager", roleKey: "EVENT_MANAGER" })).id))!;
  accountantId = (await makeUser({ name: "Approvals Accountant", roleKey: "ACCOUNTANT" })).id;
});
afterAll(() => testDb.$disconnect());

async function quoteRequest() {
  const event = await makeEvent();
  const vendor = await makeVendor("Quote Vendor");
  const assignment = await testDb.vendorAssignment.create({ data: { eventId: event.id, vendorId: vendor.id, scopeOfWork: "Lights", status: "QUOTED" } });
  const quote = await testDb.quotation.create({ data: { assignmentId: assignment.id, vendorId: vendor.id, version: 1, subtotal: 33898.31, taxAmount: 6101.69, total: 40000 } });
  const req = await testDb.approvalRequest.create({ data: { type: "QUOTATION", entityId: quote.id, eventId: event.id, amount: 40000, summary: "Quote Vendor · lights", requestedById: manager.userId } });
  return { event, vendor, assignment, quote, req };
}

async function paymentRequest(opts: { requestedById?: string; agreed?: number; amount?: number } = {}) {
  const event = await makeEvent();
  const vendor = await makeVendor("Pay Vendor");
  const assignment = await testDb.vendorAssignment.create({ data: { eventId: event.id, vendorId: vendor.id, scopeOfWork: "Decor", status: "IN_PROGRESS", agreedAmount: opts.agreed ?? 100000 } });
  const payment = await testDb.payment.create({ data: { direction: "OUT", eventId: event.id, partyType: "VENDOR", vendorId: vendor.id, amount: opts.amount ?? 40000, method: "BANK", requestedById: opts.requestedById ?? accountantId } });
  const req = await testDb.approvalRequest.create({ data: { type: "PAYMENT", entityId: payment.id, eventId: event.id, amount: opts.amount ?? 40000, summary: "Pay Vendor · instalment", requestedById: opts.requestedById ?? accountantId } });
  return { event, vendor, assignment, payment, req };
}

describe("quotes", () => {
  it("approving fixes the agreed amount on the job and tells the requester", async () => {
    const { assignment, quote, req } = await quoteRequest();
    await decideApproval(testDb, ownerA, req.id, "APPROVE", undefined);
    expect((await testDb.quotation.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe("APPROVED");
    const a = await testDb.vendorAssignment.findUniqueOrThrow({ where: { id: assignment.id } });
    expect(a.status).toBe("APPROVED");
    expect(a.agreedAmount?.toString()).toBe("40000");
    expect((await testDb.approvalRequest.findUniqueOrThrow({ where: { id: req.id } })).state).toBe("APPROVED");
    expect(await testDb.notification.count({ where: { userId: manager.userId, entityId: quote.id } })).toBe(1);
    expect(await testDb.auditLog.count({ where: { entityId: quote.id, action: "approve", financial: true } })).toBe(1);
  });

  it("asking for a revision reopens the job; rejecting cancels it; both need a reason", async () => {
    const r1 = await quoteRequest();
    await expect(decideApproval(testDb, ownerA, r1.req.id, "REVISE", "")).rejects.toThrow(/reason/);
    await decideApproval(testDb, ownerA, r1.req.id, "REVISE", "Add 4 uplighters at the entrance");
    expect((await testDb.quotation.findUniqueOrThrow({ where: { id: r1.quote.id } })).status).toBe("REVISION_REQUESTED");
    expect((await testDb.vendorAssignment.findUniqueOrThrow({ where: { id: r1.assignment.id } })).status).toBe("INVITED");

    const r2 = await quoteRequest();
    await decideApproval(testDb, ownerA, r2.req.id, "REJECT", "Too expensive");
    expect((await testDb.vendorAssignment.findUniqueOrThrow({ where: { id: r2.assignment.id } })).status).toBe("CANCELLED");
  });

  it("cannot be decided twice or by a non-owner", async () => {
    const { req } = await quoteRequest();
    await expect(decideApproval(testDb, manager, req.id, "APPROVE", undefined)).rejects.toThrow(/Only hosts/);
    await decideApproval(testDb, ownerB, req.id, "APPROVE", undefined);
    await expect(decideApproval(testDb, ownerA, req.id, "APPROVE", undefined)).rejects.toThrow(/already decided/);
  });
});

describe("payments", () => {
  it("an owner approves a payment the accountant prepared", async () => {
    const { payment, req } = await paymentRequest();
    await decideApproval(testDb, ownerA, req.id, "APPROVE", undefined);
    const p = await testDb.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("APPROVED");
    expect(p.approvedById).toBe(ownerA.userId);
  });

  it("an owner cannot approve a payment they prepared while the other owner is active", async () => {
    const { req } = await paymentRequest({ requestedById: ownerA.userId });
    await expect(decideApproval(testDb, ownerA, req.id, "APPROVE", undefined)).rejects.toThrow(/other host/);
    await decideApproval(testDb, ownerB, req.id, "APPROVE", undefined);
  });

  it("the final vendor payment needs approved proof of work", async () => {
    const { event, assignment, req } = await paymentRequest({ agreed: 40000, amount: 40000 });
    await expect(decideApproval(testDb, ownerA, req.id, "APPROVE", undefined)).rejects.toThrow(/final payment/);
    const uploader = await makeUser({ accountType: "VENDOR", roleKey: "VENDOR" });
    await testDb.workProof.create({ data: { eventId: event.id, vendorAssignmentId: assignment.id, kind: "PHOTO", fileId: (await makeFile(uploader.id)).id, uploadedById: uploader.id, status: "APPROVED" } });
    await decideApproval(testDb, ownerA, req.id, "APPROVE", undefined);
  });

  it("rejecting keeps the payment on record with the reason", async () => {
    const { payment, req } = await paymentRequest();
    await decideApproval(testDb, ownerA, req.id, "REJECT", "Invoice amount does not match the work order");
    const p = await testDb.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("REJECTED");
    expect(p.note).toMatch(/does not match/);
  });
});

describe("crew extras and the inbox", () => {
  it("approves a crew extra, which then counts towards their pay", async () => {
    const event = await makeEvent();
    const worker = await makeWorker();
    const assignment = await testDb.crewAssignment.create({ data: { eventId: event.id, workerId: worker.id, duty: "Helper", agreedPay: 700 } });
    const adj = await testDb.crewPayAdjustment.create({ data: { assignmentId: assignment.id, type: "EXTRA", amount: 300, reason: "Late night" } });
    const req = await testDb.approvalRequest.create({ data: { type: "CREW_ADJUSTMENT", entityId: adj.id, eventId: event.id, amount: 300, summary: "Late night extra" } });
    await expect(decideApproval(testDb, ownerA, req.id, "REVISE", "no")).rejects.toThrow(/Only quotes/);
    await decideApproval(testDb, ownerA, req.id, "APPROVE", undefined);
    expect((await testDb.crewPayAdjustment.findUniqueOrThrow({ where: { id: adj.id } })).state).toBe("APPROVED");
  });

  it("lists pending items with the evidence an owner needs", async () => {
    const { req } = await quoteRequest();
    const pay = await paymentRequest({ agreed: 100000, amount: 40000 });
    const list = await listPendingApprovals(testDb, ownerA);
    const quote = list.find((x) => x.id === req.id);
    expect(quote?.kind).toBe("quote");
    if (quote?.kind === "quote") {
      expect(quote.total).toBe(40000);
      expect(quote.vendor).toBe("Quote Vendor");
    }
    const payment = list.find((x) => x.id === pay.req.id);
    expect(payment?.kind).toBe("payment");
    if (payment?.kind === "payment") {
      expect(payment.isFinal).toBe(false);
      expect(payment.agreed).toBe(100000);
    }
    await expect(listPendingApprovals(testDb, manager)).rejects.toThrow(/Only hosts/);
  });
});
