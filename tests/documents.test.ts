import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadActor, type Actor } from "@/modules/identity/actor";
import { addDocument, crewDocuments, listDocuments, removeDocument } from "@/modules/documents/service";
import { monthCalendar } from "@/modules/events/calendar";
import { makeEvent, makeUser, makeVendor, makeWorker, testDb } from "./support/factories";

const actorOf = async (u: { id: string }) => (await loadActor(testDb, u.id))!;
let owner: Actor, manager: Actor, otherManager: Actor, supervisor: Actor, accountant: Actor, vendor: Actor, otherVendor: Actor, crew: Actor;
let eventId: string, vendorId: string;

let n = 0;
async function doc(actor: Actor) {
  return (await testDb.file.create({ data: { storageKey: `document/test/doc-${Date.now()}-${n++}/original`, filename: "plan.pdf", mimeType: "application/pdf", sizeBytes: 10, purpose: "DOCUMENT", status: "READY", uploadedById: actor.userId } })).id;
}

beforeAll(async () => {
  owner = await actorOf(await makeUser({ name: "DC Owner", roleKey: "OWNER" }));
  manager = await actorOf(await makeUser({ name: "DC Manager", roleKey: "EVENT_MANAGER" }));
  otherManager = await actorOf(await makeUser({ name: "DC Other", roleKey: "EVENT_MANAGER" }));
  supervisor = await actorOf(await makeUser({ name: "DC Supervisor", roleKey: "SUPERVISOR" }));
  accountant = await actorOf(await makeUser({ name: "DC Accountant", roleKey: "ACCOUNTANT" }));
  const ev = await makeEvent({ name: "DC Wedding" });
  eventId = ev.id;
  await testDb.eventFunction.create({ data: { eventId, name: "Wedding", date: new Date("2026-12-12T00:00:00Z"), startsAt: new Date("2026-12-12T19:00:00+05:30") } });
  await testDb.eventMember.createMany({ data: [{ eventId, userId: manager.userId, role: "MANAGER" }, { eventId, userId: supervisor.userId, role: "SUPERVISOR" }] });
  const v = await makeVendor("DC Decor");
  const v2 = await makeVendor("DC Lights");
  vendorId = v.id;

  const vu = await makeUser({ name: "DC Decor login", roleKey: "VENDOR", accountType: "VENDOR" });
  const vu2 = await makeUser({ name: "DC Lights login", roleKey: "VENDOR", accountType: "VENDOR" });
  await testDb.vendorUser.createMany({ data: [{ vendorId: v.id, userId: vu.id }, { vendorId: v2.id, userId: vu2.id }] });
  await testDb.vendorAssignment.createMany({ data: [{ eventId, vendorId: v.id, scopeOfWork: "Mandap", status: "ACCEPTED" }, { eventId, vendorId: v2.id, scopeOfWork: "Lights", status: "ACCEPTED" }] });
  vendor = await actorOf(vu);
  otherVendor = await actorOf(vu2);
  const w = await makeWorker("DC Crew");
  const cu = await makeUser({ name: "DC Crew login", roleKey: "LABOUR", accountType: "LABOUR" });
  await testDb.worker.update({ where: { id: w.id }, data: { userId: cu.id } });
  await testDb.crewAssignment.create({ data: { eventId, workerId: w.id, duty: "Helper", agreedPay: 700, status: "CONFIRMED" } });
  crew = await actorOf(cu);
});
afterAll(() => testDb.$disconnect());

