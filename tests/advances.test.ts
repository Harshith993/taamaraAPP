import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideApproval, listPendingApprovals } from "@/modules/approvals/service";
import { advanceBalances, closeAdvance, giveAdvance, listAdvances, markAdvanceGiven, spendableAdvances, voidAdvance } from "@/modules/finance/advances";
import { submitExpense } from "@/modules/finance/expenses";
import { buildExport } from "@/modules/finance/exports";
import { settlementView } from "@/modules/finance/settlement";
import { loadActor, type Actor } from "@/modules/identity/actor";
import { makeEvent, makeReceipt, makeUser, testDb } from "./support/factories";

const actorOf = async (u: { id: string }) => (await loadActor(testDb, u.id))!;
let owner: Actor, coOwner: Actor, manager: Actor, otherManager: Actor, supervisor: Actor, accountant: Actor;
let eventId: string, otherEventId: string, tea: string;
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

const spend = async (a: Actor, advanceId: string, amount: number, eventIdFor: string | undefined = eventId) =>
  submitExpense(testDb, a, { eventId: eventIdFor, categoryId: tea, description: `Flowers ${amount}`, amount, spentOn: today, paidVia: "CASH_ADVANCE", cashAdvanceId: advanceId, receiptFileId: await makeReceipt(a.userId) });
const approve = async (entityId: string, by: Actor = owner) =>
  decideApproval(testDb, by, (await testDb.approvalRequest.findFirstOrThrow({ where: { entityId, state: "PENDING" } })).id, "APPROVE", undefined);

beforeAll(async () => {
  owner = await actorOf(await makeUser({ name: "CA Host", roleKey: "OWNER" }));
  coOwner = await actorOf(await makeUser({ name: "CA Co-host", roleKey: "OWNER" }));
  const m = await makeUser({ name: "CA Manager", roleKey: "EVENT_MANAGER" });
  const s = await makeUser({ name: "CA Supervisor", roleKey: "SUPERVISOR" });
  otherManager = await actorOf(await makeUser({ name: "CA Other", roleKey: "EVENT_MANAGER" }));
  accountant = await actorOf(await makeUser({ name: "CA Accountant", roleKey: "ACCOUNTANT" }));
  eventId = (await makeEvent({ name: "CA Wedding" })).id;
  otherEventId = (await makeEvent({ name: "CA Other" })).id;
  await testDb.eventMember.createMany({ data: [{ eventId, userId: m.id, role: "MANAGER" }, { eventId, userId: s.id, role: "SUPERVISOR" }, { eventId: otherEventId, userId: m.id, role: "MANAGER" }] });
  manager = await actorOf(m);
  supervisor = await actorOf(s);
  tea = (await testDb.expenseCategory.findFirstOrThrow({ where: { group: "FOOD" } })).id;
});
afterAll(() => testDb.$disconnect());

