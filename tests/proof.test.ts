import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadActor, type Actor } from "@/modules/identity/actor";
import { addProof, listProof, metresBetween, proofToCheckCount, reviewProof } from "@/modules/proof/service";
import { makeEvent, makeUser, makeVendor, makeWorker, testDb } from "./support/factories";

const actorOf = async (u: { id: string }) => (await loadActor(testDb, u.id))!;

let owner: Actor, manager: Actor, otherManager: Actor, supervisor: Actor, accountant: Actor;
let vendor: Actor, otherVendor: Actor, crew: Actor, otherCrew: Actor;
let eventId: string;
let acceptedJob: string, invitedJob: string, otherVendorJob: string, crewAssignment: string, otherCrewAssignment: string, crewTask: string;

let n = 0;
async function proofFile(actor: Actor, mimeType = "image/jpeg", status: "READY" | "PROCESSING" | "FAILED" = "READY") {
  const f = await testDb.file.create({ data: { storageKey: `proof/test/${Date.now()}-${n++}/original`, filename: "p.jpg", mimeType, sizeBytes: 100, purpose: "PROOF", status, uploadedById: actor.userId } });
  return f.id;
}

beforeAll(async () => {
  owner = await actorOf(await makeUser({ name: "PR Owner", roleKey: "OWNER" }));
  const m = await makeUser({ name: "PR Manager", roleKey: "EVENT_MANAGER" });
  const s = await makeUser({ name: "PR Supervisor", roleKey: "SUPERVISOR" });
  otherManager = await actorOf(await makeUser({ name: "PR Other Manager", roleKey: "EVENT_MANAGER" }));
  accountant = await actorOf(await makeUser({ name: "PR Accountant", roleKey: "ACCOUNTANT" }));
  const ev = await makeEvent({ name: "PR Wedding" });
  eventId = ev.id;
  const venue = await testDb.venue.create({ data: { name: "PR Lawns", latitude: 26.9124, longitude: 75.7873 } });
  const fn = await testDb.eventFunction.create({ data: { eventId, name: "Sangeet", date: new Date(), startsAt: new Date(), venueId: venue.id } });
  await testDb.eventMember.createMany({ data: [{ eventId, userId: m.id, role: "MANAGER" }, { eventId, userId: s.id, role: "SUPERVISOR" }] });
  manager = await actorOf(m);
  supervisor = await actorOf(s);

  const v = await makeVendor("PR Lights");
  const v2 = await makeVendor("PR Decor");
  const vu = await makeUser({ name: "PR Lights login", roleKey: "VENDOR", accountType: "VENDOR" });
  const vu2 = await makeUser({ name: "PR Decor login", roleKey: "VENDOR", accountType: "VENDOR" });
  await testDb.vendorUser.createMany({ data: [{ vendorId: v.id, userId: vu.id }, { vendorId: v2.id, userId: vu2.id }] });
  vendor = await actorOf(vu);
  otherVendor = await actorOf(vu2);
  acceptedJob = (await testDb.vendorAssignment.create({ data: { eventId, vendorId: v.id, scopeOfWork: "Uplighters", status: "ACCEPTED", functions: { create: { functionId: fn.id } } } })).id;
  invitedJob = (await testDb.vendorAssignment.create({ data: { eventId, vendorId: v.id, scopeOfWork: "Generator", status: "INVITED" } })).id;
  otherVendorJob = (await testDb.vendorAssignment.create({ data: { eventId, vendorId: v2.id, scopeOfWork: "Mandap", status: "IN_PROGRESS" } })).id;

  const w = await makeWorker("PR Sunil");
  const w2 = await makeWorker("PR Manoj");
  const cu = await makeUser({ name: "PR Sunil login", roleKey: "LABOUR", accountType: "LABOUR" });
  const cu2 = await makeUser({ name: "PR Manoj login", roleKey: "LABOUR", accountType: "LABOUR" });
  await testDb.worker.update({ where: { id: w.id }, data: { userId: cu.id } });
  await testDb.worker.update({ where: { id: w2.id }, data: { userId: cu2.id } });
  crew = await actorOf(cu);
  otherCrew = await actorOf(cu2);
  crewAssignment = (await testDb.crewAssignment.create({ data: { eventId, workerId: w.id, duty: "Drapes", agreedPay: 900, status: "CONFIRMED", shifts: { create: { functionId: fn.id, date: new Date(), reportAt: new Date() } } } })).id;
  otherCrewAssignment = (await testDb.crewAssignment.create({ data: { eventId, workerId: w2.id, duty: "Stage", agreedPay: 900, status: "CONFIRMED" } })).id;
  crewTask = (await testDb.task.create({ data: { eventId, functionId: fn.id, title: "Entrance garlands", assigneeId: cu.id, needsProof: true } })).id;
});
afterAll(() => testDb.$disconnect());

