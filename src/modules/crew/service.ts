/**
 * Crew on a booking: hiring, the crew member's answer, and attendance on the day.
 *
 *   ASSIGNED ──crew accepts──▶ CONFIRMED ──(event done)──▶ COMPLETED
 *       └──crew declines──▶ DECLINED            team takes them off ──▶ CANCELLED
 *
 *  - Managers (crew.assign) put crew on bookings they run, with an agreed pay for the event (A3) and
 *    one shift per function. Unavailable days are refused; double bookings are allowed with a warning.
 *  - Crew accept or decline from their phone.
 *  - Attendance: the supervisor or manager marks present / late / absent (open question 4). When the
 *    owners switch on self check-in, crew tap "I'm here" and their location is recorded.
 *    Marking opens 6 hours before the reporting time and closes 18 hours after it.
 */
import { z } from "zod";
import { inSequence, type Db, type DbTx } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatCalendarDate, formatDate, formatINR, formatTime, toNumber } from "@/lib/format";
import { parseInput } from "@/lib/validate";
import { recordAudit, type RequestMeta } from "@/modules/audit/audit";
import type { Actor } from "@/modules/identity/actor";
import { assertCan, assertEventAccess, can, crewAssignmentWhere } from "@/modules/identity/policy";
import { bookingTeamUserIds, notify } from "@/modules/notifications/notify";

const IST = "+05:30";
const HOUR = 3600_000;
export const LATE_AFTER_MINUTES = 15;

async function assertStaffOn(tx: DbTx, actor: Actor, eventId: string, permission: "crew.assign" | "attendance.mark", message: string) {
  if (actor.accountType !== "INTERNAL") throw new ForbiddenError(message);
  assertCan(actor, permission, message);
  await assertEventAccess(tx, actor, eventId, permission);
}

// ───────────────────────────── Hiring ─────────────────────────────

const hhmm = z.string().regex(/^\d{2}:\d{2}$/, "Pick a time.");

export const assignCrewSchema = z.object({
  eventId: z.string().uuid(),
  workerId: z.string().uuid("Pick a crew member."),
  duty: z.string().trim().min(2, "Say what they will do, e.g. Stage decor.").max(120),
  agreedPay: z.coerce.number({ message: "Enter the pay for the event." }).min(0, "Can't be negative.").max(1_000_000).optional(),
  shifts: z
    .array(z.object({ functionId: z.string().uuid(), reportTime: hhmm, location: z.string().trim().max(120).optional() }))
    .min(1, "Pick at least one function."),
});
export type AssignCrewInput = z.input<typeof assignCrewSchema>;

