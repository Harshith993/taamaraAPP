import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bookEquipment,
  bookingEquipment,
  cancelEquipmentBooking,
  checkInEquipment,
  checkOutEquipment,
  equipmentAvailability,
  equipmentReport,
  listEquipment,
  resolveEquipmentIssue,
  saveEquipmentItem,
} from "@/modules/equipment/service";
import { loadActor, type Actor } from "@/modules/identity/actor";
import { makeEvent, makeFile, makeUser, testDb } from "./support/factories";

const actorOf = async (u: { id: string }) => (await loadActor(testDb, u.id))!;
let owner: Actor, manager: Actor, otherManager: Actor, supervisor: Actor, accountant: Actor;
let wedding: string, party: string, chairs: string;
const day = (offset: number) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  owner = await actorOf(await makeUser({ name: "EQ Host", roleKey: "OWNER" }));
  const m = await makeUser({ name: "EQ Manager", roleKey: "EVENT_MANAGER" });
  const s = await makeUser({ name: "EQ Supervisor", roleKey: "SUPERVISOR" });
  otherManager = await actorOf(await makeUser({ name: "EQ Other", roleKey: "EVENT_MANAGER" }));
  accountant = await actorOf(await makeUser({ name: "EQ Accountant", roleKey: "ACCOUNTANT" }));
  wedding = (await makeEvent({ name: "EQ Wedding" })).id;
  party = (await makeEvent({ name: "EQ Party" })).id;
  await testDb.eventMember.createMany({ data: [{ eventId: wedding, userId: m.id, role: "MANAGER" }, { eventId: wedding, userId: s.id, role: "SUPERVISOR" }, { eventId: party, userId: otherManager.userId, role: "MANAGER" }] });
  manager = await actorOf(m);
  supervisor = await actorOf(s);
});
afterAll(() => testDb.$disconnect());

describe("the equipment register (D58)", () => {
  it("hosts and managers add items with a photo; supervisors and the accountant can't", async () => {
    const photo = (await testDb.file.update({ where: { id: (await makeFile(manager.userId)).id }, data: { purpose: "DOCUMENT" } })).id;
    chairs = (await saveEquipmentItem(testDb, manager, { name: "EQ Gold chiavari chair", category: "FURNITURE", quantity: 100, location: "Godown B", photoFileId: photo })).id;
    await expect(saveEquipmentItem(testDb, supervisor, { name: "EQ Lamp", category: "LIGHTING", quantity: 4 })).rejects.toThrow(/can't change the equipment register/);
    await expect(saveEquipmentItem(testDb, accountant, { name: "EQ Lamp", category: "LIGHTING", quantity: 4 })).rejects.toThrow(/can't change/);
    await expect(saveEquipmentItem(testDb, owner, { name: "EQ Lamp", category: "LIGHTING", quantity: 4, photoFileId: (await makeFile(manager.userId)).id })).rejects.toThrow(/Attach a photo/);
    await expect(listEquipment(testDb, accountant)).rejects.toThrow(/can't see/);
    const list = await listEquipment(testDb, owner, { q: "EQ Gold" });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ quantity: 100, inStore: 100, out: 0, category: "FURNITURE" });
    expect(await testDb.auditLog.count({ where: { entityType: "equipment", entityId: chairs } })).toBe(1);
  });

  it("books items out for a booking's dates and warns on clashes", async () => {
    const a = await bookEquipment(testDb, manager, { eventId: wedding, itemId: chairs, quantity: 80, from: day(10), to: day(12) });
    expect(a.warning).toBeNull();
    await expect(bookEquipment(testDb, otherManager, { eventId: wedding, itemId: chairs, quantity: 5, from: day(10), to: day(12) })).rejects.toThrow(/access/);
    await expect(bookEquipment(testDb, otherManager, { eventId: party, itemId: chairs, quantity: 101, from: day(11), to: day(11) })).rejects.toThrow(/owns 100/);
    const clash = await bookEquipment(testDb, otherManager, { eventId: party, itemId: chairs, quantity: 40, from: day(12), to: day(13) });
    expect(clash.warning).toMatch(/Clash.*EQ Wedding \(80.*20 short/);
    const free = await equipmentAvailability(testDb, otherManager, party, day(11), day(11));
    expect(free.find((i) => i.id === chairs)?.free).toBe(20);
    const mine = await bookingEquipment(testDb, manager, wedding);
    expect(mine[0]).toMatchObject({ quantity: 80, status: "RESERVED", short: 20 });
    const report = await equipmentReport(testDb, owner);
    expect(report.clashes.find((c) => c.itemName === "EQ Gold chiavari chair")?.short).toBe(20);
    // No clash on dates that don't overlap.
    expect((await bookEquipment(testDb, otherManager, { eventId: party, itemId: chairs, quantity: 50, from: day(20), to: day(21) })).warning).toBeNull();
    await cancelEquipmentBooking(testDb, otherManager, clash.id, "Hiring instead");
    expect((await bookingEquipment(testDb, manager, wedding))[0].short).toBe(0);
  });

  it("checks out and back in; missing and damaged need a note, are reported and can be settled", async () => {
    const [row] = await bookingEquipment(testDb, supervisor, wedding);
    await expect(checkInEquipment(testDb, supervisor, row.id, { good: 80 })).rejects.toThrow(/Check it out first/);
    await checkOutEquipment(testDb, supervisor, row.id, { note: "Packed in 8 bundles" });
    expect((await listEquipment(testDb, owner, { q: "EQ Gold" }))[0]).toMatchObject({ out: 80, inStore: 20 });
    await expect(cancelEquipmentBooking(testDb, manager, row.id, "x")).rejects.toThrow(/out at the venue/);
    await expect(checkInEquipment(testDb, supervisor, row.id, { good: 70 })).rejects.toThrow(/add up to 80/);
    await expect(checkInEquipment(testDb, supervisor, row.id, { good: 76, damaged: 3, missing: 1 })).rejects.toThrow(/Say what was damaged/);
    await checkInEquipment(testDb, supervisor, row.id, { good: 76, damaged: 3, missing: 1, note: "3 broken legs; 1 not found after the baraat" });
    expect(await testDb.notification.count({ where: { userId: owner.userId, type: "equipment.problem" } })).toBe(1);
    const after = (await listEquipment(testDb, owner, { q: "EQ Gold" }))[0];
    expect(after).toMatchObject({ out: 0, missing: 1, damaged: 3, inStore: 99 });
    const report = await equipmentReport(testDb, manager);
    expect(report.issues.find((i) => i.id === row.id)).toMatchObject({ missing: 1, damaged: 3 });
    await expect(resolveEquipmentIssue(testDb, supervisor, row.id, "Found")).rejects.toThrow(/Only hosts and managers/);
    await resolveEquipmentIssue(testDb, owner, row.id, "Chair found in the van; 3 sent for repair");
    expect((await equipmentReport(testDb, owner)).issues.find((i) => i.id === row.id)).toBeUndefined();
    await expect(testDb.inventoryAllocation.delete({ where: { id: row.id } })).rejects.toThrow(/never deleted/);
  });
});