describe("adding proof", () => {
  it("a vendor adds photos to their own accepted job; the booking team is told", async () => {
    const before = await testDb.notification.count({ where: { userId: { in: [manager.userId, supervisor.userId] }, type: "proof.submitted" } });
    const r = await addProof(testDb, vendor, { target: { kind: "vendorJob", id: acceptedJob }, fileIds: [await proofFile(vendor), await proofFile(vendor, "video/mp4", "PROCESSING")], caption: "All uplighters on", latitude: 26.9125, longitude: 75.7874 });
    expect(r.count).toBe(2);
    const rows = await testDb.workProof.findMany({ where: { vendorAssignmentId: acceptedJob }, orderBy: { kind: "asc" } });
    expect(rows.map((p) => p.kind).sort()).toEqual(["PHOTO", "VIDEO"]);
    expect(rows.every((p) => p.functionId && p.status === "PENDING_REVIEW")).toBe(true);
    const after = await testDb.notification.count({ where: { userId: { in: [manager.userId, supervisor.userId] }, type: "proof.submitted" } });
    expect(after - before).toBe(2);
  });

  it("refuses jobs that are not booked yet, and other vendors' jobs", async () => {
    await expect(addProof(testDb, vendor, { target: { kind: "vendorJob", id: invitedJob }, fileIds: [await proofFile(vendor)] })).rejects.toThrow(/work order is accepted/);
    await expect(addProof(testDb, vendor, { target: { kind: "vendorJob", id: otherVendorJob }, fileIds: [await proofFile(vendor)] })).rejects.toThrow(/not found/);
    await expect(addProof(testDb, crew, { target: { kind: "vendorJob", id: acceptedJob }, fileIds: [await proofFile(crew)] })).rejects.toThrow(/not found/);
  });

  it("crew add proof to their own booking and their own tasks only", async () => {
    await addProof(testDb, crew, { target: { kind: "crewAssignment", id: crewAssignment }, fileIds: [await proofFile(crew)] });
    await addProof(testDb, crew, { target: { kind: "task", id: crewTask }, fileIds: [await proofFile(crew)] });
    await expect(addProof(testDb, crew, { target: { kind: "crewAssignment", id: otherCrewAssignment }, fileIds: [await proofFile(crew)] })).rejects.toThrow(/not found/);
    await expect(addProof(testDb, otherCrew, { target: { kind: "task", id: crewTask }, fileIds: [await proofFile(otherCrew)] })).rejects.toThrow(/not found/);
  });

  it("files must be the person's own, finished and unused", async () => {
    const someoneElses = await proofFile(otherCrew);
    await expect(addProof(testDb, crew, { target: { kind: "crewAssignment", id: crewAssignment }, fileIds: [someoneElses] })).rejects.toThrow(/still uploading or could not be used/);
    const failed = await proofFile(crew, "image/jpeg", "FAILED");
    await expect(addProof(testDb, crew, { target: { kind: "crewAssignment", id: crewAssignment }, fileIds: [failed] })).rejects.toThrow(/could not be used/);
    const once = await proofFile(crew);
    await addProof(testDb, crew, { target: { kind: "crewAssignment", id: crewAssignment }, fileIds: [once] });
    await expect(addProof(testDb, crew, { target: { kind: "crewAssignment", id: crewAssignment }, fileIds: [once] })).rejects.toThrow(/already sent/);
  });

  it("staff on the booking can add proof; staff elsewhere and the accountant cannot", async () => {
    await addProof(testDb, supervisor, { target: { kind: "vendorJob", id: otherVendorJob }, fileIds: [await proofFile(supervisor)] });
    await expect(addProof(testDb, otherManager, { target: { kind: "vendorJob", id: otherVendorJob }, fileIds: [await proofFile(otherManager)] })).rejects.toThrow(/access/);
    await expect(addProof(testDb, accountant, { target: { kind: "vendorJob", id: otherVendorJob }, fileIds: [await proofFile(accountant)] })).rejects.toThrow(/can't add proof/);
  });
});

describe("seeing proof", () => {
  it("each vendor and crew member sees only their own", async () => {
    const mine = await listProof(testDb, vendor);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((p) => p.about.startsWith("PR Lights"))).toBe(true);
    expect((await listProof(testDb, otherVendor)).every((p) => p.about.startsWith("PR Decor"))).toBe(true);
    const crewSees = await listProof(testDb, crew);
    expect(crewSees.length).toBe(3);
    expect(crewSees.every((p) => p.uploadedByMe)).toBe(true);
    expect(await listProof(testDb, otherCrew)).toEqual([]);
  });

  it("the booking team sees everything with review rights; other managers see nothing", async () => {
    const team = await listProof(testDb, supervisor, { eventId });
    expect(team.length).toBe(6);
    expect(team.filter((p) => p.canReview).length).toBe(5); // not their own upload
    expect(await listProof(testDb, otherManager, { eventId })).toEqual([]);
    // The outside accountant sees no proof photos (D56).
    expect(await listProof(testDb, accountant, { eventId })).toEqual([]);
    expect(await proofToCheckCount(testDb, supervisor)).toBeGreaterThanOrEqual(5);
  });

  it("shows how far from the venue it was sent, and the exact spot only to reviewers and the uploader", async () => {
    const forManager = (await listProof(testDb, manager, { target: { kind: "vendorJob", id: acceptedJob } })).find((p) => p.kind === "PHOTO")!;
    expect(forManager.distanceFromVenue).toBeLessThan(50);
    expect(forManager.location).not.toBeNull();
    expect(forManager.media.originalUrl).toMatch(/\/original\?/);
    // Someone who may see proof but not review it (e.g. the accountant, if a host gives proof back on
    // the Roles page) gets neither the exact spot nor the original file.
    const viewer: Actor = { ...accountant, grants: new Map([...accountant.grants, ["proof.view", "ALL"]]) };
    const forViewer = (await listProof(testDb, viewer, { target: { kind: "vendorJob", id: acceptedJob } })).find((p) => p.kind === "PHOTO")!;
    expect(forViewer.location).toBeNull();
    expect(forViewer.media.originalUrl).toBeNull();
    expect(metresBetween({ latitude: 26.9124, longitude: 75.7873 }, { latitude: 26.9214, longitude: 75.7873 })).toBeGreaterThan(990);
  });
});