/** Puts a crew member on a booking (or back on it, after they declined). */
export async function assignCrew(db: Db, actor: Actor, input: AssignCrewInput, meta: RequestMeta = {}) {
  const v = parseInput(assignCrewSchema, input);
  return db.$transaction(async (tx) => {
    await assertStaffOn(tx, actor, v.eventId, "crew.assign", "You can't add crew to this booking.");
    const [event, worker, fns] = await inSequence([
      tx.event.findUniqueOrThrow({ where: { id: v.eventId }, select: { name: true, status: true } }),
      tx.worker.findFirst({ where: { id: v.workerId, deletedAt: null }, select: { id: true, name: true, status: true, userId: true, usualEventRate: true } }),
      tx.eventFunction.findMany({ where: { eventId: v.eventId, id: { in: v.shifts.map((s) => s.functionId) } }, select: { id: true, name: true, date: true } }),
    ]);
    if (["COMPLETED", "SETTLED", "CANCELLED"].includes(event.status)) throw new ConflictError("This booking is closed.");
    if (!worker || worker.status !== "ACTIVE") throw new ValidationError("Pick an active crew member.", { workerId: "Pick an active crew member." });
    if (fns.length !== new Set(v.shifts.map((s) => s.functionId)).size) throw new ValidationError("Pick functions from this booking.", { shifts: "Pick functions from this booking." });

    // Only people who see pay can set it; others get the usual rate.
    const pay = can(actor, "crew.pay.view") && v.agreedPay !== undefined ? v.agreedPay : toNumber(worker.usualEventRate);
    if (can(actor, "crew.pay.view") && v.agreedPay === undefined && !worker.usualEventRate) throw new ValidationError("Enter the pay for the event.", { agreedPay: "Enter the pay for the event." });

    const dates = fns.map((f) => f.date);
    const off = await tx.workerUnavailability.findMany({ where: { workerId: worker.id, date: { in: dates } }, select: { date: true, reason: true } });
    if (off.length) throw new ConflictError(`${worker.name} is not available on ${off.map((o) => formatCalendarDate(o.date, { day: "numeric", month: "short" })).join(", ")}${off[0].reason ? ` (${off[0].reason})` : ""}.`);

    const existing = await tx.crewAssignment.findUnique({ where: { eventId_workerId: { eventId: v.eventId, workerId: worker.id } }, select: { id: true, status: true } });
    if (existing && !["DECLINED", "CANCELLED"].includes(existing.status)) throw new ConflictError(`${worker.name} is already on this booking.`);

    const shiftRows = v.shifts.map((s) => {
      const fn = fns.find((f) => f.id === s.functionId)!;
      const day = fn.date.toISOString().slice(0, 10);
      return { functionId: fn.id, date: fn.date, reportAt: new Date(`${day}T${s.reportTime}:00${IST}`), location: s.location || null };
    });
    const clashes = await tx.crewShift.findMany({
      where: { date: { in: dates }, assignment: { workerId: worker.id, eventId: { not: v.eventId }, status: { in: ["ASSIGNED", "CONFIRMED"] } } },
      select: { date: true, assignment: { select: { event: { select: { name: true } } } } },
    });

    const data = { duty: v.duty, agreedPay: pay, status: "ASSIGNED" as const, declineReason: null, respondedAt: null, createdById: actor.userId };
    let assignmentId: string;
    if (existing) {
      await tx.crewShift.deleteMany({ where: { assignmentId: existing.id } });
      await tx.crewAssignment.update({ where: { id: existing.id }, data: { ...data, shifts: { create: shiftRows } } });
      assignmentId = existing.id;
    } else {
      assignmentId = (await tx.crewAssignment.create({ data: { ...data, eventId: v.eventId, workerId: worker.id, shifts: { create: shiftRows } } })).id;
    }

    const first = [...shiftRows].sort((a, b) => a.reportAt.getTime() - b.reportAt.getTime())[0];
    await notify(tx, [worker.userId], {
      type: "crew.assigned",
      title: `New booking: ${event.name}`,
      body: `${v.duty} · report ${formatTime(first.reportAt)}, ${formatDate(first.reportAt)}. Please accept or decline.`,
      link: "/crew",
      entityType: "crew_assignment",
      entityId: assignmentId,
    });
    await recordAudit(tx, actor, { action: "create", entityType: "crew_assignment", entityId: assignmentId, summary: `Put ${worker.name} on ${event.name} as ${v.duty} for ${formatINR(pay)}`, financial: true }, meta);
    return {
      id: assignmentId,
      warning: clashes.length ? `${worker.name} is also booked for ${[...new Set(clashes.map((c) => c.assignment.event.name))].join(", ")} that day.` : null,
    };
  });
}

/** Takes someone off a booking before they have worked on it. */
export async function removeCrew(db: Db, actor: Actor, assignmentId: string, reason: string, meta: RequestMeta = {}) {
  const why = reason.trim();
  if (!why) throw new ValidationError("Write a short reason.", { reason: "A reason is needed." });
  return db.$transaction(async (tx) => {
    const a = await tx.crewAssignment.findUnique({ where: { id: assignmentId }, include: { worker: { select: { name: true, userId: true } }, event: { select: { name: true } }, shifts: { select: { attendance: true } }, _count: { select: { payments: true } } } });
    if (!a) throw new NotFoundError("That crew booking");
    await assertStaffOn(tx, actor, a.eventId, "crew.assign", "You can't change crew on this booking.");
    if (["CANCELLED", "DECLINED", "COMPLETED"].includes(a.status)) throw new ConflictError("This crew booking is already closed.");
    if (a.shifts.some((s) => s.attendance !== "PENDING") || a._count.payments) throw new ConflictError(`${a.worker.name} has already worked or been paid on this booking.`);
    await tx.crewAssignment.update({ where: { id: a.id }, data: { status: "CANCELLED", declineReason: why } });
    await notify(tx, [a.worker.userId], { type: "crew.removed", title: `Not needed: ${a.event.name}`, body: why, link: "/crew", entityType: "crew_assignment", entityId: a.id });
    await recordAudit(tx, actor, { action: "cancel", entityType: "crew_assignment", entityId: a.id, summary: `Took ${a.worker.name} off ${a.event.name} · ${why}` }, meta);
  });
}

