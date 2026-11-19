import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideApproval, listPendingApprovals } from "@/modules/approvals/service";
import { addBudgetLine, budgetView, removeBudgetLine, reviseBudget, submitBudget } from "@/modules/finance/budgets";
import { loadActor, type Actor } from "@/modules/identity/actor";
import { makeEvent, makeUser, makeVendor, testDb } from "./support/factories";

const actorOf = async (u: { id: string }) => (await loadActor(testDb, u.id))!;
let owner: Actor, manager: Actor, otherManager: Actor, supervisor: Actor;
let eventId: string, vendorCat: string, foodCat: string;
const pending = async (eventId: string) => testDb.approvalRequest.findFirstOrThrow({ where: { type: "BUDGET", eventId, state: "PENDING" } });

beforeAll(async () => {
  owner = await actorOf(await makeUser({ name: "BG Owner", roleKey: "OWNER" }));
  const m = await makeUser({ name: "BG Manager", roleKey: "EVENT_MANAGER" });
  const s = await makeUser({ name: "BG Supervisor", roleKey: "SUPERVISOR" });
  otherManager = await actorOf(await makeUser({ name: "BG Other", roleKey: "EVENT_MANAGER" }));
  const ev = await makeEvent({ name: "BG Wedding" });
  eventId = ev.id;
  await testDb.eventMember.createMany({ data: [{ eventId, userId: m.id, role: "MANAGER" }, { eventId, userId: s.id, role: "SUPERVISOR" }] });
  manager = await actorOf(m);
  supervisor = await actorOf(s);
  vendorCat = (await testDb.expenseCategory.findFirstOrThrow({ where: { group: "VENDOR" } })).id;
  foodCat = (await testDb.expenseCategory.findFirstOrThrow({ where: { group: "FOOD" } })).id;
  const v = await makeVendor("BG Decor");
  await testDb.vendorAssignment.create({ data: { eventId, vendorId: v.id, scopeOfWork: "Decor", status: "ACCEPTED", agreedAmount: 120000 } });
  await testDb.expense.create({ data: { eventId, categoryId: foodCat, description: "Tea", amount: 3000, spentOn: new Date(), status: "APPROVED" } });
});
afterAll(() => testDb.$disconnect());

describe("budgets", () => {
  it("the manager drafts and sends it; the owners approve it; it is then fixed", async () => {
    await addBudgetLine(testDb, manager, eventId, { categoryId: vendorCat, description: "Decor", estimatedAmount: 100000 });
    await addBudgetLine(testDb, manager, eventId, { categoryId: foodCat, estimatedAmount: 5000 });
    await expect(addBudgetLine(testDb, otherManager, eventId, { categoryId: foodCat, estimatedAmount: 1 })).rejects.toThrow(/access/);
    await expect(addBudgetLine(testDb, supervisor, eventId, { categoryId: foodCat, estimatedAmount: 1 })).rejects.toThrow(/can't work on budgets/);
    await submitBudget(testDb, manager, eventId);
    await expect(addBudgetLine(testDb, manager, eventId, { categoryId: foodCat, estimatedAmount: 1 })).rejects.toThrow(/waiting for a host/);
    const card = (await listPendingApprovals(testDb, owner)).find((i) => i.kind === "budget" && i.event?.id === eventId);
    expect(card && card.kind === "budget" && card.lines.length).toBe(2);
    await decideApproval(testDb, owner, (await pending(eventId)).id, "APPROVE", undefined);
    const view = (await budgetView(testDb, manager, eventId))!;
    expect(view.approved?.total).toBe(105000);
    expect(view.draft).toBeNull();
    const decor = view.rows.find((r) => r.category === "Vendor payments")!;
    expect(decor).toMatchObject({ estimate: 100000, actual: 120000, over: true });
    expect(view.rows.find((r) => r.category === "Food and refreshments")).toMatchObject({ estimate: 5000, actual: 3000, over: false });
  });

  it("changing it starts a new version from the approved one, approved the same way", async () => {
    const r = await reviseBudget(testDb, manager, eventId);
    expect(r.version).toBe(2);
    let view = (await budgetView(testDb, manager, eventId))!;
    expect(view.draft?.lines).toHaveLength(2);
    const decor = view.draft!.lines.find((l) => l.description === "Decor")!;
    await removeBudgetLine(testDb, manager, eventId, decor.id);
    await addBudgetLine(testDb, manager, eventId, { categoryId: vendorCat, description: "Decor (revised)", estimatedAmount: 125000 });
    await submitBudget(testDb, manager, eventId);
    await expect(decideApproval(testDb, owner, (await pending(eventId)).id, "REJECT", undefined)).rejects.toThrow(/reason/);
    await decideApproval(testDb, owner, (await pending(eventId)).id, "APPROVE", undefined);
    view = (await budgetView(testDb, manager, eventId))!;
    expect(view.approved?.version).toBe(2);
    expect(view.approved?.total).toBe(130000);
    expect(view.rows.find((r) => r.category === "Vendor payments")?.over).toBe(false);
    const v1 = await testDb.budget.findFirstOrThrow({ where: { eventId, version: 1 }, include: { lines: true } });
    expect(v1.lines).toHaveLength(2);
    await expect(removeBudgetLine(testDb, manager, eventId, v1.lines[0].id)).rejects.toThrow(/approved budget can't be changed/);
    expect(await budgetView(testDb, supervisor, eventId)).toBeNull();
  });
});
