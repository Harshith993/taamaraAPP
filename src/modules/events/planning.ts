/**
 * Planning a booking after it is created: its details, functions, team, run sheet and requirements.
 *
 *  - Details and functions: bookings.edit (managers on their bookings, owners on all).
 *  - Team (managers and supervisors): bookings.assignTeam (owners).
 *  - Cancelling: bookings.cancel (owners), with a reason; everyone booked is told.
 *  - Run sheet: schedule.edit. Ticking items off on the day: schedule.edit or eventDay.run
 *    (the supervisor running the day).
 *  - Requirements: requirements.edit. A requirement linked to a vendor's job is what that vendor
 *    sees under "What's needed".
 */
import { z } from "zod";
import { inSequence, type Db, type DbTx } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatDate, formatTime } from "@/lib/format";
import { parseInput } from "@/lib/validate";
import { recordAudit, type RequestMeta } from "@/modules/audit/audit";
import type { Actor } from "@/modules/identity/actor";
import type { PermissionKey } from "@/modules/identity/permissions";
import { assertCan, assertEventAccess, can } from "@/modules/identity/policy";
import { notify, vendorUserIds } from "@/modules/notifications/notify";
import { toInstant } from "./service";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
const time = z.string().regex(/^\d{2}:\d{2}$/, "Pick a time.");
const CLOSED = ["COMPLETED", "SETTLED", "CANCELLED"];

async function assertOn(tx: DbTx, actor: Actor, eventId: string, permission: PermissionKey, message: string) {
  if (actor.accountType !== "INTERNAL") throw new ForbiddenError(message);
  assertCan(actor, permission, message);
  await assertEventAccess(tx, actor, eventId, permission);
  const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { name: true, status: true } });
  return event;
}

/** Keeps a booking's first and last day in step with its functions. */
async function syncDates(tx: DbTx, eventId: string) {
  const agg = await tx.eventFunction.aggregate({ where: { eventId }, _min: { date: true }, _max: { date: true } });
  await tx.event.update({ where: { id: eventId }, data: { startDate: agg._min.date, endDate: agg._max.date } });
}

// ───────────────────────────── Details ─────────────────────────────

export const bookingDetailsSchema = z.object({
  name: z.string().trim().min(2, "Name the booking.").max(120),
  categoryId: z.string().uuid("Pick the type of event."),
  status: z.enum(["TENTATIVE", "CONFIRMED", "PLANNING", "LIVE", "COMPLETED", "POSTPONED"]),
  expectedGuests: z.union([z.literal(""), z.coerce.number().int().min(0).max(100000)]).optional(),
  description: z.string().trim().max(2000).optional(),
  shareHostContactWithVendors: z.boolean().default(false),
});

export async function updateBookingDetails(db: Db, actor: Actor, eventId: string, input: z.input<typeof bookingDetailsSchema>, meta: RequestMeta = {}) {
  const v = parseInput(bookingDetailsSchema, input);
  return db.$transaction(async (tx) => {
    const before = await assertOn(tx, actor, eventId, "bookings.edit", "You can't edit this booking.");
    if (before.status === "CANCELLED" || before.status === "SETTLED") throw new ConflictError("This booking is closed.");
    const cat = await tx.eventCategory.findUnique({ where: { id: v.categoryId }, select: { active: true } });
    if (!cat?.active) throw new ValidationError("Pick the type of event.", { categoryId: "Pick the type of event." });
    await tx.event.update({
      where: { id: eventId },
      data: { name: v.name, categoryId: v.categoryId, status: v.status, expectedGuests: v.expectedGuests === "" || v.expectedGuests === undefined ? null : v.expectedGuests, description: v.description || null, shareHostContactWithVendors: v.shareHostContactWithVendors },
    });
    await recordAudit(tx, actor, { action: "update", entityType: "event", entityId: eventId, summary: `Edited ${v.name}${before.status !== v.status ? ` (status ${before.status} → ${v.status})` : ""}`, before: { name: before.name, status: before.status }, after: { name: v.name, status: v.status } }, meta);
  });
}