// ───────────────────────────── The crew member's answer ─────────────────────────────

export async function respondToBooking(db: Db, actor: Actor, assignmentId: string, accept: boolean, reason = "", meta: RequestMeta = {}) {
  const why = reason.trim();
  if (!accept && !why) throw new ValidationError("Tell the manager why, so they can find someone else.", { reason: "A reason is needed." });
  return db.$transaction(async (tx) => {
    if (actor.accountType !== "LABOUR") throw new ForbiddenError("Only the crew member can answer.");
    const a = await tx.crewAssignment.findFirst({ where: { AND: [{ id: assignmentId }, crewAssignmentWhere(actor)] }, include: { worker: { select: { name: true } }, event: { select: { name: true } } } });
    if (!a) throw new NotFoundError("That booking");
    if (a.status !== "ASSIGNED") throw new ConflictError(a.status === "CONFIRMED" ? "You have already accepted. Please call the manager to change it." : "This booking is closed.");
    await tx.crewAssignment.update({ where: { id: a.id }, data: { status: accept ? "CONFIRMED" : "DECLINED", respondedAt: new Date(), declineReason: accept ? null : why } });
    await notify(tx, await bookingTeamUserIds(tx, a.eventId), {
      type: accept ? "crew.accepted" : "crew.declined",
      title: accept ? `${a.worker.name} accepted ${a.event.name}` : `${a.worker.name} can't do ${a.event.name}`,
      body: accept ? a.duty : `${a.duty} · ${why}`,
      link: `/bookings/${a.eventId}?tab=crew`,
      entityType: "crew_assignment",
      entityId: a.id,
    });
    await recordAudit(tx, actor, { action: accept ? "accept" : "decline", entityType: "crew_assignment", entityId: a.id, summary: `${a.worker.name} ${accept ? "accepted" : "declined"} ${a.event.name}${why ? ` · ${why}` : ""}` }, meta);
  });
}

// ───────────────────────────── Attendance ─────────────────────────────

export type WindowState = "early" | "open" | "closed";

export function attendanceWindow(reportAt: Date, now = new Date()): WindowState {
  const t = now.getTime();
  if (t < reportAt.getTime() - 6 * HOUR) return "early";
  if (t > reportAt.getTime() + 18 * HOUR) return "closed";
  return "open";
}

function onTimeStatus(reportAt: Date, at: Date): "PRESENT" | "LATE" {
  return at.getTime() > reportAt.getTime() + LATE_AFTER_MINUTES * 60_000 ? "LATE" : "PRESENT";
}

export const markSchema = z.object({ status: z.enum(["PRESENT", "LATE", "ABSENT", "PENDING"]) });

/** The supervisor or manager marks one shift. PENDING undoes a mistake. */
export async function markAttendance(db: Db, actor: Actor, shiftId: string, status: z.input<typeof markSchema>["status"], meta: RequestMeta = {}, now = new Date()) {
  const v = parseInput(markSchema, { status });
  return db.$transaction(async (tx) => {
    const shift = await tx.crewShift.findUnique({ where: { id: shiftId }, include: { assignment: { select: { eventId: true, status: true, worker: { select: { name: true } }, event: { select: { name: true } } } } } });
    if (!shift) throw new NotFoundError("That shift");
    await assertStaffOn(tx, actor, shift.assignment.eventId, "attendance.mark", "You can't mark attendance on this booking.");
    if (!["ASSIGNED", "CONFIRMED", "COMPLETED", "NO_SHOW"].includes(shift.assignment.status)) throw new ConflictError(`${shift.assignment.worker.name} is not on this booking any more.`);
    const window = attendanceWindow(shift.reportAt, now);
    if (window === "early") throw new ConflictError(`Attendance opens on the day (from ${formatTime(new Date(shift.reportAt.getTime() - 6 * HOUR))}).`);
    if (window === "closed" && !actor.isOwner) throw new ConflictError("This shift is over. Ask an owner to correct its attendance.");
    const arrived = v.status === "PRESENT" || v.status === "LATE";
    await tx.crewShift.update({
      where: { id: shift.id },
      data: {
        attendance: v.status,
        method: v.status === "PENDING" ? null : "SUPERVISOR",
        checkInAt: arrived ? (shift.checkInAt ?? now) : null,
        markedById: v.status === "PENDING" ? null : actor.userId,
      },
    });
    await recordAudit(tx, actor, { action: "attendance", entityType: "crew_shift", entityId: shift.id, summary: `${shift.assignment.worker.name}: ${v.status.toLowerCase()} (${shift.assignment.event.name})` }, meta);
    return { status: v.status };
  });
}

