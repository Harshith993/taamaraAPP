/**
 * Reminders (Phase 8), run every few minutes in-process (background.ts), like media processing.
 * Each one notifies at most once for the same thing, so running often is safe:
 *
 *   shift.tomorrow     crew with a confirmed shift tomorrow (India time): once per shift,
 *                      sent from 08:00 the day before
 *   task.overdue       the person a task is assigned to, once per task per day, from 09:00
 *   approvals.waiting  each owner, once a day from 09:00, when approvals have waited 12 hours or more
 *   crew.unanswered    crew who haven't answered a booking offer for a day, once per offer
 *
 * Quiet hours: nothing is sent between 21:00 and 08:00 India time.
 */
import type { Db } from "@/lib/db";
import { formatTime } from "@/lib/format";
import { notify, ownerUserIds } from "@/modules/notifications/notify";

const IST_MS = 5.5 * 3600_000;
const DAY = 86400_000;

/** India-time calendar day and hour for an instant. */
export function indiaClock(now: Date) {
  const shifted = new Date(now.getTime() + IST_MS);
  return { day: shifted.toISOString().slice(0, 10), hour: shifted.getUTCHours() };
}

/** The instant an India-time day starts. */
function startOfIndiaDay(day: string) {
  return new Date(Date.parse(`${day}T00:00:00Z`) - IST_MS);
}

async function already(db: Db, userId: string, type: string, entityId: string, since?: Date) {
  return (await db.notification.count({ where: { userId, type, entityId, ...(since ? { createdAt: { gte: since } } : {}) } })) > 0;
}

export async function shiftReminders(db: Db, now: Date) {
  const { day, hour } = indiaClock(now);
  if (hour < 8 || hour >= 21) return 0;
  const from = new Date(startOfIndiaDay(day).getTime() + DAY);
  const to = new Date(from.getTime() + DAY);
  const shifts = await db.crewShift.findMany({
    where: { reportAt: { gte: from, lt: to }, assignment: { status: "CONFIRMED", worker: { userId: { not: null } } } },
    include: { assignment: { select: { duty: true, event: { select: { name: true } }, worker: { select: { userId: true } } } }, function: { select: { name: true, venueText: true, venue: { select: { name: true } } } } },
  });
  let n = 0;
  for (const s of shifts) {
    const userId = s.assignment.worker.userId!;
    if (await already(db, userId, "shift.tomorrow", s.id)) continue;
    const place = s.location ?? s.function?.venue?.name ?? s.function?.venueText ?? "the venue";
    n += await notify(db, [userId], { type: "shift.tomorrow", title: `Tomorrow: report by ${formatTime(s.reportAt)} at ${place}`, body: `${s.assignment.event.name}${s.function ? ` · ${s.function.name}` : ""} · ${s.assignment.duty}`, link: "/crew", entityType: "crew_shift", entityId: s.id });
  }
  return n;
}

export async function overdueTaskReminders(db: Db, now: Date) {
  const { day, hour } = indiaClock(now);
  if (hour < 9 || hour >= 21) return 0;
  const since = startOfIndiaDay(day);
  const tasks = await db.task.findMany({
    where: { dueAt: { lt: now }, status: { notIn: ["COMPLETED", "CANCELLED", "UNDER_REVIEW"] }, assigneeId: { not: null }, assignee: { status: "ACTIVE" } },
    select: { id: true, title: true, assigneeId: true, assignee: { select: { accountType: true } }, event: { select: { name: true } } },
    take: 500,
  });
  let n = 0;
  for (const t of tasks) {
    if (await already(db, t.assigneeId!, "task.overdue", t.id, since)) continue;
    const link = t.assignee!.accountType === "LABOUR" ? "/crew" : t.assignee!.accountType === "VENDOR" ? "/vendor" : "/home";
    n += await notify(db, [t.assigneeId], { type: "task.overdue", title: `Overdue: ${t.title}`, body: t.event?.name ?? null, link, entityType: "task", entityId: t.id });
  }
  return n;
}

export async function approvalDigest(db: Db, now: Date) {
  const { day, hour } = indiaClock(now);
  if (hour < 9 || hour >= 21) return 0;
  const waiting = await db.approvalRequest.count({ where: { state: "PENDING", createdAt: { lt: new Date(now.getTime() - 12 * 3600_000) } } });
  if (!waiting) return 0;
  let n = 0;
  for (const owner of await ownerUserIds(db)) {
    // One digest a day: the day is the entity id.
    if (await already(db, owner, "approvals.waiting", day)) continue;
    n += await notify(db, [owner], { type: "approvals.waiting", title: `${waiting} approval${waiting === 1 ? "" : "s"} waiting for more than 12 hours`, link: "/approvals", entityType: "day", entityId: day });
  }
  return n;
}

export async function unansweredCrewOffers(db: Db, now: Date) {
  const { hour } = indiaClock(now);
  if (hour < 8 || hour >= 21) return 0;
  const offers = await db.crewAssignment.findMany({
    where: { status: "ASSIGNED", createdAt: { lt: new Date(now.getTime() - DAY) }, worker: { userId: { not: null } }, event: { status: { notIn: ["CANCELLED", "COMPLETED", "SETTLED"] } } },
    select: { id: true, duty: true, event: { select: { name: true } }, worker: { select: { userId: true } } },
  });
  let n = 0;
  for (const o of offers) {
    if (await already(db, o.worker.userId!, "crew.unanswered", o.id)) continue;
    n += await notify(db, [o.worker.userId], { type: "crew.unanswered", title: `Please answer: ${o.event.name}`, body: `${o.duty}. Tap Accept or Can't make it.`, link: "/crew", entityType: "crew_assignment", entityId: o.id });
  }
  return n;
}

export async function runReminders(db: Db, now = new Date()) {
  return {
    shifts: await shiftReminders(db, now),
    overdue: await overdueTaskReminders(db, now),
    approvals: await approvalDigest(db, now),
    offers: await unansweredCrewOffers(db, now),
  };
}
