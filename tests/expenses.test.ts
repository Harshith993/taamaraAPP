import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideApproval, listPendingApprovals } from "@/modules/approvals/service";
import { listExpenses, markRepaid, submitExpense } from "@/modules/finance/expenses";
import { bookingLedger } from "@/modules/finance/overview";
import { loadActor, type Actor } from "@/modules/identity/actor";
import { cleanupAbandonedUploads } from "@/modules/files/uploads";
import { makeEvent, makeUser, testDb } from "./support/factories";

const actorOf = async (u: { id: string }) => (await loadActor(testDb, u.id))!;
let owner: Actor, coOwner: Actor, manager: Actor, otherManager: Actor, supervisor: Actor, accountant: Actor, crew: Actor;
let eventId: string, tea: string;
const today = new Date().toISOString().slice(0, 10);

let n = 0;
async function receipt(actor: Actor) {
  return (await testDb.file.create({ data: { storageKey: `document/test/rc-${Date.now()}-${n++}/original`, filename: "bill.jpg", mimeType: "image/jpeg", sizeBytes: 10, purpose: "DOCUMENT", status: "READY", uploadedById: actor.userId } })).id;
}
const pending = async (entityId: string) => testDb.approvalRequest.findFirstOrThrow({ where: { entityId, state: "PENDING" } });

beforeAll(async () => {
  owner = await actorOf(await makeUser({ name: "EX Owner", roleKey: "OWNER" }));
  coOwner = await actorOf(await makeUser({ name: "EX Co-owner", roleKey: "OWNER" }));
  const m = await makeUser({ name: "EX Manager", roleKey: "EVENT_MANAGER" });
  const s = await makeUser({ name: "EX Supervisor", roleKey: "SUPERVISOR" });
  otherManager = await actorOf(await makeUser({ name: "EX Other", roleKey: "EVENT_MANAGER" }));
  accountant = await actorOf(await makeUser({ name: "EX Accountant", roleKey: "ACCOUNTANT" }));
  crew = await actorOf(await makeUser({ name: "EX Crew", roleKey: "LABOUR", accountType: "LABOUR" }));
  const ev = await makeEvent({ name: "EX Wedding" });
  eventId = ev.id;
  await testDb.eventMember.createMany({ data: [{ eventId, userId: m.id, role: "MANAGER" }, { eventId, userId: s.id, role: "SUPERVISOR" }] });
  manager = await actorOf(m);
  supervisor = await actorOf(s);
  tea = (await testDb.expenseCategory.findFirstOrThrow({ where: { group: "FOOD" } })).id;
});
afterAll(() => testDb.$disconnect());

