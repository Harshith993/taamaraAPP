import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SWITCHES, computeGrants, loadActor } from "@/modules/identity/actor";
import {
  assertCan,
  assertEventAccess,
  can,
  crewAssignmentWhere,
  eventWhere,
  paymentWhere,
  proofWhere,
  taskWhere,
  vendorAssignmentWhere,
} from "@/modules/identity/policy";
import { DEFAULT_ROLE_GRANTS } from "@/modules/identity/permissions";
import { testDb } from "../support/factories";
import { buildScenario } from "../support/scenario";

let s: Awaited<ReturnType<typeof buildScenario>>;

beforeAll(async () => {
  s = await buildScenario();
});
afterAll(() => testDb.$disconnect());

/** Ids visible to an actor, limited to this scenario's records. */
async function visibleEvents(actor: (typeof s.actors)[keyof typeof s.actors], perm: Parameters<typeof eventWhere>[1] = "bookings.view") {
  const rows = await testDb.event.findMany({ where: { AND: [eventWhere(actor, perm), { id: { in: [s.events.e1.id, s.events.e2.id] } }] }, select: { name: true } });
  return rows.map((r) => r.name).sort();
}

describe("who sees which booking", () => {
  it("owners and the accountant see every booking", async () => {
    expect(await visibleEvents(s.actors.owner)).toEqual(["E1", "E2"]);
    expect(await visibleEvents(s.actors.accountant)).toEqual(["E1", "E2"]);
  });

  it("managers and supervisors see only bookings they are assigned to", async () => {
    expect(await visibleEvents(s.actors.managerA)).toEqual(["E1"]);
    expect(await visibleEvents(s.actors.managerB)).toEqual(["E2"]);
    expect(await visibleEvents(s.actors.supervisor)).toEqual(["E1"]);
  });

  it("a vendor sees only bookings they are booked on; crew only bookings they are hired for", async () => {
    expect(await visibleEvents(s.actors.vendor)).toEqual(["E1"]);
    expect(await visibleEvents(s.actors.crew)).toEqual(["E2"]);
  });

  it("a declined vendor job no longer opens the booking", async () => {
    await testDb.vendorAssignment.update({ where: { id: s.assignments.vOnE1.id }, data: { status: "DECLINED" } });
    expect(await visibleEvents(s.actors.vendor)).toEqual([]);
    await testDb.vendorAssignment.update({ where: { id: s.assignments.vOnE1.id }, data: { status: "IN_PROGRESS" } });
  });

  it("assertEventAccess refuses bookings outside a person's reach", async () => {
    await expect(assertEventAccess(testDb, s.actors.managerA, s.events.e1.id)).resolves.toBeUndefined();
    await expect(assertEventAccess(testDb, s.actors.managerA, s.events.e2.id)).rejects.toThrow(/don't have access/);
    await expect(assertEventAccess(testDb, s.actors.crew, s.events.e1.id)).rejects.toThrow(/don't have access/);
  });

  it("editing needs the edit permission, not just view", async () => {
    expect(await visibleEvents(s.actors.supervisor, "bookings.edit")).toEqual([]);
    expect(await visibleEvents(s.actors.accountant, "bookings.edit")).toEqual([]);
    expect(await visibleEvents(s.actors.managerA, "bookings.edit")).toEqual(["E1"]);
  });
});

describe("vendor jobs and quotes", () => {
  it("vendors see only their own jobs, never another vendor's on the same booking", async () => {
    const jobs = await testDb.vendorAssignment.findMany({ where: vendorAssignmentWhere(s.actors.vendor), select: { id: true } });
    expect(jobs.map((j) => j.id)).toEqual([s.assignments.vOnE1.id]);
    const quotes = await testDb.quotation.findMany({ where: { assignment: vendorAssignmentWhere(s.actors.vendor, "quotes.view") }, select: { vendorId: true } });
    expect(quotes.every((q) => q.vendorId === s.vendors.v.id)).toBe(true);
  });

  it("managers see quotes on their bookings; supervisors see none", async () => {
    const forA = await testDb.vendorAssignment.findMany({ where: { AND: [vendorAssignmentWhere(s.actors.managerA, "quotes.view"), { id: { in: Object.values(s.assignments).map((a) => a.id) } }] } });
    expect(forA.map((a) => a.id).sort()).toEqual([s.assignments.vOnE1.id, s.assignments.v2OnE1.id].sort());
    expect(can(s.actors.supervisor, "quotes.view")).toBe(false);
    expect(await testDb.vendorAssignment.count({ where: vendorAssignmentWhere(s.actors.supervisor, "quotes.view") })).toBe(0);
  });

  it("crew can never list vendor jobs", async () => {
    expect(await testDb.vendorAssignment.count({ where: vendorAssignmentWhere(s.actors.crew) })).toBe(0);
  });
});

describe("crew assignments and pay", () => {
  it("crew see only their own assignment", async () => {
    const rows = await testDb.crewAssignment.findMany({ where: crewAssignmentWhere(s.actors.crew), select: { id: true } });
    expect(rows.map((r) => r.id)).toEqual([s.assignments.wOnE2.id]);
  });

  it("vendors can never list crew", async () => {
    expect(await testDb.crewAssignment.count({ where: crewAssignmentWhere(s.actors.vendor) })).toBe(0);
  });

  it("supervisors cannot see pay; managers see pay only on their bookings", async () => {
    expect(can(s.actors.supervisor, "crew.pay.view")).toBe(false);
    const forB = await testDb.crewAssignment.findMany({ where: { AND: [crewAssignmentWhere(s.actors.managerB, "crew.pay.view"), { id: { in: [s.assignments.wOnE2.id, s.assignments.w2OnE1.id] } }] } });
    expect(forB.map((r) => r.id)).toEqual([s.assignments.wOnE2.id]);
  });
});

describe("payments", () => {
  const scenarioPayments = () => Object.values(s.payments).map((p) => p.id);
  async function visiblePayments(actor: (typeof s.actors)[keyof typeof s.actors]) {
    const rows = await testDb.payment.findMany({ where: { AND: [paymentWhere(actor), { id: { in: scenarioPayments() } }] }, select: { id: true } });
    return rows.map((r) => r.id).sort();
  }

  it("vendors see only payments to themselves", async () => {
    expect(await visiblePayments(s.actors.vendor)).toEqual([s.payments.toV.id]);
  });

  it("crew see only their own pay", async () => {
    expect(await visiblePayments(s.actors.crew)).toEqual([s.payments.toW.id]);
  });

  it("managers see what is paid out on their bookings, never client receipts", async () => {
    expect(await visiblePayments(s.actors.managerA)).toEqual([s.payments.toV.id]);
    expect(await visiblePayments(s.actors.managerB)).toEqual([s.payments.toV2OnE2.id, s.payments.toW.id].sort());
  });

  it("supervisors see no payments; owners and the accountant see all", async () => {
    expect(await visiblePayments(s.actors.supervisor)).toEqual([]);
    expect(await visiblePayments(s.actors.owner)).toEqual(scenarioPayments().sort());
    expect(await visiblePayments(s.actors.accountant)).toEqual(scenarioPayments().sort());
  });
});

describe("tasks and proof", () => {
  async function taskTitles(actor: (typeof s.actors)[keyof typeof s.actors]) {
    const ids = Object.values(s.tasks).map((t) => t.id);
    return (await testDb.task.findMany({ where: { AND: [taskWhere(actor), { id: { in: ids } }] }, select: { title: true } })).map((t) => t.title).sort();
  }

  it("everyone sees their own tasks; staff also see tasks on their bookings", async () => {
    expect(await taskTitles(s.actors.crew)).toEqual(["E2 task for crew"]);
    expect(await taskTitles(s.actors.accountant)).toEqual(["General task for accountant"]);
    expect(await taskTitles(s.actors.managerA)).toEqual(["E1 task for supervisor"]);
    expect(await taskTitles(s.actors.managerB)).toEqual(["E2 task for crew"]);
    expect((await taskTitles(s.actors.owner)).length).toBe(3);
  });

  async function proofIds(actor: (typeof s.actors)[keyof typeof s.actors]) {
    const ids = Object.values(s.proofs).map((p) => p.id);
    return (await testDb.workProof.findMany({ where: { AND: [proofWhere(actor), { id: { in: ids } }] }, select: { id: true } })).map((p) => p.id).sort();
  }

  it("vendors and crew see only their own proof", async () => {
    expect(await proofIds(s.actors.vendor)).toEqual([s.proofs.byVendor.id]);
    expect(await proofIds(s.actors.crew)).toEqual([s.proofs.byCrew.id]);
  });

  it("staff see proof by booking", async () => {
    expect(await proofIds(s.actors.supervisor)).toEqual([s.proofs.byVendor.id]);
    expect(await proofIds(s.actors.managerB)).toEqual([s.proofs.byCrew.id, s.proofs.onE2Task.id].sort());
  });
});

describe("actor loading", () => {
  it("owners hold every internal permission with scope ALL", () => {
    expect(s.actors.owner.isOwner).toBe(true);
    expect(s.actors.owner.grants.get("approvals.decide")).toBe("ALL");
    expect(s.actors.owner.grants.get("finance.billing")).toBe("ALL");
    expect(s.actors.owner.grants.has("jobs.respond")).toBe(false); // vendor-only permission
  });

  it("links vendor and crew logins to their records", () => {
    expect(s.actors.vendor.vendorIds).toEqual([s.vendors.v.id]);
    expect(s.actors.crew.workerId).toBe(s.workers.w.id);
    expect(s.actors.managerA.vendorIds).toEqual([]);
  });

  it("a switched-off account can do nothing", async () => {
    await testDb.user.update({ where: { id: s.users.managerA.id }, data: { status: "DISABLED" } });
    const off = (await loadActor(testDb, s.users.managerA.id))!;
    expect(can(off, "bookings.view")).toBe(false);
    expect(() => assertCan(off, "bookings.view")).toThrow();
    expect(await testDb.event.count({ where: eventWhere(off) })).toBe(0);
    await testDb.user.update({ where: { id: s.users.managerA.id }, data: { status: "ACTIVE" } });
  });

  it("a vendor login can never carry an internal role", async () => {
    const ownerRole = await testDb.role.findUniqueOrThrow({ where: { key: "OWNER" } });
    await testDb.userRole.create({ data: { userId: s.users.vendorUser.id, roleId: ownerRole.id } });
    const sneaky = (await loadActor(testDb, s.users.vendorUser.id))!;
    expect(sneaky.isOwner).toBe(false);
    expect(can(sneaky, "finance.company")).toBe(false);
    await testDb.userRole.delete({ where: { userId_roleId: { userId: s.users.vendorUser.id, roleId: ownerRole.id } } });
  });

  it("company switches hide crew pay; crew never run the event day", () => {
    const rows = Object.entries(DEFAULT_ROLE_GRANTS.LABOUR).map(([permission, scope]) => ({ permission, scope: scope! }));
    const on = computeGrants({ isOwner: false, accountType: "LABOUR", rolePermissions: rows, switches: { ...DEFAULT_SWITCHES, crewCanSeePay: true } });
    const off = computeGrants({ isOwner: false, accountType: "LABOUR", rolePermissions: rows, switches: { ...DEFAULT_SWITCHES, crewCanSeePay: false } });
    expect(on.has("crew.pay.view")).toBe(true);
    expect(off.has("crew.pay.view")).toBe(false);
    expect(off.has("payments.status")).toBe(false);
    // Stored rows can't hand crew the event day either (internal accounts only).
    const sneaky = computeGrants({ isOwner: false, accountType: "LABOUR", rolePermissions: [...rows, { permission: "eventDay.run", scope: "OWN" }], switches: DEFAULT_SWITCHES });
    expect(sneaky.has("eventDay.run")).toBe(false);
  });

  it("ignores stored grants that the catalogue does not allow", () => {
    const g = computeGrants({
      isOwner: false,
      accountType: "VENDOR",
      rolePermissions: [{ permission: "finance.company", scope: "ALL" }, { permission: "quotes.view", scope: "ALL" }, { permission: "made.up", scope: "ALL" }],
      switches: DEFAULT_SWITCHES,
    });
    expect(g.has("finance.company")).toBe(false);
    expect(g.get("quotes.view")).toBe("OWN"); // capped: vendor logins never hold "every record"
  });
});

describe("the outside accountant (D56)", () => {
  it("covers money only: no chats, crew personal details, proof, documents or run sheets", async () => {
    const a = s.actors.accountant;
    for (const p of ["finance.company", "finance.billing", "payments.prepare", "payments.markPaid", "payments.recordIn", "reports.finance", "vendors.bank", "crew.pay.view", "expenses.record", "audit.viewFinancial"] as const) expect(can(a, p), p).toBe(true);
    for (const p of ["chat.booking", "chat.direct", "announcements.send", "crew.view", "proof.view", "documents.view", "documents.upload", "schedule.view", "requirements.view", "eventDay.run", "approvals.decide", "admin.users"] as const) expect(can(a, p), p).toBe(false);
    const { getBookingCrew } = await import("@/modules/events/workspace");
    expect(await getBookingCrew(testDb, a, s.events.e1.id)).toEqual([]);
  });
});
