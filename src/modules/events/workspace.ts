/**
 * The booking workspace, shaped for the person asking. Fields a role may not see are never loaded,
 * so they cannot leak into a page by mistake.
 */
import type { Db } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { toNumber } from "@/lib/format";
import type { Actor } from "@/modules/identity/actor";
import { assertEventAccess, can, crewAssignmentWhere, taskWhere, vendorAssignmentWhere } from "@/modules/identity/policy";

export async function getBookingHeader(db: Db, actor: Actor, eventId: string) {
  // The booking workspace is for staff; vendors and crew see their own job and shifts instead.
  if (actor.accountType !== "INTERNAL") throw new ForbiddenError();
  await assertEventAccess(db, actor, eventId);
  const event = await db.event.findUniqueOrThrow({
    where: { id: eventId },
    include: {
      category: { select: { name: true, color: true } },
      functions: { orderBy: { startsAt: "asc" }, include: { venue: { select: { name: true } } } },
      members: { include: { user: { select: { name: true } } } },
      _count: { select: { vendorAssignments: true, crewAssignments: true, tasks: true, proofs: true } },
    },
  });
  // Client details only for people allowed to see them (never vendors or crew).
  const client = can(actor, "clients.view")
    ? await db.client.findUnique({ where: { id: event.clientId }, select: { name: true, phone: true, type: true, contacts: { select: { name: true, relation: true, phone: true } } } })
    : null;
  return {
    id: event.id,
    code: event.code,
    name: event.name,
    status: event.status,
    category: event.category,
    startDate: event.startDate,
    endDate: event.endDate,
    expectedGuests: event.expectedGuests,
    description: event.description,
    client,
    functions: event.functions.map((f) => ({ id: f.id, name: f.name, date: f.date, startsAt: f.startsAt, endsAt: f.endsAt, venue: f.venue?.name ?? f.venueText, guests: f.expectedGuests })),
    managers: event.members.filter((m) => m.role === "MANAGER").map((m) => m.user.name),
    supervisors: event.members.filter((m) => m.role === "SUPERVISOR").map((m) => m.user.name),
    counts: event._count,
  };
}

export async function getBookingMoney(db: Db, actor: Actor, eventId: string) {
  const billing = can(actor, "finance.billing");
  const costs = can(actor, "finance.budget");
  if (actor.accountType !== "INTERNAL" || (!billing && !costs)) return null;
  // Only for bookings this person can reach (managers: their own bookings).
  await assertEventAccess(db, actor, eventId, costs ? "finance.budget" : "finance.billing");
  const [charges, received, vendorAgreed, crewPay, paidOut, budget] = await Promise.all([
    billing ? db.clientCharge.aggregate({ where: { eventId }, _sum: { amount: true } }) : null,
    billing ? db.payment.aggregate({ where: { eventId, direction: "IN", status: "PAID" }, _sum: { amount: true } }) : null,
    db.vendorAssignment.aggregate({ where: { eventId, status: { notIn: ["CANCELLED", "DECLINED"] } }, _sum: { agreedAmount: true } }),
    db.crewAssignment.aggregate({ where: { eventId, status: { notIn: ["CANCELLED", "DECLINED"] } }, _sum: { agreedPay: true } }),
    db.payment.aggregate({ where: { eventId, direction: "OUT", status: "PAID" }, _sum: { amount: true } }),
    db.budgetLine.aggregate({ where: { budget: { eventId, status: "APPROVED" } }, _sum: { estimatedAmount: true } }),
  ]);
  const committed = toNumber(vendorAgreed._sum.agreedAmount) + toNumber(crewPay._sum.agreedPay);
  return {
    billed: billing ? toNumber(charges!._sum.amount) : null,
    received: billing ? toNumber(received!._sum.amount) : null,
    committedCosts: committed,
    paidOut: toNumber(paidOut._sum.amount),
    budget: toNumber(budget._sum.estimatedAmount) || null,
    expectedProfit: billing ? toNumber(charges!._sum.amount) - committed : null,
  };
}

