import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink, EmptyState, Panel, Tag } from "@/components/ui";
import { db } from "@/lib/db";
import { formatCalendarDate, formatDate, formatTime } from "@/lib/format";
import { EVENT_STATUS_TONE } from "@/modules/events/labels";
import { listBookings, type BookingRange } from "@/modules/events/service";
import { can } from "@/modules/identity/policy";
import { requirePermission } from "@/modules/identity/session";

export const metadata: Metadata = { title: "Bookings" };

const RANGES: { key: BookingRange; label: string }[] = [
  { key: "upcoming", label: "Upcoming" },
  { key: "tentative", label: "Tentative" },
  { key: "past", label: "Past" },
  { key: "all", label: "All" },
];

export default async function BookingsPage({ searchParams }: { searchParams: Promise<{ range?: string; q?: string; created?: string }> }) {
  const actor = await requirePermission("bookings.view");
  const sp = await searchParams;
  const range = (RANGES.find((r) => r.key === sp.range)?.key ?? "upcoming") as BookingRange;
  const events = await listBookings(db, actor, { range, q: sp.q });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-condensed text-[clamp(32px,4vw,46px)] leading-[0.95]">BOOKINGS</h1>
          <p className="mt-1 text-[15px] text-ink-quiet">{actor.grants.get("bookings.view") === "ASSIGNED" ? "Bookings you are assigned to." : "Every booking."}</p>
        </div>
        {can(actor, "bookings.create") && <ButtonLink href="/bookings/new">+ New booking</ButtonLink>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Filter bookings" className="flex border border-line font-mono text-[12.5px] font-semibold tracking-[0.06em] uppercase">
          {RANGES.map((r) => (
            <Link key={r.key} href={`/bookings?range=${r.key}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`} aria-current={r.key === range ? "page" : undefined} className={`flex min-h-10 items-center px-3.5 no-underline ${r.key === range ? "bg-ink text-[#F6EFE0]" : "text-ink hover:bg-paper"}`}>
              {r.label}
            </Link>
          ))}
        </nav>
        <form role="search" className="flex gap-2" action="/bookings">
          <input type="hidden" name="range" value={range} />
          <label htmlFor="q" className="sr-only">
            Search bookings
          </label>
          <input id="q" name="q" defaultValue={sp.q} placeholder="Name, code or function" className="min-h-11 w-60 rounded-xl border border-line bg-paper px-3 text-[14.5px]" />
          <button type="submit" className="min-h-11 rounded-xl border border-line px-3 font-mono text-[12px] font-semibold uppercase">
            Search
          </button>
        </form>
      </div>

      <Panel title={`${RANGES.find((r) => r.key === range)!.label} · ${events.length}`}>
        {events.length === 0 ? (
          <EmptyState title="No bookings here">{sp.q ? "Try a different search." : "Bookings you can see appear here."}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-[14px]">
              <thead>
                <tr className="label-mono border-b border-line text-left text-[11px] text-ink-quiet">
                  <th scope="col" className="px-3.5 py-2 font-semibold">Booking</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Dates</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Next function</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Team</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Vendors · crew · tasks</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => {
                  const next = e.functions.find((f) => f.startsAt >= new Date()) ?? e.functions.at(-1);
                  return (
                    <tr key={e.id} className="border-b border-rule-soft last:border-b-0 hover:bg-ground/60">
                      <td className="px-3.5 py-2.5">
                        <Link href={`/bookings/${e.id}`} className="flex items-center gap-3 text-ink no-underline">
                          <span className="h-9 w-2.5 shrink-0" style={{ background: e.category.color }} aria-hidden="true" />
                          <span className="flex flex-col leading-tight">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="font-bold underline-offset-2 hover:underline">{e.name}</span>
                              <Tag tone={EVENT_STATUS_TONE[e.status]}>{e.status}</Tag>
                            </span>
                            <span className="text-[12.5px] text-ink-quiet">
                              {e.category.name} · {e.code}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[12.5px] whitespace-nowrap">
                        {formatCalendarDate(e.startDate)}
                        {e.endDate && e.startDate && e.endDate.getTime() !== e.startDate.getTime() ? ` – ${formatCalendarDate(e.endDate)}` : ""}
                      </td>
                      <td className="px-3 py-2.5 text-[13px]">{next ? `${next.name} · ${formatDate(next.startsAt)} ${formatTime(next.startsAt)}` : "—"}</td>
                      <td className="px-3 py-2.5 text-[13px]">{e.members.map((m) => m.user.name.split(" ")[0]).join(", ") || <span className="text-ink-quiet">Not assigned</span>}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-[12.5px]">
                        {e._count.vendorAssignments} · {e._count.crewAssignments} · {e._count.tasks}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