describe("cash advances (D57)", () => {
  let advId: string;

  it("a host gives cash to a manager on the booking at once; the manager is told", async () => {
    await expect(giveAdvance(testDb, owner, { holderId: accountant.userId, amount: 1000, purpose: "Tea" })).rejects.toThrow(/manager or supervisor/);
    await expect(giveAdvance(testDb, owner, { holderId: otherManager.userId, eventId, amount: 1000, purpose: "Tea" })).rejects.toThrow(/isn't on the team/);
    await expect(giveAdvance(testDb, manager, { holderId: manager.userId, amount: 1000, purpose: "Tea" })).rejects.toThrow(/Only hosts and the accountant/);
    const r = await giveAdvance(testDb, owner, { holderId: manager.userId, eventId, amount: 5000, purpose: "Flowers and tea on the day", handedOver: true });
    expect(r.status).toBe("GIVEN");
    advId = r.id;
    expect(await testDb.notification.count({ where: { userId: manager.userId, type: "advance.given", entityId: advId } })).toBe(1);
    expect(await testDb.auditLog.count({ where: { entityType: "cash_advance", entityId: advId, financial: true } })).toBe(1);
  });

  it("the accountant prepares one; a host approves it; then it is handed over", async () => {
    await expect(giveAdvance(testDb, accountant, { holderId: supervisor.userId, amount: 2000, purpose: "Autos", handedOver: true })).rejects.toThrow(/approves the advance before/);
    const r = await giveAdvance(testDb, accountant, { holderId: supervisor.userId, amount: 2000, purpose: "Autos for the crew" });
    expect(r.status).toBe("PENDING_APPROVAL");
    const card = (await listPendingApprovals(testDb, owner)).find((p) => p.kind === "advance" && p.summary.includes("Autos for the crew"));
    expect(card && card.kind === "advance" && card.holder).toBe("CA Supervisor");
    await expect(markAdvanceGiven(testDb, accountant, r.id, { method: "CASH", givenOn: today })).rejects.toThrow(/approve this advance first/);
    await approve(r.id);
    await expect(markAdvanceGiven(testDb, accountant, r.id, { method: "UPI", givenOn: today })).rejects.toThrow(/reference/);
    await markAdvanceGiven(testDb, accountant, r.id, { method: "UPI", reference: "UPI-123", givenOn: today });
    expect((await testDb.cashAdvance.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("GIVEN");
    // Nothing spent: a host can void it with a reason; the accountant can't once it is handed over.
    await expect(voidAdvance(testDb, accountant, r.id, "Mistake")).rejects.toThrow(/only a host/);
    await expect(voidAdvance(testDb, owner, r.id, " ")).rejects.toThrow(/reason/);
    await voidAdvance(testDb, owner, r.id, "Given twice by mistake");
    await expect(testDb.cashAdvance.update({ where: { id: r.id }, data: { purpose: "changed" } })).rejects.toThrow(/cannot be changed/);
  });

  it("the holder spends from it with a bill, on its booking, never more than is left", async () => {
    expect((await spendableAdvances(testDb, manager)).map((a) => a.id)).toEqual([advId]);
    await expect(spend(supervisor, advId, 100)).rejects.toThrow(/your own cash advances/);
    await expect(spend(manager, advId, 100, otherEventId)).rejects.toThrow(/That advance is for CA Wedding/);
    await expect(spend(manager, advId, 6000)).rejects.toThrow(/Only ₹5,000/);
    await expect(submitExpense(testDb, manager, { eventId, categoryId: tea, description: "Tea", amount: 100, spentOn: today, paidVia: "CASH_ADVANCE", cashAdvanceId: advId })).rejects.toThrow(/Attach the bill/);
    const a = await spend(manager, advId, 1200);
    const b = await spend(manager, advId, 800);
    await approve(a.id);
    const [mine] = await listAdvances(testDb, manager, { open: true });
    expect(mine).toMatchObject({ approved: 1200, waiting: 800, left: 3000 });
    expect(await listAdvances(testDb, otherManager)).toEqual([]);
    expect((await advanceBalances(testDb, accountant)).people.find((p) => p.name === "CA Manager")?.held).toBe(3800);
    // Rejected spending goes back on the balance.
    await decideApproval(testDb, owner, (await testDb.approvalRequest.findFirstOrThrow({ where: { entityId: b.id, state: "PENDING" } })).id, "REJECT", "No bill for this shop");
    expect((await listAdvances(testDb, manager, { open: true }))[0].left).toBe(3800);
  });

  it("an open advance stops the booking from being settled", async () => {
    const view = await settlementView(testDb, owner, eventId);
    const check = view!.checks.find((c) => c.key === "advances");
    expect(check?.ok).toBe(false);
    expect(check?.details[0]).toMatch(/CA Manager: ₹5,000/);
  });

  it("closing: the rest comes back; a shortfall needs a host and a note", async () => {
    await expect(closeAdvance(testDb, accountant, advId, { returned: 5000 })).rejects.toThrow(/Only ₹3,800/);
    await expect(closeAdvance(testDb, accountant, advId, { returned: 3000 })).rejects.toThrow(/A host settles a shortfall/);
    await expect(closeAdvance(testDb, owner, advId, { returned: 3000 })).rejects.toThrow(/how the missing cash is settled/);
    const r = await closeAdvance(testDb, owner, advId, { returned: 3000, note: "₹800 taken from December pay" });
    expect(r).toEqual({ spent: 1200, returned: 3000, shortfall: 800 });
    await expect(spend(manager, advId, 10)).rejects.toThrow(/isn't open for spending/);
    await expect(voidAdvance(testDb, owner, advId, "late")).rejects.toThrow(/already closed/);
    expect((await settlementView(testDb, owner, eventId))!.checks.find((c) => c.key === "advances")?.ok).toBe(true);
    expect(await testDb.notification.count({ where: { userId: manager.userId, type: "advance.closed" } })).toBe(1);
  });

  it("a prepared advance can't be approved by the host who prepared it while the other host is active", async () => {
    const r = await giveAdvance(testDb, accountant, { holderId: manager.userId, amount: 300, purpose: "Snacks" });
    await approve(r.id, coOwner);
    const own = await testDb.cashAdvance.create({ data: { userId: manager.userId, amount: 100, purpose: "Self", requestedById: owner.userId } });
    const req = await testDb.approvalRequest.create({ data: { type: "CASH_ADVANCE", entityId: own.id, amount: 100, summary: "Self", requestedById: owner.userId } });
    await expect(decideApproval(testDb, owner, req.id, "APPROVE", undefined)).rejects.toThrow(/other host/);
  });

  it("the database keeps the ledger: no deleting, and nothing changes on a settled booking", async () => {
    await expect(testDb.cashAdvance.delete({ where: { id: advId } })).rejects.toThrow(/never deleted/);
    const ev = await makeEvent({ name: "CA Settled" });
    await testDb.event.update({ where: { id: ev.id }, data: { status: "SETTLED", settledAt: new Date() } });
    await expect(testDb.cashAdvance.create({ data: { userId: manager.userId, eventId: ev.id, amount: 100, purpose: "x" } })).rejects.toThrow(/settled/);
  });

  it("exports every advance for the accountant", async () => {
    const out = await buildExport(testDb, accountant, "advances", today, today);
    expect(out.filename).toMatch(/advances/);
    expect(await testDb.auditLog.count({ where: { action: "export", entityId: "advances" } })).toBeGreaterThan(0);
    await expect(buildExport(testDb, manager, "advances", today, today)).rejects.toThrow(/Only hosts and the accountant/);
  });
});
