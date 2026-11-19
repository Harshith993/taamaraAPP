import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signOutAction } from "@/app/actions/auth";
import { AutoRefresh } from "@/components/auto-refresh";
import { LotusBadge, PetalStripe } from "@/components/brand";
import { DoneToggle } from "@/app/(internal)/bookings/[id]/planning-controls";
import { AttendanceButtons } from "@/components/crew-controls";
import { NotificationBell } from "@/components/notifications";
import { db } from "@/lib/db";
import { formatCalendarDate, formatTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { attendanceWindow } from "@/modules/crew/service";
import { getEventDay } from "@/modules/events/event-day";
import { can } from "@/modules/identity/policy";
import { homePathFor, requireActor } from "@/modules/identity/session";

export const metadata: Metadata = { title: "Event day" };

const VENDOR_WORDS: Record<string, string> = { APPROVED: "Work order not accepted", ACCEPTED: "Booked · not started", IN_PROGRESS: "Working", DELIVERED: "Done · to check", COMPLETED: "Signed off" };

function minutesUntil(d: Date, now: Date) {
  return Math.round((d.getTime() - now.getTime()) / 60_000);
}

function inWords(min: number) {
  if (min <= 0) return "now";
  if (min < 60) return `in ${min} min`;
  const h = Math.floor(min / 60);
  return `in ${h} h${min % 60 ? ` ${min % 60} min` : ""}`;
}

/** Event day in night mode: dark, high contrast, big targets, for a phone or iPad in a dark venue. */
export default async function EventDayPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const actor = await requireActor();
  if (actor.accountType !== "INTERNAL") redirect(homePathFor(actor));
  if (!can(actor, "bookings.view")) redirect("/home?denied=1");
  const sp = await searchParams;
  const data = await getEventDay(db, actor, sp.date);
  const now = new Date();
  const canMark = can(actor, "attendance.mark");
  const dayLabel = formatCalendarDate(new Date(`${data.day}T00:00:00Z`), { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="flex min-h-dvh flex-col bg-night-ground text-night-text">
      <AutoRefresh seconds={30} />
      <header className="lattice-deep">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-4 pt-[max(env(safe-area-inset-top),12px)] pb-3 sm:px-8">
          <LotusBadge size={40} />
          <span className="flex min-w-0 flex-1 flex-col leading-none">
            <span className="font-condensed text-[28px]">Event day</span>
            <span className="mt-1 font-mono text-[11px] font-medium tracking-[0.12em] text-[#F0D9E3] uppercase">{dayLabel}{data.isToday ? " · today" : ""}</span>
          </span>
          <nav aria-label="Event day" className="flex flex-wrap gap-1.5 font-mono text-[11.5px] font-semibold tracking-[0.06em] uppercase">
            {!data.isToday && (
              <Link href="/event-day?date=" className="flex min-h-11 items-center rounded-xl border border-white/40 px-3 text-night-text no-underline">
                Today
              </Link>
            )}
            <Link href="/home?stay=1" className="flex min-h-11 items-center rounded-xl border border-white/40 px-3 text-night-text no-underline">
              Back to the app
            </Link>
            <NotificationBell />
            <form action={signOutAction}>
              <button type="submit" className="min-h-11 rounded-xl border border-white/40 px-3 uppercase">
                Sign out
              </button>
            </form>
          </nav>
        </div>
      </header>
      <PetalStripe />

      <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-5 px-3.5 pt-4 pb-[max(env(safe-area-inset-bottom),28px)] sm:px-8">
        {data.showingNext && <p className="rounded-xl border-2 border-night-rule px-3 py-2 text-[14px] font-semibold">Nothing on today. This is the next event day.</p>}
        {data.bookings.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <p className="font-condensed text-[36px]">Nothing scheduled</p>
            <p className="max-w-prose text-[15px] text-[#CDB8C4]">When a booking you run has a function, its run sheet, crew and vendors appear here on the day.</p>
          </div>
        )}

        {data.bookings.map((b) => {
          const next = b.schedule.find((s) => s.startsAt > now);
          const current = [...b.schedule].reverse().find((s) => s.startsAt <= now && (s.endsAt ?? s.startsAt) >= new Date(now.getTime() - 30 * 60_000));
          const arrived = b.crew.filter((c) => c.attendance === "PRESENT" || c.attendance === "LATE").length;
          const fn = b.functions[0];
          return (
            <section key={b.id} aria-label={b.name} className="flex flex-col gap-4">
              <div className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-night-rule pb-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="font-mono text-[11.5px] font-semibold tracking-[0.08em] text-night-plum uppercase">{b.code}</span>
                  <h1 className="font-condensed text-[clamp(32px,5vw,52px)] leading-[0.92]">
                    {b.name} · {b.functions.map((f) => f.name).join(" + ")}
                  </h1>
                  <p className="text-[14.5px] text-[#CDB8C4]">
                    {fn.venue ?? "Venue to be confirmed"}
                    {fn.address ? ` · ${fn.address}` : ""} · {formatTime(fn.startsAt)}
                    {fn.endsAt ? `–${formatTime(fn.endsAt)}` : ""}
                    {fn.guests ? ` · ${fn.guests} guests` : ""}
                    {fn.mapUrl && (
                      <>
                        {" · "}
                        <a href={fn.mapUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-night-plum">
                          Map
                        </a>
                      </>
                    )}
                  </p>
                </div>
                <Link href={`/bookings/${b.id}`} className="font-mono text-[12px] font-semibold tracking-[0.06em] text-night-plum uppercase">
                  Booking →
                </Link>
              </div>

              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-xl border-2 border-night-rule bg-night-panel px-3 py-2">
                  <dt className="font-mono text-[11px] font-semibold tracking-[0.08em] text-[#CDB8C4] uppercase">Next cue</dt>
                  <dd className="text-[15px] font-bold">{next ? `${next.title} ${inWords(minutesUntil(next.startsAt, now))}` : "None left"}</dd>
                </div>
                <div className="rounded-xl border-2 border-night-rule bg-night-panel px-3 py-2">
                  <dt className="font-mono text-[11px] font-semibold tracking-[0.08em] text-[#CDB8C4] uppercase">Crew in</dt>
                  <dd className="font-condensed text-[34px] leading-none">
                    {arrived}
                    <span className="text-[20px] text-[#CDB8C4]"> / {b.crew.length}</span>
                  </dd>
                </div>
                <div className="rounded-xl border-2 border-night-rule bg-night-panel px-3 py-2">
                  <dt className="font-mono text-[11px] font-semibold tracking-[0.08em] text-[#CDB8C4] uppercase">Vendors</dt>
                  <dd className="font-condensed text-[34px] leading-none">{b.vendors.length}</dd>
                </div>
                <Link href={`/proof?booking=${b.id}`} className={`rounded-xl border-2 px-3 py-2 no-underline ${b.proofToCheck ? "border-look bg-look text-ink" : "border-night-rule bg-night-panel text-night-text"}`}>
                  <span className="block font-mono text-[11px] font-semibold tracking-[0.08em] uppercase">Proof to check</span>
                  <span className="font-condensed text-[34px] leading-none">{b.proofToCheck}</span>
                </Link>
              </dl>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
                <div className="flex flex-col gap-4">
                  <div className="overflow-hidden rounded-2xl border-2 border-night-rule bg-night-panel">
                    <h2 className="border-b-2 border-night-rule px-3.5 py-2 font-mono text-[12px] font-semibold tracking-[0.08em] uppercase">Run sheet · {b.schedule.length}</h2>
                    {b.schedule.length === 0 ? (
                      <p className="px-3.5 py-4 text-[14px] text-[#CDB8C4]">No run sheet for this day yet.</p>
                    ) : (
                      <ol>
                        {b.schedule.map((s) => {
                          const past = (s.endsAt ?? s.startsAt) < now && s.id !== current?.id;
                          const isNow = s.id === current?.id;
                          return (
                            <li key={s.id} className={`grid grid-cols-[62px_minmax(0,1fr)_auto] items-center gap-3 border-b border-night-rule px-3.5 py-2.5 last:border-b-0 ${isNow ? "bg-night-plum/15" : ""} ${past || s.done ? "text-[#9C8593]" : ""}`}>
                              <span className={`font-mono text-[15px] font-semibold ${isNow ? "text-look" : ""}`}>{formatTime(s.startsAt)}</span>
                              <span className="flex flex-col leading-tight">
                                <span className="text-[15px] font-semibold">
                                  {s.title}
                                  {isNow && <span className="ml-2 bg-now px-1.5 font-mono text-[10.5px] text-[#FFF6EE] uppercase">Now</span>}
                                </span>
                                <span className="font-mono text-[11px] tracking-[0.04em] uppercase opacity-80">
                                  {s.type.replace("_", " ")}
                                  {s.location ? ` · ${s.location}` : ""}
                                </span>
                              </span>
                              {b.onTeam && (can(actor, "schedule.edit") || canMark) ? <DoneToggle itemId={s.id} done={s.done} night /> : <span />}
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </div>

                  <div className="overflow-hidden rounded-2xl border-2 border-night-rule bg-night-panel">
                    <h2 className="border-b-2 border-night-rule px-3.5 py-2 font-mono text-[12px] font-semibold tracking-[0.08em] uppercase">Vendors due · {b.vendors.length}</h2>
                    <ul>
                      {b.vendors.map((v) => (
                        <li key={v.id} className="grid grid-cols-[8px_minmax(0,1fr)_auto] items-center gap-3 border-b border-night-rule px-3.5 py-2.5 last:border-b-0">
                          <span className="h-9 w-2" style={{ background: v.department?.color ?? "#5A3448" }} aria-hidden="true" />
                          <span className="flex flex-col leading-tight">
                            <span className="text-[15px] font-semibold">{v.vendor}</span>
                            <span className="text-[13px] text-[#CDB8C4]">
                              {v.scope} · {VENDOR_WORDS[v.status] ?? v.status}
                              {v.reportingAt ? ` · report ${formatTime(v.reportingAt)}` : ""}
                            </span>
                          </span>
                          {v.phone && (
                            <a href={`tel:${v.phone}`} className="flex min-h-11 items-center rounded-xl border-2 border-night-rule px-2.5 font-mono text-[12px] font-semibold text-night-text no-underline">
                              Call
                            </a>
                          )}
                        </li>
                      ))}
                      {b.vendors.length === 0 && <li className="px-3.5 py-4 text-[14px] text-[#CDB8C4]">No vendors booked for this day.</li>}
                    </ul>
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                  <div className="overflow-hidden rounded-2xl border-2 border-night-rule bg-night-panel">
                    <h2 className="flex items-center justify-between border-b-2 border-night-rule px-3.5 py-2 font-mono text-[12px] font-semibold tracking-[0.08em] uppercase">
                      <span>Crew check-in</span>
                      <span>
                        {arrived} of {b.crew.length} in
                      </span>
                    </h2>
                    <ul>
                      {b.crew.map((c) => {
                        const window = attendanceWindow(c.reportAt, now);
                        const late = c.attendance === "PENDING" && now.getTime() > c.reportAt.getTime() + 15 * 60_000;
                        return (
                          <li key={c.shiftId} className="grid grid-cols-1 gap-2 border-b border-night-rule px-3.5 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_250px] sm:items-center">
                            <span className="flex flex-col leading-tight">
                              <span className="flex flex-wrap items-center gap-2 text-[15.5px] font-semibold">
                                {c.name}
                                {!c.answered && <span className="bg-look px-1.5 font-mono text-[10.5px] text-ink uppercase">Not answered</span>}
                                {late && <span className="bg-now px-1.5 font-mono text-[10.5px] text-[#FFF6EE] uppercase">Late</span>}
                              </span>
                              <span className="text-[13px] text-[#CDB8C4]">
                                {c.duty} · report <span className="font-mono">{formatTime(c.reportAt)}</span>
                                {c.location ? ` · ${c.location}` : ""}
                                {c.checkInAt ? ` · in ${formatTime(c.checkInAt)}${c.selfCheckIn ? " (self)" : ""}` : ""}
                              </span>
                              <a href={`tel:${c.phone}`} className="mt-0.5 font-mono text-[12.5px] font-semibold text-night-plum">
                                {formatPhone(c.phone)}
                              </a>
                            </span>
                            {canMark && b.onTeam ? (
                              <AttendanceButtons shiftId={c.shiftId} name={c.name} current={c.attendance} night disabledReason={window === "early" ? `Opens at ${formatTime(new Date(c.reportAt.getTime() - 6 * 3600_000))}` : window === "closed" && !actor.isOwner ? "Shift over" : null} />
                            ) : (
                              <span className="font-mono text-[12px] font-semibold uppercase">{c.attendance}</span>
                            )}
                          </li>
                        );
                      })}
                      {b.crew.length === 0 && <li className="px-3.5 py-4 text-[14px] text-[#CDB8C4]">No crew booked for this day.</li>}
                    </ul>
                  </div>

                  <div className="overflow-hidden rounded-2xl border-2 border-night-rule bg-night-panel">
                    <h2 className="border-b-2 border-night-rule px-3.5 py-2 font-mono text-[12px] font-semibold tracking-[0.08em] uppercase">Tasks due · {b.tasks.length}</h2>
                    <ul>
                      {b.tasks.map((t) => (
                        <li key={t.id} className="flex items-center justify-between gap-3 border-b border-night-rule px-3.5 py-2.5 last:border-b-0">
                          <span className="flex flex-col leading-tight">
                            <span className="text-[15px] font-semibold">{t.title}</span>
                            <span className="text-[13px] text-[#CDB8C4]">
                              {t.assignee?.name ?? "Not assigned"}
                              {t.dueAt ? ` · by ${formatTime(t.dueAt)}` : ""}
                              {t.needsProof ? (t._count.proofs ? " · photo sent" : " · needs a photo") : ""}
                            </span>
                          </span>
                          <span className={`px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase ${t.status === "UNDER_REVIEW" ? "bg-look text-ink" : t.status === "DELAYED" ? "bg-now text-[#FFF6EE]" : "border border-night-rule"}`}>
                            {t.status.replace("_", " ")}
                          </span>
                        </li>
                      ))}
                      {b.tasks.length === 0 && <li className="px-3.5 py-4 text-[14px] text-[#CDB8C4]">Nothing due.</li>}
                    </ul>
                    {b.tasks.length > 0 && (
                      <Link href={`/bookings/${b.id}?tab=tasks`} className="block border-t-2 border-night-rule px-3.5 py-2 font-mono text-[12px] font-semibold tracking-[0.06em] text-night-plum uppercase">
                        Update tasks →
                      </Link>
                    )}
                  </div>

                  <div className="rounded-2xl border-2 border-night-rule bg-night-panel px-3.5 py-3">
                    <h2 className="mb-2 font-mono text-[12px] font-semibold tracking-[0.08em] uppercase">Team</h2>
                    <ul className="flex flex-wrap gap-2">
                      {b.team.map((m) => (
                        <li key={`${m.role}-${m.name}`}>
                          {m.phone ? (
                            <a href={`tel:${m.phone}`} className="flex min-h-11 items-center gap-2 rounded-xl border-2 border-night-rule px-3 text-[14px] text-night-text no-underline">
                              <span className="font-mono text-[10.5px] text-[#CDB8C4] uppercase">{m.role === "MANAGER" ? "Manager" : "Supervisor"}</span> {m.name}
                            </a>
                          ) : (
                            <span className="flex min-h-11 items-center gap-2 rounded-xl border-2 border-night-rule px-3 text-[14px]">
                              <span className="font-mono text-[10.5px] text-[#CDB8C4] uppercase">{m.role === "MANAGER" ? "Manager" : "Supervisor"}</span> {m.name}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}
