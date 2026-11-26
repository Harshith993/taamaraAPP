/**
 * Crew on a booking: hiring and the crew member's answer.
 *
 *   ASSIGNED ──crew accepts──▶ CONFIRMED ──(event done)──▶ COMPLETED
 *       └──crew declines──▶ DECLINED            team takes them off ──▶ CANCELLED
 *
 *  - Managers (crew.assign) put crew on bookings they run, with an agreed pay for the event (A3) and
 *    one shift per function. Unavailable days are refused; double bookings are allowed with a warning.
 *  - Crew accept or decline from their phone.
 *  - No attendance (D52, 26 Nov): nobody marks crew present, late or absent, and pay never depends on it.
 *    Old attendance values stay in crew_shifts but are no longer read or written.
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

async function assertStaffOn(tx: DbTx, actor: Actor, eventId: string, permission: "crew.assign", message: string) {
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
    const a = await tx.crewAssignment.findUnique({ where: { id: assignmentId }, include: { worker: { select: { name: true, userId: true } }, event: { select: { name: true } }, _count: { select: { payments: true } } } });
    if (!a) throw new NotFoundError("That crew booking");
    await assertStaffOn(tx, actor, a.eventId, "crew.assign", "You can't change crew on this booking.");
    if (["CANCELLED", "DECLINED", "COMPLETED"].includes(a.status)) throw new ConflictError("This crew booking is already closed.");
    if (a._count.payments) throw new ConflictError(`${a.worker.name} has already been paid on this booking.`);
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
