import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { deliverPending, inAppDriver, setDrivers, type OutgoingNotification } from "@/modules/notifications/delivery";
import { notify } from "@/modules/notifications/notify";
import { approvalDigest, indiaClock, overdueTaskReminders, shiftReminders, unansweredCrewOffers } from "@/modules/reminders/jobs";
import { makeEvent, makeUser, makeWorker, testDb } from "./support/factories";

const HOUR = 3600_000;
// 10:30 India time today (05:00 UTC), so reminders are inside their sending hours.
const today = indiaClock(new Date()).day;
const now = new Date(Date.parse(`${today}T05:00:00Z`));
const night = new Date(Date.parse(`${today}T17:00:00Z`)); // 22:30 in India
const count = (userId: string, type: string) => testDb.notification.count({ where: { userId, type } });

let crewUser: string, managerId: string, ownerId: string, shiftId: string, offerUser: string;

beforeAll(async () => {
  ownerId = (await makeUser({ name: "RM Owner", roleKey: "OWNER" })).id;
  managerId = (await makeUser({ name: "RM Manager", roleKey: "EVENT_MANAGER" })).id;
  const ev = await makeEvent({ name: "RM Reception" });
  const u = await makeUser({ name: "RM Crew", roleKey: "LABOUR", accountType: "LABOUR" });
  crewUser = u.id;
  const w = await makeWorker("RM Crew");
  await testDb.worker.update({ where: { id: w.id }, data: { userId: u.id } });
  const a = await testDb.crewAssignment.create({ data: { eventId: ev.id, workerId: w.id, duty: "Lights", agreedPay: 900, status: "CONFIRMED" } });
  // Tomorrow 17:30 in India.
  const reportAt = new Date(Date.parse(`${today}T12:00:00Z`) + 24 * HOUR);
  shiftId = (await testDb.crewShift.create({ data: { assignmentId: a.id, date: new Date(`${reportAt.toISOString().slice(0, 10)}T00:00:00Z`), reportAt, location: "Gate 2" } })).id;
  // A shift the day after tomorrow is not reminded yet.
  await testDb.crewShift.create({ data: { assignmentId: a.id, date: new Date(Date.parse(`${today}T00:00:00Z`) + 2 * 24 * HOUR), reportAt: new Date(reportAt.getTime() + 24 * HOUR) } });
  await testDb.task.create({ data: { eventId: ev.id, title: "RM Confirm the DJ", status: "ASSIGNED", dueAt: new Date(now.getTime() - 2 * HOUR), assigneeId: managerId } });
  await testDb.task.create({ data: { eventId: ev.id, title: "RM Done already", status: "COMPLETED", dueAt: new Date(now.getTime() - 2 * HOUR), assigneeId: managerId } });
  await testDb.approvalRequest.create({ data: { type: "EXPENSE", entityId: crypto.randomUUID(), summary: "RM old approval", createdAt: new Date(now.getTime() - 13 * HOUR) } });
  const o = await makeUser({ name: "RM New crew", roleKey: "LABOUR", accountType: "LABOUR" });
  offerUser = o.id;
  const w2 = await makeWorker("RM New crew");
  await testDb.worker.update({ where: { id: w2.id }, data: { userId: o.id } });
  await testDb.crewAssignment.create({ data: { eventId: ev.id, workerId: w2.id, duty: "Decor", agreedPay: 800, status: "ASSIGNED", createdAt: new Date(now.getTime() - 30 * HOUR) } });
});
afterEach(() => setDrivers([inAppDriver]));
afterAll(() => testDb.$disconnect());

describe("reminders", () => {
  it("stay quiet at night", async () => {
    expect(await shiftReminders(testDb, night)).toBe(0);
    expect(await overdueTaskReminders(testDb, night)).toBe(0);
    expect(await approvalDigest(testDb, night)).toBe(0);
    expect(await unansweredCrewOffers(testDb, night)).toBe(0);
  });

  it("tell crew about tomorrow's shift, once", async () => {
    await shiftReminders(testDb, now);
    await shiftReminders(testDb, now);
    const n = await testDb.notification.findMany({ where: { userId: crewUser, type: "shift.tomorrow" } });
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ entityId: shiftId, link: "/crew" });
    expect(n[0].title).toMatch(/^Tomorrow: report by 17:30 at Gate 2$/);
  });

  it("remind about overdue tasks once a day", async () => {
    await overdueTaskReminders(testDb, now);
    await overdueTaskReminders(testDb, new Date(now.getTime() + HOUR));
    expect(await count(managerId, "task.overdue")).toBe(1);
    expect((await testDb.notification.findFirstOrThrow({ where: { userId: managerId, type: "task.overdue" } })).title).toBe("Overdue: RM Confirm the DJ");
    await overdueTaskReminders(testDb, new Date(now.getTime() + 24 * HOUR));
    expect(await count(managerId, "task.overdue")).toBe(2);
  });

  it("give owners one digest a day of approvals waiting 12 hours", async () => {
    await approvalDigest(testDb, now);
    await approvalDigest(testDb, now);
    expect(await count(ownerId, "approvals.waiting")).toBe(1);
  });

  it("nudge crew who haven't answered an offer for a day", async () => {
    await unansweredCrewOffers(testDb, now);
    await unansweredCrewOffers(testDb, now);
    expect(await count(offerUser, "crew.unanswered")).toBe(1);
  });
});

describe("delivery", () => {
  it("hands new notifications to the drivers people have on, then marks them delivered", async () => {
    const pushed: OutgoingNotification[] = [];
    const emailed: OutgoingNotification[] = [];
    setDrivers([inAppDriver, { channel: "push", deliver: async (n) => void pushed.push(n) }, { channel: "email", deliver: async (n) => void emailed.push(n) }]);
    await testDb.notificationPreference.create({ data: { userId: managerId, type: "test.ping", push: false, email: true } });
    await notify(testDb, [managerId, crewUser], { type: "test.ping", title: "RM ping" });
    await deliverPending(testDb, { limit: 1000 });
    expect(pushed.filter((n) => n.title === "RM ping").map((n) => n.userId)).toEqual([crewUser]);
    // Email is on only for the manager (off by default for everyone else).
    expect(emailed.filter((n) => n.title === "RM ping").map((n) => n.userId)).toEqual([managerId]);
    expect(await testDb.notification.count({ where: { title: "RM ping", deliveredAt: null } })).toBe(0);
  });

  it("a failing driver leaves it to be tried again", async () => {
    setDrivers([{ channel: "push", deliver: async () => Promise.reject(new Error("push service down")) }]);
    await notify(testDb, [crewUser], { type: "test.retry", title: "RM retry" });
    const r = await deliverPending(testDb, { limit: 1000 });
    expect(r.failed).toBeGreaterThanOrEqual(1);
    expect(await testDb.notification.count({ where: { title: "RM retry", deliveredAt: null } })).toBe(1);
    setDrivers([inAppDriver]);
    await deliverPending(testDb, { limit: 1000 });
    expect(await testDb.notification.count({ where: { title: "RM retry", deliveredAt: null } })).toBe(0);
  });
});
