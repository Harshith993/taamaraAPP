import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadActor, type Actor } from "@/modules/identity/actor";
import { globalSearch } from "@/modules/search/service";
import { makeEvent, makeUser, testDb } from "./support/factories";

const actorOf = async (u: { id: string }) => (await loadActor(testDb, u.id))!;
let owner: Actor, manager: Actor, accountant: Actor;

beforeAll(async () => {
  owner = await actorOf(await makeUser({ name: "SR Host", roleKey: "OWNER" }));
  const m = await makeUser({ name: "SR Manager", roleKey: "EVENT_MANAGER" });
  accountant = await actorOf(await makeUser({ name: "SR Accountant", roleKey: "ACCOUNTANT" }));
  const mine = await makeEvent({ name: "SRCH Mine wedding" });
  await makeEvent({ name: "SRCH Other wedding" });
  await testDb.eventMember.create({ data: { eventId: mine.id, userId: m.id, role: "MANAGER" } });
  manager = await actorOf(m);
});
afterAll(() => testDb.$disconnect());

describe("the ⌘K search", () => {
  it("the host finds every matching booking", async () => {
    const hits = await globalSearch(testDb, owner, "srch");
    expect(hits.filter((h) => h.kind === "booking").map((h) => h.title).sort()).toEqual(["SRCH Mine wedding", "SRCH Other wedding"]);
  });
  it("a manager only finds the bookings they work on", async () => {
    const hits = await globalSearch(testDb, manager, "SRCH");
    expect(hits.filter((h) => h.kind === "booking").map((h) => h.title)).toEqual(["SRCH Mine wedding"]);
  });
  it("one letter finds nothing", async () => {
    expect(await globalSearch(testDb, owner, "s")).toEqual([]);
  });
  it("nobody gets lists their role can't open", async () => {
    const hits = await globalSearch(testDb, accountant, "SR");
    expect(hits.some((h) => h.kind === "crew")).toBe(false);
  });
});
