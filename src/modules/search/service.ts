/**
 * The ⌘K search for staff: bookings, vendors and crew by name (or booking code), each list filtered
 * by the same policy as its own page, so nobody finds what they can't open.
 */
import type { Db } from "@/lib/db";
import type { Actor } from "@/modules/identity/actor";
import { can, eventWhere } from "@/modules/identity/policy";

export interface SearchHit {
  kind: "booking" | "vendor" | "crew";
  id: string;
  title: string;
  detail: string;
  href: string;
}

export async function globalSearch(db: Db, actor: Actor, query: string): Promise<SearchHit[]> {
  if (actor.accountType !== "INTERNAL" || actor.status !== "ACTIVE") return [];
  const q = query.trim().slice(0, 60);
  if (q.length < 2) return [];
  const text = { contains: q, mode: "insensitive" as const };
  const [events, vendors, workers] = await Promise.all([
    can(actor, "bookings.view")
      ? db.event.findMany({
          where: { AND: [eventWhere(actor), { OR: [{ name: text }, { code: text }, { client: { name: text } }] }] },
          orderBy: { startDate: "desc" },
          take: 6,
          select: { id: true, name: true, code: true, status: true, startDate: true, client: { select: { name: true } } },
        })
      : [],
    can(actor, "vendors.view")
      ? db.vendor.findMany({ where: { deletedAt: null, OR: [{ companyName: text }, { contactName: text }] }, orderBy: { companyName: "asc" }, take: 5, select: { id: true, companyName: true, contactName: true } })
      : [],
    can(actor, "crew.view") ? db.worker.findMany({ where: { deletedAt: null, name: text }, orderBy: { name: "asc" }, take: 5, select: { id: true, name: true, city: true } }) : [],
  ]);
  const day = (d: Date | null) => (d ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "date to be set");
  return [
    ...events.map((e) => ({ kind: "booking" as const, id: e.id, title: e.name, detail: `${e.code} · ${e.client?.name ?? "client"} · ${day(e.startDate)}`, href: `/bookings/${e.id}` })),
    ...vendors.map((v) => ({ kind: "vendor" as const, id: v.id, title: v.companyName, detail: v.contactName ? `Vendor · ${v.contactName}` : "Vendor", href: `/vendors/${v.id}` })),
    ...workers.map((w) => ({ kind: "crew" as const, id: w.id, title: w.name, detail: w.city ? `Crew · ${w.city}` : "Crew", href: `/roster/${w.id}` })),
  ];
}