export async function cancelBooking(db: Db, actor: Actor, eventId: string, reason: string, meta: RequestMeta = {}) {
  const why = reason.trim();
  if (!why) throw new ValidationError("Write why the booking is cancelled.", { reason: "A reason is needed." });
  return db.$transaction(async (tx) => {
    const event = await assertOn(tx, actor, eventId, "bookings.cancel", "Only hosts cancel bookings.");
    if (CLOSED.includes(event.status)) throw new ConflictError("This booking is already closed.");
    await tx.event.update({ where: { id: eventId }, data: { status: "CANCELLED", cancelledReason: why } });
    const [members, jobs, crew] = await inSequence([
      tx.eventMember.findMany({ where: { eventId }, select: { userId: true } }),
      tx.vendorAssignment.findMany({ where: { eventId, status: { notIn: ["DECLINED", "CANCELLED", "COMPLETED"] } }, select: { id: true, vendorId: true } }),
      tx.crewAssignment.findMany({ where: { eventId, status: { in: ["ASSIGNED", "CONFIRMED"] } }, select: { worker: { select: { userId: true } } } }),
    ]);
    await notify(tx, members.map((m) => m.userId), { type: "booking.cancelled", title: `Cancelled: ${event.name}`, body: why, link: `/bookings/${eventId}`, entityType: "event", entityId: eventId }, { exceptUserId: actor.userId });
    for (const j of jobs) await notify(tx, await vendorUserIds(tx, j.vendorId), { type: "booking.cancelled", title: `Cancelled: ${event.name}`, body: "The manager will call you about any work already done.", link: `/vendor/jobs/${j.id}`, entityType: "vendor_assignment", entityId: j.id });
    await notify(tx, crew.map((c) => c.worker.userId), { type: "booking.cancelled", title: `Cancelled: ${event.name}`, body: "You are no longer needed for this booking.", link: "/crew", entityType: "event", entityId: eventId });
    await recordAudit(tx, actor, { action: "cancel", entityType: "event", entityId: eventId, summary: `Cancelled ${event.name} · ${why}` }, meta);
  });
}

// ───────────────────────────── Functions ─────────────────────────────

export const functionSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Name the function, e.g. Sangeet.").max(60),
  date,
  startTime: time,
  endTime: z.union([z.literal(""), time]).optional(),
  venueId: z.union([z.literal(""), z.string().uuid()]).optional(),
  venueText: z.string().trim().max(120).optional(),
  guests: z.union([z.literal(""), z.coerce.number().int().min(0).max(100000)]).optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type FunctionInput = z.input<typeof functionSchema>;

export async function saveFunction(db: Db, actor: Actor, eventId: string, input: FunctionInput, meta: RequestMeta = {}) {
  const v = parseInput(functionSchema, input);
  return db.$transaction(async (tx) => {
    const event = await assertOn(tx, actor, eventId, "bookings.edit", "You can't edit this booking.");
    if (CLOSED.includes(event.status)) throw new ConflictError("This booking is closed.");
    if (v.venueId && !(await tx.venue.count({ where: { id: v.venueId } }))) throw new ValidationError("Pick a venue from the list.", { venueId: "Pick a venue." });
    const startsAt = toInstant(v.date, v.startTime);
    let endsAt = v.endTime ? toInstant(v.date, v.endTime) : null;
    if (endsAt && endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + 24 * 3600_000);
    const data = {
      name: v.name,
      date: new Date(`${v.date}T00:00:00Z`),
      startsAt,
      endsAt,
      venueId: v.venueId || null,
      venueText: v.venueId ? null : v.venueText || null,
      expectedGuests: v.guests === "" || v.guests === undefined ? null : v.guests,
      notes: v.notes || null,
    };
    let id = v.id;
    if (id) {
      const fn = await tx.eventFunction.findFirst({ where: { id, eventId } });
      if (!fn) throw new NotFoundError("That function");
      await tx.eventFunction.update({ where: { id }, data });
      // Moving a function to another day moves its crew shifts with it (same clock time).
      if (fn.date.getTime() !== data.date.getTime()) {
        const shift = data.date.getTime() - fn.date.getTime();
        const shifts = await tx.crewShift.findMany({ where: { functionId: id }, select: { id: true, reportAt: true } });
        for (const s of shifts) await tx.crewShift.update({ where: { id: s.id }, data: { date: data.date, reportAt: new Date(s.reportAt.getTime() + shift) } });
      }
    } else {
      const count = await tx.eventFunction.count({ where: { eventId } });
      id = (await tx.eventFunction.create({ data: { ...data, eventId, sortOrder: count } })).id;
    }
    await syncDates(tx, eventId);
    await recordAudit(tx, actor, { action: v.id ? "update" : "create", entityType: "event_function", entityId: id, summary: `${v.id ? "Changed" : "Added"} ${v.name} on ${formatDate(startsAt)} ${formatTime(startsAt)} (${event.name})` }, meta);
    return { id };
  });
}

