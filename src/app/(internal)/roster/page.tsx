import type { Metadata } from "next";
import Link from "next/link";
import { AddWorker } from "@/components/directory-forms";
import { EmptyState, Panel, Tag } from "@/components/ui";
import { db } from "@/lib/db";
import { formatCalendarDate, formatINR } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { listWorkers } from "@/modules/crew/roster";
import { can } from "@/modules/identity/policy";
import { requirePermission } from "@/modules/identity/session";

export const metadata: Metadata = { title: "Crew" };

export default async function RosterPage({ searchParams }: { searchParams: Promise<{ q?: string; skill?: string; status?: string }> }) {
  const actor = await requirePermission("crew.view");
  const sp = await searchParams;
  const skills = await db.skill.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } });
  const skill = skills.find((s) => s.id === sp.skill)?.id;
  const workers = await listWorkers(db, actor, { q: sp.q, skillId: skill, status: sp.status === "all" ? "all" : "ACTIVE" });
  const seesPay = can(actor, "crew.pay.view");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-condensed text-[26px] leading-tight tracking-[-0.03em] sm:text-[30px]">Crew</h1>
          <p className="mt-1 text-[15px] text-ink-quiet">Everyone you hire per event: decorators, helpers, electricians, waiters, drivers.</p>
        </div>
        {can(actor, "crew.create") && <AddWorker skills={skills} seesPay={seesPay} />}
      </div>
      <form className="flex flex-wrap items-center gap-2" action="/roster">
        <input name="q" defaultValue={sp.q} placeholder="Search name, phone or city" aria-label="Search crew" className="min-h-11 min-w-[240px] flex-1 rounded-xl border border-line bg-paper px-3 text-[15px]" />
        {skill && <input type="hidden" name="skill" value={skill} />}
        <button type="submit" className="group inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-line bg-white px-5 text-[14px] font-semibold text-ink no-underline shadow-[0_1px_2px_rgb(22_20_31/0.05)] transition hover:-translate-y-px hover:bg-ground">
          Search
        </button>
      </form>
      <nav aria-label="Skills" className="flex flex-wrap gap-1.5 text-[13px]">
        <Link href={`/roster${sp.q ? `?q=${encodeURIComponent(sp.q)}` : ""}`} aria-current={!skill ? "page" : undefined} className={`flex min-h-10 items-center rounded-xl border px-3 no-underline ${!skill ? "border-line bg-look" : "border-rule-soft"}`}>
          All
        </Link>
        {skills.map((s) => (
          <Link key={s.id} href={`/roster?skill=${s.id}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`} aria-current={skill === s.id ? "page" : undefined} className={`flex min-h-10 items-center rounded-xl border px-3 no-underline ${skill === s.id ? "border-line bg-look" : "border-rule-soft"}`}>
            {s.name}
          </Link>
        ))}
      </nav>
      <Panel title={`Crew · ${workers.length}`}>
        {workers.length === 0 ? (
          <EmptyState title="Nobody matches">Try another search, or register someone.</EmptyState>
        ) : (
          <ul>
            {workers.map((w) => (
              <li key={w.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-rule-soft px-3.5 py-2.5 last:border-b-0">
                <span className="flex min-w-0 flex-col leading-tight">
                  <Link href={`/roster/${w.id}`} className="text-[15px] font-bold">
                    {w.name}
                  </Link>
                  <span className="truncate text-[12.5px] text-ink-quiet">
                    {w.skills.map((s) => s.name).join(", ")} · {formatPhone(w.phone)}
                    {w.city ? ` · ${w.city}` : ""}
                  </span>
                  <span className="text-[12.5px]">
                    {w.lastWorked ? `Last worked ${formatCalendarDate(w.lastWorked, { day: "numeric", month: "short" })}` : "Not worked with us yet"}
                    {w.upcoming ? ` · ${w.upcoming} coming up` : ""}
                    {w.nextOff ? ` · away ${formatCalendarDate(w.nextOff, { day: "numeric", month: "short" })}` : ""}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  {seesPay && w.usualRate !== null && <span className="font-mono text-[13.5px]">{formatINR(w.usualRate)}/event</span>}
                  {w.status !== "ACTIVE" && <Tag tone="quiet">INACTIVE</Tag>}
                  {w.hasLogin ? <span className="font-mono text-[11px] text-ok-text">HAS APP LOGIN</span> : <span className="font-mono text-[11px] text-ink-quiet">NO LOGIN</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
