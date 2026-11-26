/**
 * Event day: everything a supervisor or manager needs at the venue, for one day and the bookings
 * they run: the run sheet, who has arrived, which vendors are due, tasks due today and proof to check.
 * With no date given it shows today, or the next day something is on.
 */
import type { Db } from "@/lib/db";
import { todayInIndia } from "@/lib/format";
import type { Actor } from "@/modules/identity/actor";
import { can, eventWhere, proofWhere, taskWhere } from "@/modules/identity/policy";

const IST = "+05:30";

function dayRange(day: string) {
  return { from: new Date(`${day}T00:00:00${IST}`), to: new Date(`${day}T23:59:59.999${IST}`) };
}

export async function getEventDay(db: Db, actor: Actor, requested?: string) {
  const today = todayInIndia();
  const visible = eventWhere(actor, "bookings.view");
  let day = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : today;
  let showingNext = false;

  const fnWhere = (d: string) => ({ date: new Date(`${d}T00:00:00Z`), event: { AND: [visible, { status: { notIn: ["CANCELLED", "POSTPONED"] as ("CANCELLED" | "POSTPONED")[] } }] } });
  let count = await db.eventFunction.count({ where: fnWhere(day) });
  if (!count && !requested) {
    const next = await db.eventFunction.findFirst({ where: { date: { gt: new Date(`${today}T00:00:00Z`) }, event: fnWhere(today).event }, orderBy: { date: "asc" }, select: { date: true } });
    if (next) {
      day = next.date.toISOString().slice(0, 10);
      showingNext = true;
      count = 1;
    }
  }

  const { from, to } = dayRange(day);
  const functions = count
    ? await db.eventFunction.findMany({
        where: fnWhere(day),
        orderBy: { startsAt: "asc" },
        include: { venue: { select: { name: true, address: true, mapUrl: true } }, event: { select: { id: true, name: true, code: true, status: true } } },
      })
    : [];
  const eventIds = [...new Set(functions.map((f) => f.eventId))];
  const fnIds = functions.map((f) => f.id);

  const [members, schedule, shifts, vendors, tasks, proofCounts] = await Promise.all([
    db.eventMember.findMany({ where: { eventId: { in: eventIds } }, select: { eventId: true, role: true, userId: true, user: { select: { name: true, phoneNumber: true } } } }),
    can(actor, "schedule.view")
      ? db.scheduleItem.findMany({
          where: { eventId: { in: eventIds }, OR: [{ functionId: { in: fnIds } }, { functionId: null, startsAt: { gte: from, lte: to } }] },
          orderBy: [{ startsAt: "asc" }, { sortOrder: "asc" }],
          select: { id: true, eventId: true, functionId: true, title: true, type: true, startsAt: true, endsAt: true, location: true, done: true },
        })
      : [],
    db.crewShift.findMany({
      where: { assignment: { eventId: { in: eventIds }, status: { in: ["ASSIGNED", "CONFIRMED", "COMPLETED"] } }, OR: [{ functionId: { in: fnIds } }, { date: new Date(`${day}T00:00:00Z`) }] },
      orderBy: [{ reportAt: "asc" }],
      include: { assignment: { select: { eventId: true, status: true, duty: true, worker: { select: { name: true, phone: true } } } }, function: { select: { name: true } } },
    }),
    db.vendorAssignment.findMany({
      where: { eventId: { in: eventIds }, status: { notIn: ["DECLINED", "CANCELLED", "INVITED", "QUOTED"] }, functions: { some: { functionId: { in: fnIds } } } },
      orderBy: [{ reportingAt: "asc" }],
      select: { id: true, eventId: true, scopeOfWork: true, status: true, reportingAt: true, vendor: { select: { companyName: true, contactName: true, phone: true } }, category: { select: { name: true, color: true } } },
    }),
    db.task.findMany({
      where: { AND: [taskWhere(actor), { eventId: { in: eventIds } }, { status: { notIn: ["COMPLETED", "CANCELLED"] } }, { OR: [{ dueAt: { lte: to } }, { functionId: { in: fnIds } }] }] },
      orderBy: [{ dueAt: "asc" }],
      take: 40,
      select: { id: true, eventId: true, title: true, status: true, dueAt: true, needsProof: true, assigneeId: true, assignee: { select: { name: true } }, _count: { select: { proofs: { where: { status: { in: ["PENDING_REVIEW", "APPROVED"] } } } } } },
    }),
    can(actor, "proof.review")
      ? db.workProof.groupBy({ by: ["eventId"], where: { AND: [proofWhere(actor, "proof.review"), { eventId: { in: eventIds }, status: "PENDING_REVIEW" }] }, _count: { _all: true } })
      : [],
  ]);

  const bookings = eventIds.map((id) => {
    const fns = functions.filter((f) => f.eventId === id);
    const crew = shifts.filter((s) => s.assignment.eventId === id);
    return {
      id,
      name: fns[0].event.name,
      code: fns[0].event.code,
      status: fns[0].event.status,
      onTeam: actor.isOwner || members.some((m) => m.eventId === id && m.userId === actor.userId),
      team: members.filter((m) => m.eventId === id).map((m) => ({ role: m.role, name: m.user.name, phone: m.user.phoneNumber })),
      functions: fns.map((f) => ({ id: f.id, name: f.name, startsAt: f.startsAt, endsAt: f.endsAt, guests: f.expectedGuests, venue: f.venue?.name ?? f.venueText, address: f.venue?.address ?? null, mapUrl: f.venue?.mapUrl ?? null })),
      schedule: schedule.filter((s) => s.eventId === id),
      crew: crew.map((s) => ({
        shiftId: s.id,
        name: s.assignment.worker.name,
        phone: s.assignment.worker.phone,
        duty: s.assignment.duty,
        answered: s.assignment.status !== "ASSIGNED",
        function: s.function?.name ?? null,
        reportAt: s.reportAt,
        location: s.location,
      })),
      vendors: vendors
        .filter((v) => v.eventId === id)
        .map((v) => ({ id: v.id, vendor: v.vendor.companyName, contact: v.vendor.contactName, phone: can(actor, "vendors.view") ? v.vendor.phone : null, scope: v.scopeOfWork, status: v.status, reportingAt: v.reportingAt, department: v.category })),
      tasks: tasks.filter((t) => t.eventId === id),
      proofToCheck: proofCounts.find((p) => p.eventId === id)?._count._all ?? 0,
    };
  });

  return { day, today, isToday: day === today, showingNext, bookings };
}

export type EventDay = Awaited<ReturnType<typeof getEventDay>>;