export async function removeFunction(db: Db, actor: Actor, eventId: string, functionId: string, meta: RequestMeta = {}) {
  return db.$transaction(async (tx) => {
    const event = await assertOn(tx, actor, eventId, "bookings.edit", "You can't edit this booking.");
    const fn = await tx.eventFunction.findFirst({ where: { id: functionId, eventId }, include: { _count: { select: { crewShifts: true, vendorLinks: true, proofs: true } } } });
    if (!fn) throw new NotFoundError("That function");
    if ((await tx.eventFunction.count({ where: { eventId } })) === 1) throw new ConflictError("A booking needs at least one function. Cancel the booking instead.");
    if (fn._count.crewShifts || fn._count.vendorLinks || fn._count.proofs) throw new ConflictError(`${fn.name} has crew, vendors or proof on it. Move them to another function first.`);
    await tx.eventFunction.delete({ where: { id: fn.id } });
    await syncDates(tx, eventId);
    await recordAudit(tx, actor, { action: "delete", entityType: "event_function", entityId: fn.id, summary: `Removed ${fn.name} from ${event.name}` }, meta);
  });
}

// ───────────────────────────── Team ─────────────────────────────

export const teamSchema = z.object({ managerIds: z.array(z.string().uuid()).max(6), supervisorIds: z.array(z.string().uuid()).max(10) });

/** People who can be put on a booking's team. */
export async function teamCandidates(db: DbTx) {
  const users = await db.user.findMany({
    where: { status: "ACTIVE", accountType: "INTERNAL", roles: { some: { role: { key: { in: ["EVENT_MANAGER", "SUPERVISOR"] } } } } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, roles: { select: { role: { select: { key: true } } } } },
  });
  return users.map((u) => ({ id: u.id, name: u.name, manager: u.roles.some((r) => r.role.key === "EVENT_MANAGER"), supervisor: u.roles.some((r) => r.role.key === "SUPERVISOR") }));
}

export async function setTeam(db: Db, actor: Actor, eventId: string, input: z.input<typeof teamSchema>, meta: RequestMeta = {}) {
  const v = parseInput(teamSchema, input);
  return db.$transaction(async (tx) => {
    const event = await assertOn(tx, actor, eventId, "bookings.assignTeam", "Only hosts choose a booking's team.");
    const candidates = await teamCandidates(tx);
    for (const id of v.managerIds) if (!candidates.find((c) => c.id === id)?.manager) throw new ValidationError("Pick managers from the list.", { managerIds: "Pick managers from the list." });
    for (const id of v.supervisorIds) if (!candidates.find((c) => c.id === id)?.supervisor) throw new ValidationError("Pick supervisors from the list.", { supervisorIds: "Pick supervisors from the list." });
    const before = await tx.eventMember.findMany({ where: { eventId }, select: { userId: true, role: true } });
    const want = [...v.managerIds.map((userId) => ({ userId, role: "MANAGER" as const })), ...v.supervisorIds.map((userId) => ({ userId, role: "SUPERVISOR" as const }))];
    const key = (m: { userId: string; role: string }) => `${m.userId}:${m.role}`;
    const removed = before.filter((b) => !want.some((w) => key(w) === key(b)));
    const added = want.filter((w) => !before.some((b) => key(b) === key(w)));
    for (const r of removed) await tx.eventMember.delete({ where: { eventId_userId_role: { eventId, userId: r.userId, role: r.role } } });
    if (added.length) await tx.eventMember.createMany({ data: added.map((a) => ({ ...a, eventId })) });
    for (const a of added) {
      await notify(tx, [a.userId], { type: "booking.team", title: `You're on ${event.name}`, body: a.role === "MANAGER" ? "As the manager." : "As the supervisor on site.", link: `/bookings/${eventId}`, entityType: "event", entityId: eventId }, { exceptUserId: actor.userId });
    }
    if (added.length || removed.length) {
      const names = new Map(candidates.map((c) => [c.id, c.name]));
      await recordAudit(tx, actor, { action: "update", entityType: "event_team", entityId: eventId, summary: `Team for ${event.name}: ${[...added.map((a) => `+${names.get(a.userId)} (${a.role.toLowerCase()})`), ...removed.map((r) => `−${names.get(r.userId) ?? "someone"} (${r.role.toLowerCase()})`)].join(", ")}` }, meta);
    }
    return { added: added.length, removed: removed.length };
  });
}

