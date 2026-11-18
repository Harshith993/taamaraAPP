import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideApproval } from "@/modules/approvals/service";
import { loadActor, type Actor } from "@/modules/identity/actor";
import { acceptWorkOrder, cancelJob, declineJob, getJob, inviteVendor, issueWorkOrder, priceQuote, reportProgress, signOffJob, submitQuote } from "@/modules/vendors/jobs";
import { makeEvent, makeUser, makeVendor, testDb } from "./support/factories";

let owner: Actor;
let otherOwner: Actor;
let manager: Actor;
let otherManager: Actor;
let supervisor: Actor;
let accountant: Actor;
let vendorActor: Actor;
let otherVendorActor: Actor;
let vendorId: string;
let otherVendorId: string;

const actorOf = async (u: { id: string }) => (await loadActor(testDb, u.id))!;

beforeAll(async () => {
  owner = await actorOf(await makeUser({ name: "VJ Owner", roleKey: "OWNER" }));
  otherOwner = await actorOf(await makeUser({ name: "VJ Co-founder", roleKey: "OWNER" }));
  manager = await actorOf(await makeUser({ name: "VJ Manager", roleKey: "EVENT_MANAGER" }));
  otherManager = await actorOf(await makeUser({ name: "VJ Other Manager", roleKey: "EVENT_MANAGER" }));
  supervisor = await actorOf(await makeUser({ name: "VJ Supervisor", roleKey: "SUPERVISOR" }));
  accountant = await actorOf(await makeUser({ name: "VJ Accountant", roleKey: "ACCOUNTANT" }));
  const v = await makeVendor("VJ Lights");
  const v2 = await makeVendor("VJ Decor");
  vendorId = v.id;
  otherVendorId = v2.id;
  const vu = await makeUser({ name: "VJ Lights login", roleKey: "VENDOR", accountType: "VENDOR" });
  const vu2 = await makeUser({ name: "VJ Decor login", roleKey: "VENDOR", accountType: "VENDOR" });
  await testDb.vendorUser.createMany({ data: [{ vendorId: v.id, userId: vu.id }, { vendorId: v2.id, userId: vu2.id }] });
  vendorActor = await actorOf(vu);
  otherVendorActor = await actorOf(vu2);
});
afterAll(() => testDb.$disconnect());

async function booking() {
  const event = await makeEvent({ name: "VJ Booking" });
  const fn = await testDb.eventFunction.create({ data: { eventId: event.id, name: "Sangeet", date: new Date("2026-12-12T00:00:00Z"), startsAt: new Date("2026-12-12T19:00:00+05:30") } });
  await testDb.eventMember.createMany({ data: [{ eventId: event.id, userId: manager.userId, role: "MANAGER" }, { eventId: event.id, userId: supervisor.userId, role: "SUPERVISOR" }] });
  return { event, fn };
}

const lines = [
  { description: "LED par cans", quantity: 40, unit: "pcs", rate: 350, gstRate: 18 },
  { description: "Fairy-light canopy", quantity: 1, rate: 22000.5, gstRate: 18 },
];

describe("pricing", () => {
  it("works in whole paise", () => {
    const p = priceQuote([{ quantity: 3, rate: 0.1, gstRate: 18 }, { quantity: 1.5, rate: 333.33, gstRate: 5 }]);
    expect(p.lines.map((l) => l.amount)).toEqual([0.3, 500]);
    expect(p.subtotal).toBe(500.3);
    expect(p.tax).toBe(25.05);
    expect(p.total).toBe(525.35);
  });
  it("refuses a zero quote", () => {
    expect(() => priceQuote([{ quantity: 1, rate: 0, gstRate: 0 }])).toThrow(/more than ₹0/);
  });
});

