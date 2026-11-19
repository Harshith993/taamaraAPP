import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { subscribe } from "@/lib/bus";
import { acknowledge, listAnnouncements, sendAnnouncement } from "@/modules/communication/announcements";
import { deleteMessage, listChannels, openChannel, postMessage, readThread, unreadTotal } from "@/modules/communication/chat";
import { loadActor, type Actor } from "@/modules/identity/actor";
import { makeEvent, makeFile, makeUser, makeVendor, makeWorker, testDb } from "./support/factories";

const actorOf = async (u: { id: string }) => (await loadActor(testDb, u.id))!;
let owner: Actor, manager: Actor, supervisor: Actor, outsider: Actor, accountant: Actor, vendor: Actor, otherVendor: Actor, crew: Actor, otherCrew: Actor;
let eventId: string, vendorId: string, otherVendorId: string;

async function crewLogin(name: string) {
  const u = await makeUser({ name, roleKey: "LABOUR", accountType: "LABOUR" });
  const w = await makeWorker(name);
  await testDb.worker.update({ where: { id: w.id }, data: { userId: u.id } });
  return { actor: await actorOf(u), workerId: w.id };
}

async function vendorLogin(name: string) {
  const v = await makeVendor(name);
  const u = await makeUser({ name: `${name} login`, roleKey: "VENDOR", accountType: "VENDOR" });
  await testDb.vendorUser.create({ data: { vendorId: v.id, userId: u.id } });
  return { actor: await actorOf(u), vendorId: v.id };
}

const notes = (userId: string, type: string) => testDb.notification.count({ where: { userId, type } });

beforeAll(async () => {
  owner = await actorOf(await makeUser({ name: "CM Owner", roleKey: "OWNER" }));
  const m = await makeUser({ name: "CM Manager", roleKey: "EVENT_MANAGER" });
  const s = await makeUser({ name: "CM Supervisor", roleKey: "SUPERVISOR" });
  outsider = await actorOf(await makeUser({ name: "CM Other manager", roleKey: "EVENT_MANAGER" }));
  accountant = await actorOf(await makeUser({ name: "CM Accountant", roleKey: "ACCOUNTANT" }));
  eventId = (await makeEvent({ name: "CM Haldi" })).id;
  await testDb.eventMember.createMany({ data: [{ eventId, userId: m.id, role: "MANAGER" }, { eventId, userId: s.id, role: "SUPERVISOR" }] });
  manager = await actorOf(m);
  supervisor = await actorOf(s);
  const v1 = await vendorLogin("CM Tent");
  const v2 = await vendorLogin("CM Caterer");
  vendor = v1.actor;
  vendorId = v1.vendorId;
  otherVendor = v2.actor;
  otherVendorId = v2.vendorId;
  await testDb.vendorAssignment.create({ data: { eventId, vendorId, scopeOfWork: "Tent", status: "ACCEPTED", agreedAmount: 10000 } });
  const c1 = await crewLogin("CM Sunil");
  const c2 = await crewLogin("CM Other crew");
  crew = c1.actor;
  otherCrew = c2.actor;
  await testDb.crewAssignment.create({ data: { eventId, workerId: c1.workerId, duty: "Setup", agreedPay: 800, status: "CONFIRMED" } });
});
afterAll(() => testDb.$disconnect());

describe("announcements", () => {
  let id: string;

  it("a manager sends one to the booking's crew, asking them to confirm", async () => {
    await expect(sendAnnouncement(testDb, manager, { audience: "ALL_STAFF", title: "Holiday", body: "Office closed" })).rejects.toThrow(/Only hosts/);
    await expect(sendAnnouncement(testDb, outsider, { audience: "BOOKING_CREW", eventId, title: "Gate 2", body: "Report at gate 2" })).rejects.toThrow(/access/);
    await expect(sendAnnouncement(testDb, vendor, { audience: "BOOKING_CREW", eventId, title: "Gate 2", body: "Report at gate 2" })).rejects.toThrow(/Only the team/);
    await expect(sendAnnouncement(testDb, manager, { audience: "BOOKING_CREW", title: "Gate 2", body: "Report at gate 2" })).rejects.toThrow(/Pick the booking/);
    const r = await sendAnnouncement(testDb, manager, { audience: "BOOKING_CREW", eventId, title: "Haldi: report at gate 2", body: "By 9 am, yellow T-shirts.", needsAck: true });
    id = r.id;
    expect(r.recipients).toBe(1);
    expect(await notes(crew.userId, "announcement")).toBe(1);
    expect(await notes(otherCrew.userId, "announcement")).toBe(0);
  });

  it("crew confirm; the sender sees who has and hasn't", async () => {
    const mine = await listAnnouncements(testDb, crew, { onlyWaiting: true });
    expect(mine.map((a) => a.id)).toEqual([id]);
    expect(mine[0].progress).toBeNull();
    expect((await listAnnouncements(testDb, manager)).find((a) => a.id === id)!.progress).toEqual({ recipients: 1, acked: 0, waiting: ["CM Sunil"] });
    await expect(acknowledge(testDb, otherCrew, id)).rejects.toThrow(/not found/);
    await acknowledge(testDb, crew, id);
    await acknowledge(testDb, crew, id); // twice is fine
    expect(await listAnnouncements(testDb, crew, { onlyWaiting: true })).toHaveLength(0);
    expect((await listAnnouncements(testDb, owner)).find((a) => a.id === id)!.progress).toEqual({ recipients: 1, acked: 1, waiting: [] });
  });

  it("each person sees only what is addressed to them", async () => {
    await sendAnnouncement(testDb, owner, { audience: "ALL_VENDORS", title: "New invoice format", body: "From December, add your GSTIN." });
    expect((await listAnnouncements(testDb, otherCrew)).some((a) => a.id === id)).toBe(false);
    expect((await listAnnouncements(testDb, vendor)).some((a) => a.id === id)).toBe(false);
    expect((await listAnnouncements(testDb, otherVendor)).some((a) => a.title === "New invoice format")).toBe(true);
    expect((await listAnnouncements(testDb, outsider)).some((a) => a.id === id)).toBe(false);
  });
});