describe("expenses", () => {
  let supExpense: string;

  it("the supervisor records one with a receipt; every one needs a receipt, however small", async () => {
    await expect(submitExpense(testDb, supervisor, { eventId, categoryId: tea, description: "Generator diesel", amount: 2400, spentOn: today })).rejects.toThrow(/Attach the bill/);
    supExpense = (await submitExpense(testDb, supervisor, { eventId, categoryId: tea, description: "Generator diesel", amount: 2400, spentOn: today, receiptFileId: await receipt(supervisor) })).id;
    await expect(submitExpense(testDb, supervisor, { eventId, categoryId: tea, description: "Tea for the crew", amount: 40, spentOn: today })).rejects.toThrow(/Every expense needs one/);
    await submitExpense(testDb, supervisor, { eventId, categoryId: tea, description: "Tea for the crew", amount: 40, spentOn: today, receiptFileId: await receipt(supervisor) });
    expect(await testDb.notification.count({ where: { userId: owner.userId, type: "approval.requested", entityId: supExpense } })).toBe(1);
  });

  it("only for bookings the person is on; the company itself only with full access; never crew", async () => {
    await expect(submitExpense(testDb, otherManager, { eventId, categoryId: tea, description: "Snacks", amount: 100, spentOn: today })).rejects.toThrow(/access/);
    await expect(submitExpense(testDb, manager, { categoryId: tea, description: "Office tea", amount: 100, spentOn: today })).rejects.toThrow(/Pick the booking/);
    await submitExpense(testDb, accountant, { categoryId: tea, description: "Office tea", amount: 100, spentOn: today, receiptFileId: await receipt(accountant) });
    await expect(submitExpense(testDb, crew, { eventId, categoryId: tea, description: "Snacks", amount: 100, spentOn: today })).rejects.toThrow(/Only the team/);
    await expect(submitExpense(testDb, supervisor, { eventId, categoryId: tea, description: "Snacks", amount: 100, spentOn: "2099-01-01" })).rejects.toThrow(/future/);
  });

  it("owners see it with the receipt and approve; it becomes a booking cost; then it is repaid", async () => {
    const card = (await listPendingApprovals(testDb, owner)).find((i) => i.kind === "expense" && "description" in i && i.description === "Generator diesel");
    expect(card && card.kind === "expense" && card.receipt?.originalUrl).toMatch(/\/original\?/);
    await decideApproval(testDb, owner, (await pending(supExpense)).id, "APPROVE", undefined);
    expect((await bookingLedger(testDb, owner, eventId))!.expenseCost).toBe(2400);
    await expect(markRepaid(testDb, manager, supExpense, { method: "CASH" })).rejects.toThrow(/can't repay/);
    await expect(markRepaid(testDb, accountant, supExpense, { method: "UPI" })).rejects.toThrow(/reference/);
    await markRepaid(testDb, accountant, supExpense, { method: "UPI", reference: "UPI-77" });
    expect((await testDb.expense.findUniqueOrThrow({ where: { id: supExpense } })).status).toBe("REIMBURSED");
    const pay = await testDb.payment.findFirstOrThrow({ where: { note: { contains: "Generator diesel" } } });
    expect(pay.partyType).toBe("OTHER");
    expect(pay.partyName).toBe("EX Supervisor");
    expect(Number(pay.amount)).toBe(2400);
    await expect(markRepaid(testDb, accountant, supExpense, { method: "CASH" })).rejects.toThrow(/Already repaid/);
    await expect(testDb.expense.delete({ where: { id: supExpense } })).rejects.toThrow(/cannot be deleted/);
  });

  it("an owner can't approve their own; rejecting needs a reason", async () => {
    const own = (await submitExpense(testDb, owner, { eventId, categoryId: tea, description: "Flowers for the stage", amount: 300, spentOn: today, receiptFileId: await receipt(owner) })).id;
    await expect(decideApproval(testDb, owner, (await pending(own)).id, "APPROVE", undefined)).rejects.toThrow(/other host/);
    await expect(decideApproval(testDb, coOwner, (await pending(own)).id, "REJECT", undefined)).rejects.toThrow(/reason/);
    await decideApproval(testDb, coOwner, (await pending(own)).id, "REJECT", "Use the florist's stock");
    expect((await testDb.expense.findUniqueOrThrow({ where: { id: own } })).decisionNote).toBe("Use the florist's stock");
  });

  it("each person sees their own and their bookings'; receipts survive the clean-up", async () => {
    expect((await listExpenses(testDb, supervisor)).map((e) => e.description).sort()).toEqual(["Flowers for the stage", "Generator diesel", "Tea for the crew"]);
    expect((await listExpenses(testDb, otherManager)).length).toBe(0);
    expect((await listExpenses(testDb, accountant)).some((e) => e.description === "Office tea")).toBe(true);
    const e = await testDb.expense.findUniqueOrThrow({ where: { id: supExpense } });
    await testDb.file.update({ where: { id: e.receiptFileId! }, data: { createdAt: new Date(Date.now() - 5 * 86400_000) } });
    await cleanupAbandonedUploads(testDb);
    expect(await testDb.file.count({ where: { id: e.receiptFileId! } })).toBe(1);
  });
});
