import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EditWorker, RemoveUnavailable, UnavailableForm } from "@/components/directory-forms";
import { EmptyState, Panel, Tag } from "@/components/ui";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { formatCalendarDate, formatDate, formatINR, todayInIndia } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { getWorker } from "@/modules/crew/roster";
import { can } from "@/modules/identity/policy";
import { requirePermission } from "@/modules/identity/session";

export const metadata: Metadata = { title: "Crew member" };

const STATUS_WORDS: Record<string, string> = { ASSIGNED: "Not answered", CONFIRMED: "Confirmed", DECLINED: "Declined", COMPLETED: "Worked", NO_SHOW: "No show", CANCELLED: "Taken off" };

export default async function WorkerProfile({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission("crew.view");
  const { id } = await params;
  let w;
  try {
    w = await getWorker(db, actor, id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const skills = await db.skill.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } });
  const canEdit = actor.grants.get("crew.edit") === "ALL";
  const seesPay = can(actor, "crew.pay.view");

  return (
    <div className="flex flex-col gap-4">
      <Link href="/roster" className="label-mono text-[12px] no-underline">
        ← Crew
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="flex flex-wrap gap-1.5">
            {w.skills.map((s) => (
              <Tag key={s.id} tone="outline">
                {s.name}
              </Tag>
            ))}
            {w.status !== "ACTIVE" && <Tag tone="quiet">INACTIVE</Tag>}
          </span>
          <h1 className="font-condensed text-[clamp(30px,3.6vw,42px)] leading-[0.95]">{w.name}</h1>
          <p className="text-[14px] text-ink-quiet">
            <a href={`tel:${w.phone}`}>{formatPhone(w.phone)}</a>
            {w.city ? ` · ${w.city}` : ""}
            {w.experienceYears ? ` · ${w.experienceYears} years` : ""}
            {seesPay && w.usualRate !== null ? ` · usually ${formatINR(w.usualRate)} per event` : ""}
          </p>
        </div>
        {canEdit && (
          <EditWorker
            skills={skills}
            seesPay={seesPay}
            initial={{ id: w.id, name: w.name, phone: w.phone, city: w.city ?? "", experienceYears: w.experienceYears ? String(w.experienceYears) : "", skillIds: w.skills.map((s) => s.id), usualEventRate: w.usualRate !== null ? String(w.usualRate) : "", emergencyContact: w.emergencyContact ?? "", status: w.status, notes: w.notes ?? "" }}
          />
        )}
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <Panel title={`Bookings · ${w.assignments.length}`} className="min-w-0 flex-[999_1_520px]">
          {w.assignments.length === 0 ? (
            <EmptyState title="No bookings yet">Add them from a booking&apos;s Crew tab.</EmptyState>
          ) : (
            <ul>
              {w.assignments.map((a) => (
                <li key={a.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-rule-soft px-3.5 py-2.5 last:border-b-0">
                  <span className="flex flex-col leading-tight">
                    <Link href={`/bookings/${a.event.id}?tab=crew`} className="text-[14.5px] font-semibold">
                      {a.event.name}
                    </Link>
                    <span className="text-[12.5px] text-ink-quiet">
                      {a.duty}
                      {a.event.startDate ? ` · ${formatCalendarDate(a.event.startDate, { day: "numeric", month: "short", year: "numeric" })}` : ""}
                      {a.present ? ` · present ${a.present}` : ""}
                      {a.absent ? ` · absent ${a.absent}` : ""}
                      {a.declineReason ? ` · ${a.declineReason}` : ""}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block font-mono text-[11.5px] font-semibold uppercase">{STATUS_WORDS[a.status] ?? a.status}</span>
                    {a.pay !== null && <span className="font-mono text-[13px]">{formatINR(a.pay)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
          <Panel title="Not available">
            {w.unavailable.length === 0 ? (
              <p className="px-3.5 pt-3 text-[14px] text-ink-quiet">No days marked.</p>
            ) : (
              <ul>
                {w.unavailable.map((u) => (
                  <li key={u.id} className="flex items-center justify-between gap-3 border-b border-rule-soft px-3.5 py-2 text-[14px]">
                    <span>
                      <strong>{formatCalendarDate(u.date, { weekday: "short", day: "numeric", month: "short" })}</strong>
                      {u.reason ? ` · ${u.reason}` : ""}
                    </span>
                    {canEdit && <RemoveUnavailable workerId={w.id} id={u.id} />}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && <UnavailableForm workerId={w.id} today={todayInIndia()} />}
          </Panel>
          <Panel title="Details">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-3.5 py-3 text-[14px]">
              <dt className="text-ink-quiet">App login</dt>
              <dd>{w.login ? (w.login.status === "ACTIVE" ? (w.login.lastLoginAt ? `last in ${formatDate(w.login.lastLoginAt, { day: "numeric", month: "short" })}` : "not signed in yet") : "switched off") : "none"}</dd>
              {w.emergencyContact && (
                <>
                  <dt className="text-ink-quiet">Emergency</dt>
                  <dd>{w.emergencyContact}</dd>
                </>
              )}
              {w.notes && (
                <>
                  <dt className="text-ink-quiet">Notes</dt>
                  <dd className="whitespace-pre-line">{w.notes}</dd>
                </>
              )}
            </dl>
            {!w.login && can(actor, "admin.users") && (
              <Link href="/team" className="block px-3.5 pb-3 text-[13.5px] font-semibold">
                Give them a login on the Team page →
              </Link>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