// ───────────────────────────── Run sheet ─────────────────────────────

export const scheduleItemSchema = z.object({
  id: z.string().uuid().optional(),
  functionId: z.union([z.literal(""), z.string().uuid()]).optional(),
  type: z.enum(["SETUP", "VENDOR_REPORTING", "CREW_REPORTING", "CEREMONY", "MEAL", "PERFORMANCE", "DISMANTLE", "DEADLINE", "OTHER"]),
  title: z.string().trim().min(2, "Say what happens.").max(120),
  date,
  time,
  endTime: z.union([z.literal(""), time]).optional(),
  location: z.string().trim().max(120).optional(),
  visibleToVendors: z.boolean().default(false),
  visibleToCrew: z.boolean().default(false),
});
export type ScheduleItemInput = z.input<typeof scheduleItemSchema>;

export async function saveScheduleItem(db: Db, actor: Actor, eventId: string, input: ScheduleItemInput, meta: RequestMeta = {}) {
  const v = parseInput(scheduleItemSchema, input);
  return db.$transaction(async (tx) => {
    const event = await assertOn(tx, actor, eventId, "schedule.edit", "You can't change the run sheet.");
    if (v.functionId && !(await tx.eventFunction.count({ where: { id: v.functionId, eventId } }))) throw new ValidationError("Pick a function from this booking.", { functionId: "Pick a function." });
    const startsAt = toInstant(v.date, v.time);
    let endsAt = v.endTime ? toInstant(v.date, v.endTime) : null;
    if (endsAt && endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + 24 * 3600_000);
    const data = { functionId: v.functionId || null, type: v.type, title: v.title, startsAt, endsAt, location: v.location || null, visibleToVendors: v.visibleToVendors, visibleToCrew: v.visibleToCrew };
    let id = v.id;
    if (id) {
      if (!(await tx.scheduleItem.count({ where: { id, eventId } }))) throw new NotFoundError("That run sheet item");
      await tx.scheduleItem.update({ where: { id }, data });
    } else {
      id = (await tx.scheduleItem.create({ data: { ...data, eventId } })).id;
    }
    await recordAudit(tx, actor, { action: v.id ? "update" : "create", entityType: "schedule_item", entityId: id, summary: `Run sheet (${event.name}): ${formatTime(startsAt)} ${v.title}` }, meta);
    return { id };
  });
}

export async function removeScheduleItem(db: Db, actor: Actor, eventId: string, itemId: string, meta: RequestMeta = {}) {
  return db.$transaction(async (tx) => {
    const event = await assertOn(tx, actor, eventId, "schedule.edit", "You can't change the run sheet.");
    const item = await tx.scheduleItem.findFirst({ where: { id: itemId, eventId } });
    if (!item) throw new NotFoundError("That run sheet item");
    await tx.scheduleItem.delete({ where: { id: item.id } });
    await recordAudit(tx, actor, { action: "delete", entityType: "schedule_item", entityId: item.id, summary: `Run sheet (${event.name}): removed ${formatTime(item.startsAt)} ${item.title}` }, meta);
  });
}

