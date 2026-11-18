/**
 * A small, realistic world for access tests:
 *
 *   Booking E1 (manager A, supervisor S)     Booking E2 (manager B)
 *     vendor V (has a login) booked            vendor V2 booked
 *     vendor V2 booked                         crew W (has a login) hired
 *     crew W2 hired
 */
import { loadActor } from "@/modules/identity/actor";
import { makeEvent, makeFile, makeUser, makeVendor, makeWorker, testDb } from "./factories";

export async function buildScenario() {
  const owner = await makeUser({ name: "Owner", roleKey: "OWNER" });
  const managerA = await makeUser({ name: "Manager A", roleKey: "EVENT_MANAGER" });
  const managerB = await makeUser({ name: "Manager B", roleKey: "EVENT_MANAGER" });
  const supervisor = await makeUser({ name: "Supervisor", roleKey: "SUPERVISOR" });
  const accountant = await makeUser({ name: "Accountant", roleKey: "ACCOUNTANT" });
  const vendorUser = await makeUser({ name: "Vendor login", roleKey: "VENDOR", accountType: "VENDOR" });
  const crewUser = await makeUser({ name: "Crew login", roleKey: "LABOUR", accountType: "LABOUR" });

  const e1 = await makeEvent({ name: "E1" });
  const e2 = await makeEvent({ name: "E2" });
  await testDb.eventMember.createMany({
    data: [
      { eventId: e1.id, userId: managerA.id, role: "MANAGER" },
      { eventId: e1.id, userId: supervisor.id, role: "SUPERVISOR" },
      { eventId: e2.id, userId: managerB.id, role: "MANAGER" },
    ],
  });

  const v = await makeVendor("V");
  const v2 = await makeVendor("V2");
  await testDb.vendorUser.create({ data: { vendorId: v.id, userId: vendorUser.id } });
  const vOnE1 = await testDb.vendorAssignment.create({ data: { eventId: e1.id, vendorId: v.id, scopeOfWork: "Lights", status: "IN_PROGRESS" } });
  const v2OnE1 = await testDb.vendorAssignment.create({ data: { eventId: e1.id, vendorId: v2.id, scopeOfWork: "Decor", status: "IN_PROGRESS" } });
  const v2OnE2 = await testDb.vendorAssignment.create({ data: { eventId: e2.id, vendorId: v2.id, scopeOfWork: "Catering", status: "ACCEPTED" } });
  await testDb.quotation.createMany({
    data: [
      { assignmentId: vOnE1.id, vendorId: v.id, version: 1, subtotal: 100, total: 118 },
      { assignmentId: v2OnE1.id, vendorId: v2.id, version: 1, subtotal: 200, total: 236 },
    ],
  });

  const w = await makeWorker("W");
  const w2 = await makeWorker("W2");
  await testDb.worker.update({ where: { id: w.id }, data: { userId: crewUser.id } });
  const wOnE2 = await testDb.crewAssignment.create({ data: { eventId: e2.id, workerId: w.id, duty: "Helper", agreedPay: 700 } });
  const w2OnE1 = await testDb.crewAssignment.create({ data: { eventId: e1.id, workerId: w2.id, duty: "Waiter", agreedPay: 800 } });

  const payments = {
    clientIn: await testDb.payment.create({ data: { direction: "IN", eventId: e1.id, partyType: "CLIENT", clientId: e1.clientId, amount: 1000, method: "UPI", status: "PAID", paidOn: new Date() } }),
    toV: await testDb.payment.create({ data: { direction: "OUT", eventId: e1.id, partyType: "VENDOR", vendorId: v.id, amount: 300, method: "BANK" } }),
    toV2OnE2: await testDb.payment.create({ data: { direction: "OUT", eventId: e2.id, partyType: "VENDOR", vendorId: v2.id, amount: 400, method: "BANK" } }),
    toW: await testDb.payment.create({ data: { direction: "OUT", eventId: e2.id, partyType: "WORKER", workerId: w.id, amount: 700, method: "CASH" } }),
  };

  const taskE1 = await testDb.task.create({ data: { eventId: e1.id, title: "E1 task for supervisor", assigneeId: supervisor.id } });
  const taskE2 = await testDb.task.create({ data: { eventId: e2.id, title: "E2 task for crew", assigneeId: crewUser.id } });
  const taskGeneral = await testDb.task.create({ data: { title: "General task for accountant", assigneeId: accountant.id } });

  const proofs = {
    byVendor: await testDb.workProof.create({ data: { eventId: e1.id, vendorAssignmentId: vOnE1.id, kind: "PHOTO", fileId: (await makeFile(vendorUser.id)).id, uploadedById: vendorUser.id } }),
    byCrew: await testDb.workProof.create({ data: { eventId: e2.id, crewAssignmentId: wOnE2.id, kind: "VIDEO", fileId: (await makeFile(crewUser.id)).id, uploadedById: crewUser.id } }),
    onE2Task: await testDb.workProof.create({ data: { eventId: e2.id, taskId: taskE2.id, kind: "PHOTO", fileId: (await makeFile(owner.id)).id, uploadedById: owner.id } }),
  };

  const actor = async (u: { id: string }) => (await loadActor(testDb, u.id))!;
  return {
    users: { owner, managerA, managerB, supervisor, accountant, vendorUser, crewUser },
    actors: {
      owner: await actor(owner), managerA: await actor(managerA), managerB: await actor(managerB), supervisor: await actor(supervisor),
      accountant: await actor(accountant), vendor: await actor(vendorUser), crew: await actor(crewUser),
    },
    events: { e1, e2 },
    vendors: { v, v2 },
    assignments: { vOnE1, v2OnE1, v2OnE2, wOnE2, w2OnE1 },
    workers: { w, w2 },
    payments,
    tasks: { taskE1, taskE2, taskGeneral },
    proofs,
  };
}
