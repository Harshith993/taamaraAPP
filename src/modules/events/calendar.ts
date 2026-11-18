/** The calendar: every function in a month on the bookings this person can see. */
import type { Db } from "@/lib/db";
import type { Actor } from "@/modules/identity/actor";
import { assertCan, eventWhere } from "@/modules/identity/policy";

export async function monthCalendar(db: Db, actor: Actor, month: string) {
  assertCan(actor, "bookings.view");
  const m = /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);
  const [y, mo] = m.split("-").map(Number);
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const next = new Date(Date.UTC(y, mo, 1));
  const fns = await db.eventFunction.findMany({
    where: { date: { gte: first, lt: next }, event: { AND: [eventWhere(actor), { status: { not: "CANCELLED" } }] } },
    orderBy: { startsAt: "asc" },
    select: {
      id: true,
      name: true,
      date: true,
      startsAt: true,
      venueText: true,
      venue: { select: { name: true } },
      event: { select: { id: true, name: true, status: true, category: { select: { color: true, name: true } } } },
      _count: { select: { crewShifts: true, vendorLinks: true } },
    },
  });
  const days = new Map<string, typeof items>();
  const items = fns.map((f) => ({
    id: f.id,
    eventId: f.event.id,
    eventName: f.event.name,
    status: f.event.status,
    name: f.name,
    startsAt: f.startsAt,
    venue: f.venue?.name ?? f.venueText,
    color: f.event.category.color,
    category: f.event.category.name,
    crew: f._count.crewShifts,
    vendors: f._count.vendorLinks,
  }));
  for (const it of items) {
    const key = fns.find((f) => f.id === it.id)!.date.toISOString().slice(0, 10);
    days.set(key, [...(days.get(key) ?? []), it]);
  }
  const prev = new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 7);
  return { month: m, first, days, prev, next: next.toISOString().slice(0, 7), daysInMonth: new Date(Date.UTC(y, mo, 0)).getUTCDate() };
}
