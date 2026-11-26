import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadActor, type Actor } from "@/modules/identity/actor";
import { can } from "@/modules/identity/policy";
import * as crewService from "@/modules/crew/service";
import { assignCrew, crewForBooking, removeCrew, respondToBooking } from "@/modules/crew/service";
import { addProof } from "@/modules/proof/service";
import { getSwitches, updateSwitches } from "@/modules/settings/service";
import { assignableForBooking, createTask, moveTask, reviewTask, taskActions } from "@/modules/tasks/service";
import { makeEvent, makeUser, makeWorker, testDb } from "./support/factories";

const actorOf = async (u: { id: string }) => (await loadActor(testDb, u.id))!;
let owner: Actor, manager: Actor, otherManager: Actor, supervisor: Actor, accountant: Actor, crew: Actor, otherCrew: Actor;
let eventId: string, otherEventId: string, fnId: string, workerId: string, otherWorkerId: string, offWorkerId: string;
const IST = "+05:30";
const day = (offset: number) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  owner = await actorOf(await makeUser({ name: "CT Owner", roleKey: "OWNER" }));
  const m = await makeUser({ name: "CT Manager", roleKey: "EVENT_MANAGER" });
  const s = await makeUser({ name: "CT Supervisor", roleKey: "SUPERVISOR" });
  otherManager = await actorOf(await makeUser({ name: "CT Other", roleKey: "EVENT_MANAGER" }));
  accountant = await actorOf(await makeUser({ name: "CT Accountant", roleKey: "ACCOUNTANT" }));
  const ev = await makeEvent({ name: "CT Sangeet" });
  eventId = ev.id;
  otherEventId = (await makeEvent({ name: "CT Other booking" })).id;
  const d = day(0);
  fnId = (await testDb.eventFunction.create({ data: { eventId, name: "Sangeet", date: new Date(`${d}T00:00:00Z`), startsAt: new Date(`${d}T19:00:00${IST}`) } })).id;
  const otherFn = await testDb.eventFunction.create({ data: { eventId: otherEventId, name: "Dinner", date: new Date(`${d}T00:00:00Z`), startsAt: new Date(`${d}T20:00:00${IST}`) } });
  await testDb.eventMember.createMany({ data: [{ eventId, userId: m.id, role: "MANAGER" }, { eventId, userId: s.id, role: "SUPERVISOR" }, { eventId: otherEventId, userId: otherManager.userId, role: "MANAGER" }] });
  manager = await actorOf(m);
  supervisor = await actorOf(s);

  const w = await makeWorker("CT Sunil");
  const w2 = await makeWorker("CT Manoj");
  const w3 = await makeWorker("CT Away");
  await testDb.worker.update({ where: { id: w.id }, data: { usualEventRate: 900 } });
  await testDb.workerUnavailability.create({ data: { workerId: w3.id, date: new Date(`${d}T00:00:00Z`), reason: "Family wedding" } });
  workerId = w.id;
  otherWorkerId = w2.id;
  offWorkerId = w3.id;
  const cu = await makeUser({ name: "CT Sunil login", roleKey: "LABOUR", accountType: "LABOUR" });
  const cu2 = await makeUser({ name: "CT Manoj login", roleKey: "LABOUR", accountType: "LABOUR" });
  await testDb.worker.update({ where: { id: w.id }, data: { userId: cu.id } });
  await testDb.worker.update({ where: { id: w2.id }, data: { userId: cu2.id } });
  crew = await actorOf(cu);
  otherCrew = await actorOf(cu2);
  // Manoj is already on the other booking that evening.
  await testDb.crewAssignment.create({ data: { eventId: otherEventId, workerId: w2.id, duty: "Serving", agreedPay: 800, status: "CONFIRMED", shifts: { create: { functionId: otherFn.id, date: otherFn.date, reportAt: otherFn.startsAt } } } });
});
afterAll(() => testDb.$disconnect());

