import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBooking, listBookings, toInstant } from "@/modules/events/service";
import { getBookingCrew, getBookingHeader, getBookingMoney, getBookingVendors } from "@/modules/events/workspace";
import { loadActor, type Actor } from "@/modules/identity/actor";
import { makeUser, testDb } from "./support/factories";
import { buildScenario } from "./support/scenario";

let owner: Actor;
let manager: Actor;
let supervisor: Actor;
let weddingId: string;
let s: Awaited<ReturnType<typeof buildScenario>>;

beforeAll(async () => {
  owner = (await loadActor(testDb, (await makeUser({ name: "Bookings Owner", roleKey: "OWNER" })).id))!;
  manager = (await loadActor(testDb, (await makeUser({ name: "Bookings Manager", roleKey: "EVENT_MANAGER" })).id))!;
  supervisor = (await loadActor(testDb, (await makeUser({ name: "Bookings Supervisor", roleKey: "SUPERVISOR" })).id))!;
  weddingId = (await testDb.eventCategory.findUniqueOrThrow({ where: { name: "Wedding" } })).id;
  s = await buildScenario();
});
afterAll(() => testDb.$disconnect());

function inDays(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

describe("creating a booking", () => {
  it("creates functions, a new client, a code and checklist tasks; the manager runs it", async () => {
    const booking = await createBooking(testDb, manager, {
      name: "Riya & Arjun",
      categoryId: weddingId,
      clientName: "Suresh Mehta",
      clientPhone: "98765 43210",
      functions: [
        { name: "Wedding", date: inDays(60), startTime: "19:00", endTime: "02:00", venueText: "Rambagh Gardens" },
        { name: "Sangeet", date: inDays(59), startTime: "19:30", endTime: "23:30" },
      ],
    });
    expect(booking.code).toMatch(/^EVT-\d{4}-\d{4}$/);
    expect(booking.taskCount).toBe(10);

    const saved = await testDb.event.findUniqueOrThrow({ where: { id: booking.id }, include: { functions: { orderBy: { sortOrder: "asc" } }, client: true, members: true, tasks: true } });
    expect(saved.functions.map((f) => f.name)).toEqual(["Sangeet", "Wedding"]); // sorted by time
    expect(saved.functions[1].endsAt!.getTime()).toBeGreaterThan(saved.functions[1].startsAt.getTime()); // past midnight
    expect(saved.client.phone).toBe("+919876543210");
    expect(saved.members).toEqual([expect.objectContaining({ userId: manager.userId, role: "MANAGER" })]);
    expect(saved.tasks.every((t) => t.assigneeId === manager.userId && t.status === "ASSIGNED")).toBe(true);
    expect(saved.startDate?.toISOString().slice(0, 10)).toBe(inDays(59));
    expect(saved.endDate?.toISOString().slice(0, 10)).toBe(inDays(60));

    const visible = await listBookings(testDb, manager, { range: "upcoming" });
    expect(visible.map((e) => e.id)).toContain(booking.id);
  });

  it("numbers bookings one after another", async () => {
    const base = { categoryId: weddingId, clientName: "Number Test", functions: [{ name: "Party", date: inDays(30), startTime: "20:00" }] };
    const a = await createBooking(testDb, owner, { ...base, name: "First" });
    const b = await createBooking(testDb, owner, { ...base, name: "Second" });
    const n = (code: string) => Number(code.split("-")[2]);
    expect(n(b.code)).toBe(n(a.code) + 1);
  });

  it("refuses people who cannot create bookings and bad input", async () => {
    await expect(createBooking(testDb, supervisor, { name: "X", categoryId: weddingId, clientName: "Y", functions: [{ name: "P", date: inDays(5), startTime: "19:00" }] })).rejects.toThrow(/can't create/);
    await expect(createBooking(testDb, owner, { name: "No functions", categoryId: weddingId, clientName: "Y", functions: [] })).rejects.toThrow(/at least one function/);
    await expect(createBooking(testDb, owner, { name: "No client", categoryId: weddingId, functions: [{ name: "P", date: inDays(5), startTime: "19:00" }] })).rejects.toThrow(/client/);
  });

  it("does not let a manager attach a booking to a client they cannot see", async () => {
    const hidden = await testDb.client.create({ data: { name: "Someone else's client" } });
    await expect(createBooking(testDb, manager, { name: "Sneaky", categoryId: weddingId, clientId: hidden.id, functions: [{ name: "P", date: inDays(5), startTime: "19:00" }] })).rejects.toThrow(/not found/);
  });

  it("stores times in India time", () => {
    expect(toInstant("2026-11-21", "19:00").toISOString()).toBe("2026-11-21T13:30:00.000Z");
  });
});

describe("the workspace shows each role only what they may see", () => {
  it("managers get costs but never client billing; owners get both", async () => {
    const forManager = await getBookingMoney(testDb, s.actors.managerA, s.events.e1.id);
    expect(forManager?.billed).toBeNull();
    expect(forManager?.expectedProfit).toBeNull();
    expect(forManager?.committedCosts).toBeTypeOf("number");
    const forOwner = await getBookingMoney(testDb, s.actors.owner, s.events.e1.id);
    expect(forOwner?.billed).toBeTypeOf("number");
  });

  it("supervisors see no money and no quote amounts", async () => {
    expect(await getBookingMoney(testDb, s.actors.supervisor, s.events.e1.id)).toBeNull();
    const vendors = await getBookingVendors(testDb, s.actors.supervisor, s.events.e1.id);
    expect(vendors.length).toBe(2);
    expect(vendors.every((v) => v.agreed === null && v.latestQuote === null)).toBe(true);
    const crew = await getBookingCrew(testDb, s.actors.supervisor, s.events.e1.id);
    expect(crew.every((c) => c.pay === null)).toBe(true);
  });

  it("a vendor opening a booking sees only their own job", async () => {
    const vendors = await getBookingVendors(testDb, s.actors.vendor, s.events.e1.id);
    expect(vendors.map((v) => v.vendor)).toEqual(["V"]);
    expect(await getBookingCrew(testDb, s.actors.vendor, s.events.e1.id)).toEqual([]);
  });

  it("client contact details are hidden from crew and vendors", async () => {
    const forVendor = await getBookingHeader(testDb, s.actors.vendor, s.events.e1.id);
    expect(forVendor.client).toBeNull();
    const forOwner = await getBookingHeader(testDb, s.actors.owner, s.events.e1.id);
    expect(forOwner.client?.name).toBeTruthy();
  });

  it("refuses bookings outside a person's reach", async () => {
    await expect(getBookingHeader(testDb, s.actors.managerA, s.events.e2.id)).rejects.toThrow(/don't have access/);
  });
});
