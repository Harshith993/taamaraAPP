import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadActor, type Actor } from "@/modules/identity/actor";
import { cancelBooking, getRequirements, removeFunction, removeScheduleItem, saveFunction, saveRequirement, saveScheduleItem, setScheduleDone, setTeam, teamCandidates, updateBookingDetails } from "@/modules/events/planning";
import { makeEvent, makeUser, makeVendor, makeWorker, testDb } from "./support/factories";

const actorOf = async (u: { id: string }) => (await loadActor(testDb, u.id))!;
let owner: Actor, manager: Actor, otherManager: Actor, supervisor: Actor, accountant: Actor, vendor: Actor;
let eventId: string, categoryId: string;
const day = (offset: number) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  owner = await actorOf(await makeUser({ name: "PL Owner", roleKey: "OWNER" }));
  manager = await actorOf(await makeUser({ name: "PL Manager", roleKey: "EVENT_MANAGER" }));
  otherManager = await actorOf(await makeUser({ name: "PL Other", roleKey: "EVENT_MANAGER" }));
  supervisor = await actorOf(await makeUser({ name: "PL Supervisor", roleKey: "SUPERVISOR" }));
  accountant = await actorOf(await makeUser({ name: "PL Accountant", roleKey: "ACCOUNTANT" }));
  const vu = await makeUser({ name: "PL Vendor", roleKey: "VENDOR", accountType: "VENDOR" });
  vendor = await actorOf(vu);
  const ev = await makeEvent({ name: "PL Wedding" });
  eventId = ev.id;
  categoryId = ev.categoryId;
  await testDb.eventFunction.create({ data: { eventId, name: "Wedding", date: new Date(`${day(10)}T00:00:00Z`), startsAt: new Date(`${day(10)}T19:00:00+05:30`) } });
  await testDb.eventMember.create({ data: { eventId, userId: manager.userId, role: "MANAGER" } });
});
afterAll(() => testDb.$disconnect());

describe("team", () => {
  it("owners choose the manager and supervisor; the new people are told", async () => {
    const candidates = await teamCandidates(testDb);
    expect(candidates.find((c) => c.id === supervisor.userId)?.supervisor).toBe(true);
    await expect(setTeam(testDb, manager, eventId, { managerIds: [manager.userId], supervisorIds: [supervisor.userId] })).rejects.toThrow(/Only hosts/);
    await expect(setTeam(testDb, owner, eventId, { managerIds: [supervisor.userId], supervisorIds: [] })).rejects.toThrow(/Pick managers/);
    const r = await setTeam(testDb, owner, eventId, { managerIds: [manager.userId], supervisorIds: [supervisor.userId] });
    expect(r).toEqual({ added: 1, removed: 0 });
    expect(await testDb.notification.count({ where: { userId: supervisor.userId, type: "booking.team" } })).toBe(1);
    const sup = await actorOf({ id: supervisor.userId });
    expect(await testDb.event.count({ where: { id: eventId, members: { some: { userId: sup.userId } } } })).toBe(1);
  });
});