/** Ticks a run sheet item off on the day (or un-ticks it). */
export async function setScheduleDone(db: Db, actor: Actor, itemId: string, done: boolean) {
  return db.$transaction(async (tx) => {
    const item = await tx.scheduleItem.findUnique({ where: { id: itemId }, select: { id: true, eventId: true } });
    if (!item) throw new NotFoundError("That run sheet item");
    const permission: PermissionKey = can(actor, "schedule.edit") ? "schedule.edit" : "eventDay.run";
    await assertOn(tx, actor, item.eventId, permission, "You can't tick off the run sheet.");
    await tx.scheduleItem.update({ where: { id: item.id }, data: { done } });
  });
}

// ───────────────────────────── Requirements ─────────────────────────────

export const requirementSchema = z.object({
  id: z.string().uuid().optional(),
  functionId: z.union([z.literal(""), z.string().uuid()]).optional(),
  vendorCategoryId: z.union([z.literal(""), z.string().uuid()]).optional(),
  title: z.string().trim().min(2, "Say what is needed.").max(160),
  description: z.string().trim().max(1000).optional(),
  quantity: z.union([z.literal(""), z.coerce.number().positive().max(1_000_000)]).optional(),
  unit: z.string().trim().max(20).optional(),
  source: z.enum(["CLIENT", "INTERNAL"]).default("INTERNAL"),
  status: z.enum(["OPEN", "QUOTING", "COVERED", "DROPPED"]).default("OPEN"),
  vendorAssignmentId: z.union([z.literal(""), z.string().uuid()]).optional(),
});
export type RequirementInput = z.input<typeof requirementSchema>;

export async function saveRequirement(db: Db, actor: Actor, eventId: string, input: RequirementInput, meta: RequestMeta = {}) {
  const v = parseInput(requirementSchema, input);
  return db.$transaction(async (tx) => {
    const event = await assertOn(tx, actor, eventId, "requirements.edit", "You can't change requirements.");
    if (v.functionId && !(await tx.eventFunction.count({ where: { id: v.functionId, eventId } }))) throw new ValidationError("Pick a function from this booking.", { functionId: "Pick a function." });
    if (v.vendorAssignmentId && !(await tx.vendorAssignment.count({ where: { id: v.vendorAssignmentId, eventId } }))) throw new ValidationError("Pick a vendor on this booking.", { vendorAssignmentId: "Pick a vendor on this booking." });
    // Linking a vendor means it is being handled by them.
    const status = v.vendorAssignmentId && v.status === "OPEN" ? "QUOTING" : v.status;
    const data = {
      functionId: v.functionId || null,
      vendorCategoryId: v.vendorCategoryId || null,
      title: v.title,
      description: v.description || null,
      quantity: v.quantity === "" || v.quantity === undefined ? null : v.quantity,
      unit: v.unit || null,
      source: v.source,
      status,
      vendorAssignmentId: v.vendorAssignmentId || null,
    };
    let id = v.id;
    if (id) {
      if (!(await tx.requirement.count({ where: { id, eventId } }))) throw new NotFoundError("That requirement");
      await tx.requirement.update({ where: { id }, data });
    } else {
      id = (await tx.requirement.create({ data: { ...data, eventId, createdById: actor.userId } })).id;
    }
    await recordAudit(tx, actor, { action: v.id ? "update" : "create", entityType: "requirement", entityId: id, summary: `Requirement (${event.name}): ${v.title} · ${status.toLowerCase()}` }, meta);
    return { id };
  });
}

export async function getRequirements(db: Db, actor: Actor, eventId: string) {
  if (!can(actor, "requirements.view") || actor.accountType !== "INTERNAL") return [];
  await assertEventAccess(db, actor, eventId, "requirements.view");
  return db.requirement.findMany({
    where: { eventId },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    include: { function: { select: { name: true } }, vendorCategory: { select: { name: true, color: true } }, vendorAssignment: { select: { scopeOfWork: true, vendor: { select: { companyName: true } } } } },
  });
}