describe("reviewing proof", () => {
  it("the supervisor approves; the vendor is told", async () => {
    const photo = await testDb.workProof.findFirstOrThrow({ where: { vendorAssignmentId: acceptedJob, kind: "PHOTO" } });
    await reviewProof(testDb, supervisor, photo.id, { decision: "APPROVE" });
    const after = await testDb.workProof.findUniqueOrThrow({ where: { id: photo.id } });
    expect(after.status).toBe("APPROVED");
    expect(after.reviewedById).toBe(supervisor.userId);
    expect(await testDb.notification.count({ where: { userId: vendor.userId, type: "proof.approved" } })).toBe(1);
    await expect(reviewProof(testDb, manager, photo.id, { decision: "REJECT", note: "late" })).rejects.toThrow(/already been checked/);
  });

  it("asking to redo needs a note, which reaches the crew member", async () => {
    const p = await testDb.workProof.findFirstOrThrow({ where: { taskId: crewTask } });
    await expect(reviewProof(testDb, manager, p.id, { decision: "REJECT" })).rejects.toThrow(/Say what needs/);
    await reviewProof(testDb, manager, p.id, { decision: "REJECT", note: "Garlands on the left are missing" });
    const note = await testDb.notification.findFirstOrThrow({ where: { userId: crew.userId, type: "proof.rejected" } });
    expect(note.body).toBe("Garlands on the left are missing");
    expect(note.link).toBe("/crew");
  });

  it("a file that is still being prepared can't be approved", async () => {
    const video = await testDb.workProof.findFirstOrThrow({ where: { vendorAssignmentId: acceptedJob, kind: "VIDEO" } });
    await expect(reviewProof(testDb, manager, video.id, { decision: "APPROVE" })).rejects.toThrow(/isn't ready/);
  });

  it("nobody but an owner approves their own upload; vendors, crew and other managers can't review", async () => {
    const own = await testDb.workProof.findFirstOrThrow({ where: { uploadedById: supervisor.userId } });
    await expect(reviewProof(testDb, supervisor, own.id, { decision: "APPROVE" })).rejects.toThrow(/Someone else/);
    const crewProof = await testDb.workProof.findFirstOrThrow({ where: { crewAssignmentId: crewAssignment, status: "PENDING_REVIEW" } });
    await expect(reviewProof(testDb, vendor, crewProof.id, { decision: "APPROVE" })).rejects.toThrow(/Only the team/);
    await expect(reviewProof(testDb, crew, crewProof.id, { decision: "APPROVE" })).rejects.toThrow(/Only the team/);
    await expect(reviewProof(testDb, otherManager, crewProof.id, { decision: "APPROVE" })).rejects.toThrow(/not found/);
    await expect(reviewProof(testDb, accountant, crewProof.id, { decision: "APPROVE" })).rejects.toThrow(/can't check proof/);
    await reviewProof(testDb, owner, own.id, { decision: "APPROVE" });
  });
});

describe("redo requests", () => {
  it("disappear once the person sends new proof", async () => {
    const before = await listProof(testDb, crew, { target: { kind: "task", id: crewTask } });
    const { openRedoRequests } = await import("@/modules/proof/service");
    expect(openRedoRequests(before)).toHaveLength(1);
    await addProof(testDb, crew, { target: { kind: "task", id: crewTask }, fileIds: [await proofFile(crew)] });
    const after = await listProof(testDb, crew, { target: { kind: "task", id: crewTask } });
    expect(openRedoRequests(after)).toHaveLength(0);
  });
});