describe("details and functions", () => {
  it("the manager edits details; others can't", async () => {
    await updateBookingDetails(testDb, manager, eventId, { name: "PL Wedding (Gupta)", categoryId, status: "PLANNING", expectedGuests: "450", shareHostContactWithVendors: true });
    const e = await testDb.event.findUniqueOrThrow({ where: { id: eventId } });
    expect(e.name).toBe("PL Wedding (Gupta)");
    expect(e.expectedGuests).toBe(450);
    expect(e.shareHostContactWithVendors).toBe(true);
    await expect(updateBookingDetails(testDb, otherManager, eventId, { name: "x x", categoryId, status: "PLANNING" })).rejects.toThrow(/access/);
    await expect(updateBookingDetails(testDb, supervisor, eventId, { name: "x x", categoryId, status: "PLANNING" })).rejects.toThrow(/can't edit/);
  });

  it("adding a function moves the booking's dates; moving one moves its crew shifts", async () => {
    const { id } = await saveFunction(testDb, manager, eventId, { name: "Sangeet", date: day(9), startTime: "19:00", endTime: "01:00", venueText: "Rambagh" });
    let e = await testDb.event.findUniqueOrThrow({ where: { id: eventId } });
    expect(e.startDate?.toISOString().slice(0, 10)).toBe(day(9));
    const fn = await testDb.eventFunction.findUniqueOrThrow({ where: { id } });
    expect(fn.endsAt!.getTime() - fn.startsAt.getTime()).toBe(6 * 3600_000);

    const w = await makeWorker("PL Crew");
    const a = await testDb.crewAssignment.create({ data: { eventId, workerId: w.id, duty: "Helper", agreedPay: 700, shifts: { create: { functionId: id, date: fn.date, reportAt: new Date(`${day(9)}T17:00:00+05:30`) } } } });
    await saveFunction(testDb, manager, eventId, { id, name: "Sangeet", date: day(8), startTime: "19:00" });
    const shift = await testDb.crewShift.findFirstOrThrow({ where: { assignmentId: a.id } });
    expect(shift.reportAt.toISOString()).toBe(new Date(`${day(8)}T17:00:00+05:30`).toISOString());
    e = await testDb.event.findUniqueOrThrow({ where: { id: eventId } });
    expect(e.startDate?.toISOString().slice(0, 10)).toBe(day(8));
    await expect(removeFunction(testDb, manager, eventId, id)).rejects.toThrow(/has crew, vendors or proof/);
  });

  it("an empty function can be removed, but not the last one", async () => {
    const { id } = await saveFunction(testDb, manager, eventId, { name: "Haldi", date: day(11), startTime: "10:00" });
    await removeFunction(testDb, manager, eventId, id);
    expect(await testDb.eventFunction.count({ where: { id } })).toBe(0);
    expect((await testDb.event.findUniqueOrThrow({ where: { id: eventId } })).endDate?.toISOString().slice(0, 10)).toBe(day(10));
  });
});

describe("run sheet", () => {
  it("the manager adds and edits items; the supervisor ticks them off; vendors can't touch it", async () => {
    const fn = await testDb.eventFunction.findFirstOrThrow({ where: { eventId, name: "Wedding" } });
    const { id } = await saveScheduleItem(testDb, manager, eventId, { functionId: fn.id, type: "CEREMONY", title: "Baraat arrives", date: day(10), time: "19:30", visibleToVendors: true });
    await saveScheduleItem(testDb, manager, eventId, { id, functionId: fn.id, type: "CEREMONY", title: "Baraat arrives at the gate", date: day(10), time: "19:45", visibleToVendors: true, visibleToCrew: true });
    const item = await testDb.scheduleItem.findUniqueOrThrow({ where: { id } });
    expect(item.title).toBe("Baraat arrives at the gate");
    expect(item.visibleToCrew).toBe(true);
    await expect(saveScheduleItem(testDb, supervisor, eventId, { type: "OTHER", title: "Nope", date: day(10), time: "20:00" })).rejects.toThrow(/can't change the run sheet/);
    const sup = await actorOf({ id: supervisor.userId });
    await setScheduleDone(testDb, sup, id, true);
    expect((await testDb.scheduleItem.findUniqueOrThrow({ where: { id } })).done).toBe(true);
    await expect(setScheduleDone(testDb, vendor, id, true)).rejects.toThrow(/can't tick off/);
    await expect(setScheduleDone(testDb, accountant, id, false)).rejects.toThrow(/can't tick off/);
    await removeScheduleItem(testDb, manager, eventId, id);
    expect(await testDb.scheduleItem.count({ where: { id } })).toBe(0);
  });
});

describe("requirements", () => {
  it("linking a requirement to a vendor's job marks it as being handled", async () => {
    const v = await makeVendor("PL Lights");
    const job = await testDb.vendorAssignment.create({ data: { eventId, vendorId: v.id, scopeOfWork: "Lights" } });
    const { id } = await saveRequirement(testDb, manager, eventId, { title: "Generator backup 125 kVA", quantity: "1", unit: "set", source: "CLIENT", vendorAssignmentId: job.id });
    const r = await testDb.requirement.findUniqueOrThrow({ where: { id } });
    expect(r.status).toBe("QUOTING");
    expect(r.source).toBe("CLIENT");
    await saveRequirement(testDb, manager, eventId, { id, title: "Generator backup 125 kVA", status: "COVERED", vendorAssignmentId: job.id });
    expect((await getRequirements(testDb, supervisor, eventId)).find((x) => x.id === id)?.status).toBe("COVERED");
    await expect(saveRequirement(testDb, supervisor, eventId, { title: "Extra chairs" })).rejects.toThrow(/can't change requirements/);
    expect(await getRequirements(testDb, vendor, eventId)).toEqual([]);
  });
});

describe("cancelling", () => {
  it("only owners cancel, with a reason; booked crew and the team are told", async () => {
    const w = await makeWorker("PL Crew 2");
    const cu = await makeUser({ name: "PL Crew 2 login", roleKey: "LABOUR", accountType: "LABOUR" });
    await testDb.worker.update({ where: { id: w.id }, data: { userId: cu.id } });
    await testDb.crewAssignment.create({ data: { eventId, workerId: w.id, duty: "Helper", agreedPay: 700, status: "CONFIRMED" } });
    await expect(cancelBooking(testDb, manager, eventId, "Client postponed")).rejects.toThrow(/Only hosts/);
    await expect(cancelBooking(testDb, owner, eventId, " ")).rejects.toThrow(/Write why/);
    await cancelBooking(testDb, owner, eventId, "Family emergency; moved to next year");
    const e = await testDb.event.findUniqueOrThrow({ where: { id: eventId } });
    expect(e.status).toBe("CANCELLED");
    expect(e.cancelledReason).toMatch(/Family emergency/);
    expect(await testDb.notification.count({ where: { userId: cu.id, type: "booking.cancelled" } })).toBe(1);
    expect(await testDb.notification.count({ where: { userId: manager.userId, type: "booking.cancelled" } })).toBe(1);
    await expect(saveFunction(testDb, manager, eventId, { name: "Late add", date: day(12), startTime: "10:00" })).rejects.toThrow(/closed/);
  });
});