export async function getBookingVendors(db: Db, actor: Actor, eventId: string) {
  const seesQuotes = can(actor, "quotes.view");
  const rows = await db.vendorAssignment.findMany({
    where: { AND: [{ eventId }, vendorAssignmentWhere(actor)] },
    orderBy: [{ createdAt: "asc" }],
    include: {
      vendor: { select: { companyName: true, contactName: true, phone: true } },
      category: { select: { name: true, color: true } },
      functions: { include: { function: { select: { name: true, startsAt: true } } } },
      quotations: seesQuotes ? { orderBy: { version: "desc" }, take: 1, select: { version: true, total: true, status: true } } : false,
      workOrders: { orderBy: { issuedAt: "desc" }, take: 1, select: { number: true, status: true } },
      _count: { select: { proofs: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    vendorId: r.vendorId,
    vendor: r.vendor.companyName,
    contact: r.vendor.contactName,
    phone: r.vendor.phone,
    department: r.category?.name ?? null,
    color: r.category?.color ?? "#E6DCCB",
    scope: r.scopeOfWork,
    status: r.status,
    functions: r.functions.map((f) => f.function).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()).map((f) => f.name),
    agreed: seesQuotes && r.agreedAmount ? toNumber(r.agreedAmount) : null,
    latestQuote: seesQuotes && Array.isArray(r.quotations) && r.quotations[0] ? { version: r.quotations[0].version, total: toNumber(r.quotations[0].total), status: r.quotations[0].status } : null,
    workOrder: r.workOrders[0] ?? null,
    proofCount: r._count.proofs,
  }));
}

export async function getBookingCrew(db: Db, actor: Actor, eventId: string) {
  const seesPay = can(actor, "crew.pay.view");
  const rows = await db.crewAssignment.findMany({
    where: { AND: [{ eventId }, crewAssignmentWhere(actor)] },
    orderBy: [{ createdAt: "asc" }],
    include: {
      worker: { select: { name: true, phone: true, skills: { select: { skill: { select: { name: true } } } } } },
      shifts: { orderBy: { reportAt: "asc" }, include: { function: { select: { name: true } } } },
      adjustments: seesPay ? { select: { type: true, amount: true, state: true } } : false,
    },
  });
  return rows.map((r) => {
    const adjustments = Array.isArray(r.adjustments) ? r.adjustments : [];
    const approvedExtras = adjustments.filter((a) => a.state === "APPROVED").reduce((s, a) => s + (a.type === "EXTRA" ? 1 : -1) * toNumber(a.amount), 0);
    return {
      id: r.id,
      name: r.worker.name,
      phone: r.worker.phone,
      skills: r.worker.skills.map((s) => s.skill.name),
      duty: r.duty,
      status: r.status,
      declineReason: r.declineReason,
      shifts: r.shifts.map((s) => ({ id: s.id, function: s.function?.name ?? null, reportAt: s.reportAt, attendance: s.attendance, location: s.location, checkInAt: s.checkInAt, selfCheckIn: s.method === "SELF_GPS" })),
      pay: seesPay ? toNumber(r.agreedPay) + approvedExtras : null,
      pendingExtras: seesPay ? adjustments.filter((a) => a.state === "PENDING").length : 0,
    };
  });
}

export async function getBookingSchedule(db: Db, actor: Actor, eventId: string) {
  if (!can(actor, "schedule.view")) return [];
  return db.scheduleItem.findMany({
    where: { eventId },
    orderBy: [{ startsAt: "asc" }, { sortOrder: "asc" }],
    include: { function: { select: { id: true, name: true } } },
  });
}

export async function getBookingTasks(db: Db, actor: Actor, eventId: string) {
  return db.task.findMany({
    where: { AND: [{ eventId }, taskWhere(actor)] },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }],
    include: {
      assignee: { select: { name: true } },
      function: { select: { name: true } },
      comments: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, author: { select: { name: true } } } },
      // Proof that still counts (waiting or approved), so a redo request means "add another".
      _count: { select: { proofs: { where: { status: { in: ["PENDING_REVIEW", "APPROVED"] } } } } },
    },
  });
}
