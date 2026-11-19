import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, Panel } from "@/components/ui";
import { db } from "@/lib/db";
import { formatCalendarDate, formatTime, todayInIndia } from "@/lib/format";
import { monthCalendar } from "@/modules/events/calendar";
import { requirePermission } from "@/modules/identity/session";

export const metadata: Metadata = { title: "Calendar" };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const actor = await requirePermission("bookings.view");
  const sp = await searchParams;
  const today = todayInIndia();
  const cal = await monthCalendar(db, actor, sp.m ?? today.slice(0, 7));
  const lead = (cal.first.getUTCDay() + 6) % 7; // Monday first
  const cells = Array.from({ length: Math.ceil((lead + cal.daysInMonth) / 7) * 7 }, (_, i) => {
    const d = i - lead + 1;
    return d >= 1 && d <= cal.daysInMonth ? `${cal.month}-${String(d).padStart(2, "0")}` : null;
  });
  const busyDays = [...cal.days.keys()].sort();
  const title = formatCalendarDate(cal.first, { month: "long", year: "numeric" });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-condensed text-[clamp(32px,4vw,46px)] leading-[0.95]">{title}</h1>
          <p className="mt-1 text-[15px] text-ink-quiet">
            {[...cal.days.values()].flat().length} functions on {busyDays.length} days{actor.grants.get("bookings.view") === "ASSIGNED" ? " · your bookings" : ""}
          </p>
        </div>
        <nav aria-label="Months" className="flex border border-line font-mono text-[12.5px] font-semibold tracking-[0.06em] uppercase">
          <Link href={`/calendar?m=${cal.prev}`} className="flex min-h-10 items-center px-3.5 no-underline hover:bg-paper">
            ← Prev
          </Link>
          <Link href="/calendar" className="flex min-h-10 items-center border-x border-line px-3.5 no-underline hover:bg-paper">
            Today
          </Link>
          <Link href={`/calendar?m=${cal.next}`} className="flex min-h-10 items-center px-3.5 no-underline hover:bg-paper">
            Next →
          </Link>
        </nav>
      </div>

      {/* iPad and desktop: the month grid */}
      <div className="hidden overflow-hidden rounded-2xl shadow-[var(--shadow-card)] border border-line bg-paper md:block">
        <div className="grid grid-cols-7 border-b border-line bg-ground">
          {WEEKDAYS.map((w) => (
            <span key={w} className="label-mono px-2 py-1.5 text-[11px]">
              {w}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((day, i) => {
            const items = day ? (cal.days.get(day) ?? []) : [];
            const isToday = day === today;
            return (
              <div key={i} className={`min-h-[112px] border-r border-b border-rule-soft p-1.5 [&:nth-child(7n)]:border-r-0 ${day ? "" : "bg-ground/60"} ${isToday ? "bg-look/20" : ""}`}>
                {day && <span className={`font-mono text-[12px] font-semibold ${isToday ? "bg-ink px-1 text-[#F6EFE0]" : "text-ink-quiet"}`}>{Number(day.slice(8))}</span>}
                <ul className="mt-1 flex flex-col gap-1">
                  {items.map((f) => (
                    <li key={f.id}>
                      <Link href={`/bookings/${f.eventId}`} className="flex gap-1.5 rounded-lg border border-rule-soft bg-paper px-1 py-0.5 text-[11.5px] leading-tight no-underline hover:border-line">
                        <span className="w-1 shrink-0" style={{ background: f.color }} aria-hidden="true" />
                        <span className="min-w-0">
                          <span className="font-mono font-semibold">{formatTime(f.startsAt)}</span> <span className="font-semibold">{f.eventName}</span>
                          <span className="block truncate text-ink-quiet">
                            {f.name}
                            {f.status === "TENTATIVE" ? " · tentative" : ""}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {/* Phone: the busy days as a list */}
      <div className="md:hidden">
        {busyDays.length === 0 ? (
          <Panel>
            <EmptyState title="Nothing this month" />
          </Panel>
        ) : (
          <Panel title={title}>
            <ul>
              {busyDays.map((day) => (
                <li key={day} className={`border-b border-rule-soft px-3.5 py-2.5 last:border-b-0 ${day === today ? "bg-look/20" : ""}`}>
                  <span className="label-mono text-[11.5px]">{formatCalendarDate(new Date(`${day}T00:00:00Z`), { weekday: "long", day: "numeric", month: "short" })}</span>
                  <ul className="mt-1 flex flex-col gap-1.5">
                    {cal.days.get(day)!.map((f) => (
                      <li key={f.id} className="flex gap-2">
                        <span className="w-1.5 shrink-0" style={{ background: f.color }} aria-hidden="true" />
                        <Link href={`/bookings/${f.eventId}`} className="flex flex-col leading-tight no-underline">
                          <span className="text-[14.5px] font-semibold">
                            <span className="font-mono">{formatTime(f.startsAt)}</span> {f.eventName}
                          </span>
                          <span className="text-[12.5px] text-ink-quiet">
                            {f.name}
                            {f.venue ? ` · ${f.venue}` : ""}
                            {f.crew ? ` · ${f.crew} crew` : ""}
                            {f.vendors ? ` · ${f.vendors} vendors` : ""}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </div>
  );
}