describe("putting crew on a booking", () => {
  it("the manager hires with pay and a shift; the crew member is told", async () => {
    const r = await assignCrew(testDb, manager, { eventId, workerId, duty: "Stage drapes", agreedPay: 1000, shifts: [{ functionId: fnId, reportTime: "17:30", location: "Gate 2" }] });
    expect(r.warning).toBeNull();
    const a = await testDb.crewAssignment.findUniqueOrThrow({ where: { id: r.id }, include: { shifts: true } });
    expect(a.status).toBe("ASSIGNED");
    expect(Number(a.agreedPay)).toBe(1000);
    expect(a.shifts[0].reportAt.toISOString()).toBe(new Date(`${day(0)}T17:30:00${IST}`).toISOString());
    expect(await testDb.notification.count({ where: { userId: crew.userId, type: "crew.assigned" } })).toBe(1);
    await expect(assignCrew(testDb, manager, { eventId, workerId, duty: "Again", agreedPay: 1, shifts: [{ functionId: fnId, reportTime: "17:30" }] })).rejects.toThrow(/already on this booking/);
  });

  it("warns about double bookings and refuses days off", async () => {
    const r = await assignCrew(testDb, manager, { eventId, workerId: otherWorkerId, duty: "Helper", agreedPay: 700, shifts: [{ functionId: fnId, reportTime: "18:00" }] });
    expect(r.warning).toMatch(/also booked for CT Other booking/);
    await expect(assignCrew(testDb, manager, { eventId, workerId: offWorkerId, duty: "Helper", agreedPay: 700, shifts: [{ functionId: fnId, reportTime: "18:00" }] })).rejects.toThrow(/not available.*Family wedding/);
  });

  it("refuses people who don't run the booking", async () => {
    await expect(assignCrew(testDb, otherManager, { eventId, workerId: offWorkerId, duty: "Helper", agreedPay: 1, shifts: [{ functionId: fnId, reportTime: "18:00" }] })).rejects.toThrow(/access/);
    await expect(assignCrew(testDb, supervisor, { eventId, workerId: offWorkerId, duty: "Helper", agreedPay: 1, shifts: [{ functionId: fnId, reportTime: "18:00" }] })).rejects.toThrow(/can't add crew/);
  });

  it("lists crew with who is busy or away", async () => {
    const list = await crewForBooking(testDb, manager, eventId);
    expect(list.find((w) => w.id === workerId)?.onThisBooking).toBe(true);
    expect(list.find((w) => w.id === offWorkerId)?.unavailable).toBe(true);
    expect(list.find((w) => w.id === workerId)?.usualRate).toBe(900);
    expect(await crewForBooking(testDb, supervisor, eventId)).toEqual([]);
  });
});

describe("the crew member's answer", () => {
  it("accepting tells the manager; a decline needs a reason", async () => {
    const mine = await testDb.crewAssignment.findFirstOrThrow({ where: { eventId, workerId } });
    await expect(respondToBooking(testDb, otherCrew, mine.id, true)).rejects.toThrow(/not found/);
    await respondToBooking(testDb, crew, mine.id, true);
    expect((await testDb.crewAssignment.findUniqueOrThrow({ where: { id: mine.id } })).status).toBe("CONFIRMED");
    expect(await testDb.notification.count({ where: { userId: manager.userId, type: "crew.accepted" } })).toBe(1);
    await expect(respondToBooking(testDb, crew, mine.id, false, "ill")).rejects.toThrow(/already accepted/);

    const manoj = await testDb.crewAssignment.findFirstOrThrow({ where: { eventId, workerId: otherWorkerId } });
    await expect(respondToBooking(testDb, otherCrew, manoj.id, false)).rejects.toThrow(/Tell the manager why/);
    await respondToBooking(testDb, otherCrew, manoj.id, false, "Already working at another event");
    const after = await testDb.crewAssignment.findUniqueOrThrow({ where: { id: manoj.id } });
    expect(after.status).toBe("DECLINED");
    expect(after.declineReason).toBe("Already working at another event");
  });

  it("a declined crew member can be asked again", async () => {
    const r = await assignCrew(testDb, manager, { eventId, workerId: otherWorkerId, duty: "Helper, late shift", agreedPay: 750, shifts: [{ functionId: fnId, reportTime: "21:00" }] });
    const a = await testDb.crewAssignment.findUniqueOrThrow({ where: { id: r.id } });
    expect(a.status).toBe("ASSIGNED");
    expect(a.declineReason).toBeNull();
    await removeCrew(testDb, manager, r.id, "Found someone closer");
    expect((await testDb.crewAssignment.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("CANCELLED");
  });
});

describe("no attendance (D52)", () => {
  it("has no attendance actions and no self check-in switch", async () => {
    expect("markAttendance" in crewService).toBe(false);
    expect("selfCheckIn" in crewService).toBe(false);
    expect("crewSelfCheckIn" in (await getSwitches(testDb))).toBe(false);
    expect(can(crew, "eventDay.run")).toBe(false);
    expect(can(supervisor, "eventDay.run")).toBe(true);
  });

  it("crew can be paid and taken off without anyone marking them present", async () => {
    const shift = await testDb.crewShift.findFirstOrThrow({ where: { assignment: { eventId, workerId } } });
    expect(shift.attendance).toBe("PENDING");
    // Old attendance rows don't block taking someone off; only a payment does.
    const extra = await makeWorker("CT Extra");
    const r = await assignCrew(testDb, manager, { eventId, workerId: extra.id, duty: "Helper", agreedPay: 500, shifts: [{ functionId: fnId, reportTime: "18:00" }] });
    await testDb.crewShift.updateMany({ where: { assignmentId: r.id }, data: { attendance: "PRESENT" } });
    await removeCrew(testDb, manager, r.id, "Not needed after all");
    expect((await testDb.crewAssignment.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("CANCELLED");
  });

  it("only owners change the switches, and every change is in the audit log", async () => {
    const before = await getSwitches(testDb);
    await expect(updateSwitches(testDb, manager, before)).rejects.toThrow(/Only hosts/);
    await expect(updateSwitches(testDb, owner, { ...before, maxVideoSeconds: 5 })).rejects.toThrow(/At least 15/);
    await updateSwitches(testDb, owner, { ...before, proofFromGallery: !before.proofFromGallery });
    await updateSwitches(testDb, owner, before);
    const log = await testDb.auditLog.findFirst({ where: { entityType: "company_settings", summary: { contains: "Proof can come from the gallery" } }, orderBy: { createdAt: "desc" } });
    expect(log?.summary).toMatch(/to (on|off)/);
  });
});

describe("tasks", () => {
  let taskId: string;

  it("the manager adds a task for crew on the booking", async () => {
    const people = await assignableForBooking(testDb, eventId);
    expect(people.map((p) => p.name)).toEqual(expect.arrayContaining(["CT Manager", "CT Supervisor", "CT Sunil"]));
    expect(people.some((p) => p.name === "CT Manoj")).toBe(false); // took him off
    const r = await createTask(testDb, manager, { eventId, functionId: fnId, title: "Stage side drapes", assigneeId: crew.userId, dueDate: day(0), dueTime: "18:30", needsProof: true });
    taskId = r.id;
    const t = await testDb.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(t.status).toBe("ASSIGNED");
    expect(t.reviewerId).toBe(manager.userId);
    expect(await testDb.notification.count({ where: { userId: crew.userId, type: "task.assigned" } })).toBe(1);
    await expect(createTask(testDb, manager, { eventId, title: "For a stranger", assigneeId: otherCrew.userId })).rejects.toThrow(/someone on this booking/);
    await expect(createTask(testDb, otherManager, { eventId, title: "Not my booking" })).rejects.toThrow(/access/);
  });

  it("a task that needs proof can't be done without a photo, then waits to be checked", async () => {
    await moveTask(testDb, crew, taskId, "start");
    await expect(moveTask(testDb, crew, taskId, "done")).rejects.toThrow(/Add a photo/);
    const f = await testDb.file.create({ data: { storageKey: `proof/test/task-${Date.now()}/original`, filename: "d.jpg", mimeType: "image/jpeg", sizeBytes: 1, purpose: "PROOF", status: "READY", uploadedById: crew.userId } });
    await addProof(testDb, crew, { target: { kind: "task", id: taskId }, fileIds: [f.id] });
    const r = await moveTask(testDb, crew, taskId, "done");
    expect(r.status).toBe("UNDER_REVIEW");
    expect(await testDb.notification.count({ where: { userId: manager.userId, type: "task.review" } })).toBe(1);
    await expect(moveTask(testDb, otherCrew, taskId, "done")).rejects.toThrow(/not found/);
  });

  it("the team sends it back with a note, then signs it off", async () => {
    await expect(reviewTask(testDb, crew, taskId, { decision: "APPROVE" })).rejects.toThrow(/Only the team/);
    await expect(reviewTask(testDb, accountant, taskId, { decision: "APPROVE" })).rejects.toThrow(/can't sign tasks off/);
    await expect(reviewTask(testDb, supervisor, taskId, { decision: "SEND_BACK" })).rejects.toThrow(/Say what still/);
    await reviewTask(testDb, supervisor, taskId, { decision: "SEND_BACK", note: "Right side is loose" });
    expect((await testDb.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("IN_PROGRESS");
    expect((await testDb.notification.findFirstOrThrow({ where: { userId: crew.userId, type: "task.sentBack" } })).body).toBe("Right side is loose");
    await moveTask(testDb, crew, taskId, "done");
    await reviewTask(testDb, supervisor, taskId, { decision: "APPROVE" });
    const t = await testDb.task.findUniqueOrThrow({ where: { id: taskId }, include: { comments: true } });
    expect(t.status).toBe("COMPLETED");
    expect(t.approvedAt).not.toBeNull();
    expect(t.comments.map((c) => c.body)).toEqual(["Right side is loose"]);
  });

  it("a plain task is done straight away; the screen offers only what the server allows", async () => {
    const r = await createTask(testDb, manager, { eventId, title: "Call the tent house", assigneeId: supervisor.userId });
    expect((await moveTask(testDb, supervisor, r.id, "done")).status).toBe("COMPLETED");
    const task = { status: "ASSIGNED", assigneeId: crew.userId, needsProof: false, eventId };
    expect(taskActions(accountant, task, { onBooking: false, proofCount: 0 }).done).toBe(false);
    expect(taskActions(crew, task, { onBooking: false, proofCount: 0 }).done).toBe(true);
    expect(taskActions(manager, task, { onBooking: true, proofCount: 0 }).done).toBe(true);
    expect(taskActions(otherManager, task, { onBooking: false, proofCount: 0 }).done).toBe(false);
    expect(taskActions(manager, { ...task, status: "UNDER_REVIEW", assigneeId: manager.userId }, { onBooking: true, proofCount: 1 }).review).toBe(false);
  });
});