describe("booking documents", () => {
  it("each level reaches exactly the right people", async () => {
    await addDocument(testDb, owner, { eventId, title: "Client contract", kind: "CONTRACT", visibility: "OWNER_ONLY", fileId: await doc(owner) });
    await addDocument(testDb, manager, { eventId, title: "Run of show notes", kind: "PLAN", visibility: "BOOKING_TEAM", fileId: await doc(manager) });
    await addDocument(testDb, manager, { eventId, title: "Venue permissions", kind: "OTHER", visibility: "INTERNAL", fileId: await doc(manager) });
    await addDocument(testDb, manager, { eventId, title: "Mandap design", kind: "DESIGN", visibility: "SHARED", shareVendorIds: [vendorId], fileId: await doc(manager) });
    await addDocument(testDb, manager, { eventId, title: "Venue layout", kind: "PLAN", visibility: "SHARED", shareWithCrew: true, fileId: await doc(manager) });

    const titles = async (a: Actor) => (await listDocuments(testDb, a, eventId)).map((d) => d.title).sort();
    expect(await titles(owner)).toHaveLength(5);
    expect(await titles(manager)).toEqual(["Mandap design", "Run of show notes", "Venue layout", "Venue permissions"]);
    expect(await titles(supervisor)).toEqual(["Mandap design", "Run of show notes", "Venue layout", "Venue permissions"]);
    expect(await titles(accountant)).toEqual(["Mandap design", "Venue layout", "Venue permissions"]);
    expect(await titles(vendor)).toEqual(["Mandap design"]);
    expect(await titles(otherVendor)).toEqual([]);
    expect(await titles(crew)).toEqual(["Venue layout"]);
    expect((await crewDocuments(testDb, crew)).map((d) => d.eventName)).toEqual(["DC Wedding"]);
    await expect(listDocuments(testDb, otherManager, eventId)).rejects.toThrow(/access/);
    expect(await testDb.notification.count({ where: { userId: vendor.userId, type: "document.shared" } })).toBe(1);
    const shared = (await listDocuments(testDb, manager, eventId)).find((d) => d.title === "Mandap design")!;
    expect(shared.sharedWith).toEqual(["DC Decor"]);
    expect(shared.file.originalUrl).toMatch(/\/original\?/);
    expect((await listDocuments(testDb, vendor, eventId))[0].sharedWith).toEqual([]);
  });

  it("refuses owner-only from non-owners, sharing with vendors not on the booking, and strangers", async () => {
    await expect(addDocument(testDb, manager, { eventId, title: "Margins", kind: "OTHER", visibility: "OWNER_ONLY", fileId: await doc(manager) })).rejects.toThrow(/Only owners/);
    const stranger = await testDb.vendor.create({ data: { contactName: "x", companyName: "DC Stranger" } });
    await expect(addDocument(testDb, manager, { eventId, title: "Layout", kind: "PLAN", visibility: "SHARED", shareVendorIds: [stranger.id], fileId: await doc(manager) })).rejects.toThrow(/only with vendors on this booking/);
    await expect(addDocument(testDb, manager, { eventId, title: "Layout", kind: "PLAN", visibility: "SHARED", fileId: await doc(manager) })).rejects.toThrow(/Pick who to share/);
    await expect(addDocument(testDb, otherManager, { eventId, title: "Layout", kind: "PLAN", visibility: "INTERNAL", fileId: await doc(otherManager) })).rejects.toThrow(/access/);
    await expect(addDocument(testDb, vendor, { eventId, title: "Layout", kind: "PLAN", visibility: "INTERNAL", fileId: await doc(vendor) })).rejects.toThrow(/Only the team/);
  });

  it("the uploader or an owner removes a document", async () => {
    const d = (await listDocuments(testDb, owner, eventId)).find((x) => x.title === "Venue permissions")!;
    await expect(removeDocument(testDb, supervisor, d.id)).rejects.toThrow(/Only the person who added it/);
    await removeDocument(testDb, manager, d.id);
    expect((await listDocuments(testDb, owner, eventId)).some((x) => x.id === d.id)).toBe(false);
  });
});

describe("calendar", () => {
  it("shows each function on its day, only for bookings the person can see", async () => {
    const cal = await monthCalendar(testDb, manager, "2026-12");
    expect(cal.days.get("2026-12-12")?.map((f) => f.eventName)).toContain("DC Wedding");
    expect(cal.prev).toBe("2026-11");
    expect(cal.next).toBe("2027-01");
    expect(cal.daysInMonth).toBe(31);
    const other = await monthCalendar(testDb, otherManager, "2026-12");
    expect([...other.days.values()].flat().some((f) => f.eventName === "DC Wedding")).toBe(false);
  });
});