describe("chat", () => {
  let team: string, thread: string, crewChat: string;

  it("the booking team chat is for the team; owners can join; others can't", async () => {
    team = await openChannel(testDb, manager, { type: "BOOKING_TEAM", eventId });
    expect(await openChannel(testDb, supervisor, { type: "BOOKING_TEAM", eventId })).toBe(team);
    expect(await openChannel(testDb, owner, { type: "BOOKING_TEAM", eventId })).toBe(team);
    await expect(openChannel(testDb, outsider, { type: "BOOKING_TEAM", eventId })).rejects.toThrow(/not found/);
    await expect(openChannel(testDb, accountant, { type: "BOOKING_TEAM", eventId })).rejects.toThrow(/not found/);
    await expect(openChannel(testDb, vendor, { type: "BOOKING_TEAM", eventId })).rejects.toThrow(/not found|can't start/);
    await expect(readThread(testDb, crew, team)).rejects.toThrow(/not found/);
  });

  it("a vendor thread is between the team and that vendor only", async () => {
    await expect(openChannel(testDb, manager, { type: "VENDOR_THREAD", eventId, vendorId: otherVendorId })).rejects.toThrow(/no job/);
    thread = await openChannel(testDb, manager, { type: "VENDOR_THREAD", eventId, vendorId });
    expect(await openChannel(testDb, vendor, { type: "VENDOR_THREAD", eventId, vendorId })).toBe(thread);
    await expect(openChannel(testDb, otherVendor, { type: "VENDOR_THREAD", eventId, vendorId })).rejects.toThrow(/not found/);
    await expect(readThread(testDb, otherVendor, thread)).rejects.toThrow(/not found/);
    expect((await listChannels(testDb, vendor)).map((c) => c.id)).toEqual([thread]);
  });

  it("the crew chat is for the team and crew on the booking", async () => {
    crewChat = await openChannel(testDb, crew, { type: "CREW", eventId });
    expect(await openChannel(testDb, supervisor, { type: "CREW", eventId })).toBe(crewChat);
    await expect(readThread(testDb, otherCrew, crewChat)).rejects.toThrow(/not found/);
    await expect(openChannel(testDb, otherCrew, { type: "CREW", eventId })).rejects.toThrow(/can't start|not found/);
  });

  it("messages arrive live; people are told once until they read", async () => {
    const heard: unknown[] = [];
    const stop = subscribe(`channel:${thread}`, (p) => heard.push(p));
    await expect(postMessage(testDb, manager, thread, { body: "  " })).rejects.toThrow(/Write a message/);
    await postMessage(testDb, manager, thread, { body: "Can you add 2 more fans by 4 pm?" });
    await postMessage(testDb, manager, thread, { body: "And the side drapes." });
    expect(heard).toHaveLength(2);
    stop();
    expect(await notes(vendor.userId, "chat.message")).toBe(1);
    expect(await unreadTotal(testDb, vendor)).toBe(2);
    const t = await readThread(testDb, vendor, thread);
    expect(t.messages.map((m) => [m.body, m.mine, m.from?.name])).toEqual([
      ["Can you add 2 more fans by 4 pm?", false, "CM Manager"],
      ["And the side drapes.", false, "CM Manager"],
    ]);
    expect(await unreadTotal(testDb, vendor)).toBe(0);
    await postMessage(testDb, manager, thread, { body: "Thanks!" });
    expect(await notes(vendor.userId, "chat.message")).toBe(2);
    await postMessage(testDb, vendor, thread, { body: "Done, both." });
    expect((await listChannels(testDb, manager)).find((c) => c.id === thread)!.last).toMatchObject({ body: "Done, both.", from: "CM Tent login" });
  });

  it("files must be your own finished upload; you can remove your message for 15 minutes", async () => {
    const someoneElses = await makeFile(manager.userId);
    await expect(postMessage(testDb, crew, crewChat, { body: "photo", fileId: someoneElses.id })).rejects.toThrow(/Attach the file/);
    const mine = await testDb.file.create({ data: { storageKey: `test/chat-${Date.now()}.jpg`, filename: "gate.jpg", mimeType: "image/jpeg", sizeBytes: 10, uploadedById: crew.userId, status: "READY", purpose: "DOCUMENT" } });
    const { id } = await postMessage(testDb, crew, crewChat, { body: "", fileId: mine.id });
    const t = await readThread(testDb, supervisor, crewChat);
    expect(t.messages.at(-1)!.attachments).toHaveLength(1);
    await expect(deleteMessage(testDb, supervisor, id)).rejects.toThrow(/not found/);
    await deleteMessage(testDb, crew, id);
    const after = await readThread(testDb, supervisor, crewChat);
    expect(after.messages.at(-1)).toMatchObject({ deleted: true, body: "", attachments: [] });
    await testDb.message.update({ where: { id }, data: { createdAt: new Date(Date.now() - 20 * 60_000), deletedAt: null } });
    await expect(deleteMessage(testDb, crew, id)).rejects.toThrow(/first 15 minutes/);
  });

  it("someone taken off the booking loses access at once", async () => {
    await testDb.crewAssignment.updateMany({ where: { eventId, worker: { userId: crew.userId } }, data: { status: "CANCELLED" } });
    await expect(readThread(testDb, crew, crewChat)).rejects.toThrow(/not found/);
    expect(await listChannels(testDb, crew)).toHaveLength(0);
  });
});