describe("the full job flow", () => {
  it("invite → quote → owner approves → work order → vendor accepts → delivered → signed off", async () => {
    const { event, fn } = await booking();
    const { id } = await inviteVendor(testDb, manager, { eventId: event.id, vendorId, scopeOfWork: "Sangeet lighting", functionIds: [fn.id], reportingDate: "2026-12-12", reportingTime: "14:00" });
    let job = await testDb.vendorAssignment.findUniqueOrThrow({ where: { id } });
    expect(job.status).toBe("INVITED");
    expect(job.reportingAt?.toISOString()).toBe("2026-12-12T08:30:00.000Z");
    expect(await testDb.notification.count({ where: { userId: vendorActor.userId, entityId: id, type: "job.invited" } })).toBe(1);

    const q = await submitQuote(testDb, vendorActor, id, { items: lines, validUntil: "2026-12-01", notes: "Includes operator" });
    expect(q).toMatchObject({ version: 1, total: 42480.59 });
    const quote = await testDb.quotation.findUniqueOrThrow({ where: { id: q.id }, include: { items: true } });
    expect(quote.subtotal.toString()).toBe("36000.5");
    expect(quote.taxAmount.toString()).toBe("6480.09");
    expect(quote.items).toHaveLength(2);
    expect(quote.submittedById).toBe(vendorActor.userId);
    const approval = await testDb.approvalRequest.findFirstOrThrow({ where: { type: "QUOTATION", entityId: q.id } });
    expect(approval.state).toBe("PENDING");
    expect(approval.amount?.toString()).toBe("42480.59");
    // Both owners hear about it; so does the manager.
    expect(await testDb.notification.count({ where: { userId: { in: [owner.userId, otherOwner.userId] }, entityId: q.id, type: "approval.requested" } })).toBe(2);
    expect(await testDb.notification.count({ where: { userId: manager.userId, entityId: q.id, type: "quote.received" } })).toBe(1);
    expect((await testDb.vendorAssignment.findUniqueOrThrow({ where: { id } })).status).toBe("QUOTED");

    await decideApproval(testDb, owner, approval.id, "APPROVE", undefined);
    job = await testDb.vendorAssignment.findUniqueOrThrow({ where: { id } });
    expect(job.status).toBe("APPROVED");
    expect(job.agreedAmount?.toString()).toBe("42480.59");
    await expect(submitQuote(testDb, vendorActor, id, { items: lines })).rejects.toThrow(/already approved/);

    await expect(acceptWorkOrder(testDb, vendorActor, id)).rejects.toThrow(/no work order/);
    const wo = await issueWorkOrder(testDb, manager, id, "50% advance, rest after the event");
    expect(wo.number).toMatch(/^WO-\d{4}-\d{4}$/);
    await expect(issueWorkOrder(testDb, manager, id, undefined)).rejects.toThrow(/already issued/);

    await expect(reportProgress(testDb, vendorActor, id, { stage: "IN_PROGRESS" })).rejects.toThrow(/Accept the work order/);
    await acceptWorkOrder(testDb, vendorActor, id);
    expect((await testDb.workOrder.findUniqueOrThrow({ where: { id: wo.id } })).status).toBe("ACKNOWLEDGED");
    expect((await testDb.vendorAssignment.findUniqueOrThrow({ where: { id } })).status).toBe("ACCEPTED");

    await reportProgress(testDb, vendorActor, id, { stage: "IN_PROGRESS", note: "Truss going up" });
    await expect(signOffJob(testDb, supervisor, id)).rejects.toThrow(/hasn't marked/);
    await reportProgress(testDb, vendorActor, id, { stage: "DELIVERED" });
    expect(await testDb.notification.count({ where: { userId: supervisor.userId, entityId: id, type: "job.delivered" } })).toBe(1);
    await signOffJob(testDb, supervisor, id);
    expect((await testDb.vendorAssignment.findUniqueOrThrow({ where: { id } })).status).toBe("COMPLETED");
    expect(await testDb.progressUpdate.count({ where: { assignmentId: id } })).toBe(2);
    expect(await testDb.auditLog.count({ where: { entityId: q.id, action: "submit", financial: true } })).toBe(1);
  });

  it("a revision request reopens the job and the next quote becomes v2", async () => {
    const { event, fn } = await booking();
    const { id } = await inviteVendor(testDb, manager, { eventId: event.id, vendorId, scopeOfWork: "Lights", functionIds: [fn.id] });
    const q1 = await submitQuote(testDb, vendorActor, id, { items: lines });
    const a1 = await testDb.approvalRequest.findFirstOrThrow({ where: { entityId: q1.id } });
    await decideApproval(testDb, owner, a1.id, "REVISE", "Too high, please sharpen the canopy price");
    expect((await testDb.vendorAssignment.findUniqueOrThrow({ where: { id } })).status).toBe("INVITED");
    const job = await getJob(testDb, vendorActor, id);
    expect(job.quotes[0]).toMatchObject({ version: 1, status: "REVISION_REQUESTED", reviewNote: "Too high, please sharpen the canopy price" });

    const q2 = await submitQuote(testDb, vendorActor, id, { items: [{ description: "Everything", quantity: 1, rate: 30000, gstRate: 18 }] });
    expect(q2.version).toBe(2);
    expect(q2.total).toBe(35400);
  });

  it("a new quote replaces one still waiting, and the old approval drops out of the inbox", async () => {
    const { event, fn } = await booking();
    const { id } = await inviteVendor(testDb, manager, { eventId: event.id, vendorId, scopeOfWork: "Lights", functionIds: [fn.id] });
    const q1 = await submitQuote(testDb, vendorActor, id, { items: lines });
    const q2 = await submitQuote(testDb, vendorActor, id, { items: lines.slice(0, 1) });
    expect((await testDb.quotation.findUniqueOrThrow({ where: { id: q1.id } })).status).toBe("WITHDRAWN");
    expect((await testDb.approvalRequest.findFirstOrThrow({ where: { entityId: q1.id } })).state).toBe("CANCELLED");
    expect((await testDb.approvalRequest.findFirstOrThrow({ where: { entityId: q2.id } })).state).toBe("PENDING");
  });

  it("the accountant can enter a quote received on paper; it still needs an owner", async () => {
    const { event, fn } = await booking();
    const { id } = await inviteVendor(testDb, manager, { eventId: event.id, vendorId, scopeOfWork: "Lights", functionIds: [fn.id] });
    const q = await submitQuote(testDb, accountant, id, { items: lines });
    const quote = await testDb.quotation.findUniqueOrThrow({ where: { id: q.id } });
    expect(quote.submittedById).toBe(accountant.userId);
    expect(quote.vendorId).toBe(vendorId);
    expect((await testDb.approvalRequest.findFirstOrThrow({ where: { entityId: q.id } })).state).toBe("PENDING");
  });

  it("vendors can decline an invitation with a reason; managers can withdraw one", async () => {
    const { event, fn } = await booking();
    const a = await inviteVendor(testDb, manager, { eventId: event.id, vendorId, scopeOfWork: "Lights", functionIds: [fn.id] });
    await expect(declineJob(testDb, vendorActor, a.id, " ")).rejects.toThrow(/why/);
    await declineJob(testDb, vendorActor, a.id, "Booked elsewhere that night");
    expect(await testDb.vendorAssignment.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ status: "DECLINED", declineReason: "Booked elsewhere that night" });
    expect(await testDb.notification.count({ where: { userId: manager.userId, entityId: a.id, type: "job.declined" } })).toBe(1);

    const b = await inviteVendor(testDb, manager, { eventId: event.id, vendorId: otherVendorId, scopeOfWork: "Decor", functionIds: [fn.id] });
    const q = await submitQuote(testDb, otherVendorActor, b.id, { items: lines });
    await cancelJob(testDb, manager, b.id, "Client dropped decor");
    expect((await testDb.vendorAssignment.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("CANCELLED");
    expect((await testDb.approvalRequest.findFirstOrThrow({ where: { entityId: q.id } })).state).toBe("CANCELLED");
  });
});

describe("who can do what", () => {
  it("only managers on the booking (or owners) invite vendors; duplicates are refused", async () => {
    const { event, fn } = await booking();
    const input = { eventId: event.id, vendorId, scopeOfWork: "Lights", functionIds: [fn.id] };
    await expect(inviteVendor(testDb, otherManager, input)).rejects.toThrow(/access/);
    await expect(inviteVendor(testDb, supervisor, input)).rejects.toThrow(/can't ask vendors/);
    await expect(inviteVendor(testDb, vendorActor, input)).rejects.toThrow(/can't ask vendors/);
    await inviteVendor(testDb, owner, input);
    await expect(inviteVendor(testDb, manager, input)).rejects.toThrow(/already on this booking/);
  });

  it("refuses functions from another booking", async () => {
    const { event } = await booking();
    const other = await booking();
    await expect(inviteVendor(testDb, manager, { eventId: event.id, vendorId, scopeOfWork: "Lights", functionIds: [other.fn.id] })).rejects.toThrow(/functions from this booking/);
  });

  it("a vendor can't see, quote on or accept another vendor's job", async () => {
    const { event, fn } = await booking();
    const { id } = await inviteVendor(testDb, manager, { eventId: event.id, vendorId, scopeOfWork: "Lights", functionIds: [fn.id] });
    await expect(getJob(testDb, otherVendorActor, id)).rejects.toThrow(/not found/);
    await expect(submitQuote(testDb, otherVendorActor, id, { items: lines })).rejects.toThrow(/not found/);
    await expect(declineJob(testDb, otherVendorActor, id, "no")).rejects.toThrow(/not found/);
  });

  it("managers can't send quotes for vendors, and other managers can't issue work orders", async () => {
    const { event, fn } = await booking();
    const { id } = await inviteVendor(testDb, manager, { eventId: event.id, vendorId, scopeOfWork: "Lights", functionIds: [fn.id] });
    await expect(submitQuote(testDb, manager, id, { items: lines })).rejects.toThrow(/can't send quotes/);
    const q = await submitQuote(testDb, vendorActor, id, { items: lines });
    await decideApproval(testDb, owner, (await testDb.approvalRequest.findFirstOrThrow({ where: { entityId: q.id } })).id, "APPROVE", undefined);
    await expect(issueWorkOrder(testDb, otherManager, id, undefined)).rejects.toThrow(/not found/);
    await expect(issueWorkOrder(testDb, supervisor, id, undefined)).rejects.toThrow(/can't issue work orders/);
  });

  it("validates quote lines", async () => {
    const { event, fn } = await booking();
    const { id } = await inviteVendor(testDb, manager, { eventId: event.id, vendorId, scopeOfWork: "Lights", functionIds: [fn.id] });
    await expect(submitQuote(testDb, vendorActor, id, { items: [] })).rejects.toThrow(/at least one line/);
    await expect(submitQuote(testDb, vendorActor, id, { items: [{ description: "x", quantity: 1, rate: 100, gstRate: 7 }] })).rejects.toThrow(/GST rate/);
    await expect(submitQuote(testDb, vendorActor, id, { items: [{ description: "x", quantity: 0, rate: 100, gstRate: 18 }] })).rejects.toThrow(/more than 0/);
    await expect(submitQuote(testDb, vendorActor, id, { items: lines, validUntil: "2020-01-01" })).rejects.toThrow(/past/);
  });

  it("vendors see their own quote amounts but never the host's contact unless the booking shares it", async () => {
    const { event, fn } = await booking();
    const { id } = await inviteVendor(testDb, manager, { eventId: event.id, vendorId, scopeOfWork: "Lights", functionIds: [fn.id] });
    await submitQuote(testDb, vendorActor, id, { items: lines });
    let job = await getJob(testDb, vendorActor, id);
    expect(job.host).toBeNull();
    expect(job.quotes[0].total).toBe(42480.59);
    expect(job.team.map((t) => t.name)).toContain("VJ Manager");
    await testDb.event.update({ where: { id: event.id }, data: { shareHostContactWithVendors: true } });
    job = await getJob(testDb, vendorActor, id);
    expect(job.host?.name).toBe(event.client.name);
    // A supervisor sees the job but not the money.
    const sv = await getJob(testDb, supervisor, id);
    expect(sv.quotes).toEqual([]);
    expect(sv.agreed).toBeNull();
  });
});