export const checkInSchema = z.object({ latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional() });

/** The crew member taps "I'm here" (only when the owners have switched on self check-in). */
export async function selfCheckIn(db: Db, actor: Actor, shiftId: string, input: z.input<typeof checkInSchema> = {}, meta: RequestMeta = {}, now = new Date()) {
  const v = parseInput(checkInSchema, input);
  return db.$transaction(async (tx) => {
    if (actor.accountType !== "LABOUR") throw new ForbiddenError("Only crew check themselves in.");
    assertCan(actor, "attendance.mark", "Your supervisor marks attendance. Find them when you arrive.");
    const shift = await tx.crewShift.findFirst({ where: { id: shiftId, assignment: crewAssignmentWhere(actor) }, include: { assignment: { select: { status: true, eventId: true, worker: { select: { name: true } }, event: { select: { name: true } } } } } });
    if (!shift) throw new NotFoundError("That shift");
    if (shift.assignment.status !== "CONFIRMED") throw new ConflictError(shift.assignment.status === "ASSIGNED" ? "Accept the booking first." : "This booking is closed.");
    if (shift.attendance !== "PENDING") throw new ConflictError("You are already checked in.");
    const window = attendanceWindow(shift.reportAt, now);
    if (window !== "open") throw new ConflictError(window === "early" ? "Check-in opens on the day." : "This shift is over.");
    const status = onTimeStatus(shift.reportAt, now);
    await tx.crewShift.update({ where: { id: shift.id }, data: { attendance: status, method: "SELF_GPS", checkInAt: now, latitude: v.latitude ?? null, longitude: v.longitude ?? null } });
    if (status === "LATE") {
      await notify(tx, await bookingTeamUserIds(tx, shift.assignment.eventId, ["SUPERVISOR", "MANAGER"]), {
        type: "crew.late",
        title: `${shift.assignment.worker.name} checked in late`,
        body: `${formatTime(now)} (report time ${formatTime(shift.reportAt)})`,
        link: "/event-day",
        entityType: "crew_shift",
        entityId: shift.id,
      });
    }
    await recordAudit(tx, actor, { action: "check-in", entityType: "crew_shift", entityId: shift.id, summary: `${shift.assignment.worker.name} checked in ${status === "LATE" ? "late" : "on time"} (${shift.assignment.event.name})` }, meta);
    return { status };
  });
}

// ───────────────────────────── Picking crew ─────────────────────────────

/** Crew a manager can put on a booking, with what they need to decide. */
export async function crewForBooking(db: Db, actor: Actor, eventId: string) {
  if (!can(actor, "crew.assign")) return [];
  await assertEventAccess(db, actor, eventId, "crew.assign");
  const fns = await db.eventFunction.findMany({ where: { eventId }, select: { date: true } });
  const dates = [...new Set(fns.map((f) => f.date.toISOString()))].map((d) => new Date(d));
  const seesPay = can(actor, "crew.pay.view");
  const workers = await db.worker.findMany({
    where: { status: "ACTIVE", deletedAt: null },
    orderBy: { name: "asc" },
    take: 500,
    select: {
      id: true,
      name: true,
      city: true,
      usualEventRate: true,
      skills: { select: { skill: { select: { name: true } } } },
      unavailability: { where: { date: { in: dates } }, select: { date: true } },
      assignments: { where: { status: { in: ["ASSIGNED", "CONFIRMED"] }, shifts: { some: { date: { in: dates } } } }, select: { eventId: true, event: { select: { name: true } } } },
    },
  });
  return workers.map((w) => ({
    id: w.id,
    name: w.name,
    city: w.city,
    skills: w.skills.map((s) => s.skill.name),
    usualRate: seesPay && w.usualEventRate ? toNumber(w.usualEventRate) : null,
    unavailable: w.unavailability.length > 0,
    onThisBooking: w.assignments.some((a) => a.eventId === eventId),
    busyElsewhere: [...new Set(w.assignments.filter((a) => a.eventId !== eventId).map((a) => a.event.name))],
  }));
}
