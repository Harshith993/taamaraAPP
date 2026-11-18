import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink, EmptyState, Notice, Panel, Tag } from "@/components/ui";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { formatCalendarDate, formatDate, formatINR, formatTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { EVENT_STATUS_TONE, VENDOR_STAGES, VENDOR_STAGE_WORDS, vendorStageIndex } from "@/modules/events/labels";
import { getBookingCrew, getBookingHeader, getBookingMoney, getBookingSchedule, getBookingTasks, getBookingVendors } from "@/modules/events/workspace";
import { can } from "@/modules/identity/policy";
import { requirePermission } from "@/modules/identity/session";

export const metadata: Metadata = { title: "Booking" };

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "schedule", label: "Schedule" },
  { key: "vendors", label: "Vendors" },
  { key: "crew", label: "Crew" },
  { key: "tasks", label: "Tasks" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default async function BookingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; created?: string }> }) {
  const actor = await requirePermission("bookings.view");
  const { id } = await params;
  const sp = await searchParams;
  const tab: TabKey = (TABS.find((t) => t.key === sp.tab)?.key ?? "overview") as TabKey;

  let header;
  try {
    header = await getBookingHeader(db, actor, id);
  } catch (err) {
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const counts: Partial<Record<TabKey, number>> = { vendors: header.counts.vendorAssignments, crew: header.counts.crewAssignments, tasks: header.counts.tasks };
  const now = new Date();

  return (
    <div className="flex flex-col gap-4">
      {sp.created && <Notice tone="ok">Booking created. Its checklist tasks are on the Tasks tab.</Notice>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Link href="/bookings" className="label-mono text-[12px] no-underline">
            ← Bookings
          </Link>
          <h1 className="font-condensed text-[clamp(30px,3.6vw,42px)] leading-[0.95] uppercase">
            {header.name} · {header.category.name}
          </h1>
          <p className="text-[13.5px] text-ink-quiet">
            {header.code} · {formatCalendarDate(header.startDate, { day: "numeric", month: "short" })}
            {header.endDate && header.startDate && header.endDate.getTime() !== header.startDate.getTime() ? `–${formatCalendarDate(header.endDate, { day: "numeric", month: "short" })}` : ""} · {header.functions.length} function{header.functions.length === 1 ? "" : "s"}
            {header.managers.length ? ` · Lead ${header.managers.join(", ")}` : ""}
            {header.client ? ` · Client ${header.client.name}` : ""}
          </p>
        </div>
        <Tag tone={EVENT_STATUS_TONE[header.status]}>{header.status}</Tag>
      </div>

      <ul aria-label="Functions" className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2">
        {header.functions.map((f) => {
          const live = f.startsAt <= now && (f.endsAt ?? f.startsAt) >= now;
          const done = (f.endsAt ?? f.startsAt) < now;
          return (
            <li key={f.id} className={`flex flex-col gap-0.5 rounded-[3px] border-2 border-ink px-2.5 py-2 ${live ? "bg-ink text-[#F6EFE0]" : "bg-paper"}`}>
              <span className={`font-mono text-[11.5px] font-semibold uppercase ${live ? "text-look" : "text-ink-quiet"}`}>
                {formatDate(f.startsAt, { weekday: "short", day: "numeric" })} · {live ? "now" : done ? "done" : formatTime(f.startsAt)}
              </span>
              <span className="text-[14.5px] font-bold">{f.name}</span>
              <span className={`text-[12px] ${live ? "text-[#D9C7CF]" : "text-ink-quiet"}`}>{f.venue ?? "Venue to be confirmed"}</span>
            </li>
          );
        })}
      </ul>

      <nav aria-label="Booking sections" className="flex flex-wrap border-b-2 border-ink font-mono text-[12.5px] font-semibold tracking-[0.06em] uppercase">
        {TABS.map((t) => (
          <Link key={t.key} href={`/bookings/${id}?tab=${t.key}`} aria-current={t.key === tab ? "page" : undefined} className={`flex min-h-10 items-center px-3.5 no-underline ${t.key === tab ? "bg-look text-ink" : "text-ink-quiet hover:text-ink"}`}>
            {t.label}
            {counts[t.key] !== undefined ? ` ${counts[t.key]}` : ""}
          </Link>
        ))}
      </nav>

      {tab === "overview" && <Overview actor={actor} header={header} />}
      {tab === "schedule" && <Schedule actor={actor} eventId={id} />}
      {tab === "vendors" && <Vendors actor={actor} eventId={id} />}
      {tab === "crew" && <Crew actor={actor} eventId={id} />}
      {tab === "tasks" && <Tasks actor={actor} eventId={id} />}
    </div>
  );
}

type Actor = Awaited<ReturnType<typeof requirePermission>>;
type Header = Awaited<ReturnType<typeof getBookingHeader>>;

async function Overview({ actor, header }: { actor: Actor; header: Header }) {
  const money = await getBookingMoney(db, actor, header.id);
  return (
    <div className="flex flex-wrap items-start gap-4">
      <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-4">
        <Panel title="Functions">
          <ul>
            {header.functions.map((f) => (
              <li key={f.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-rule-soft px-3.5 py-2.5 last:border-b-0">
                <span className="flex flex-col leading-tight">
                  <span className="text-[15px] font-bold">{f.name}</span>
                  <span className="text-[13px] text-ink-quiet">
                    {f.venue ?? "Venue to be confirmed"}
                    {f.guests ? ` · ${f.guests} guests` : ""}
                  </span>
                </span>
                <span className="text-right font-mono text-[12.5px]">
                  {formatDate(f.startsAt, { weekday: "short", day: "numeric", month: "short" })}
                  <br />
                  {formatTime(f.startsAt)}
                  {f.endsAt ? `–${formatTime(f.endsAt)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
        {header.description && (
          <Panel title="Notes">
            <p className="px-3.5 py-3 text-[14.5px] whitespace-pre-line">{header.description}</p>
          </Panel>
        )}
      </div>
      <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
        {money && (
          <Panel title="Money">
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 px-3.5 py-3 text-[14px]">
              {money.billed !== null && (
                <>
                  <dt className="text-ink-quiet">Billed to client</dt>
                  <dd className="text-right font-mono font-semibold">{formatINR(money.billed)}</dd>
                  <dt className="text-ink-quiet">Received</dt>
                  <dd className="text-right font-mono text-ok-text">{formatINR(money.received)}</dd>
                </>
              )}
              <dt className="text-ink-quiet">Committed costs</dt>
              <dd className="text-right font-mono">{formatINR(money.committedCosts)}</dd>
              {money.budget !== null && (
                <>
                  <dt className="text-ink-quiet">Approved cost budget</dt>
                  <dd className="text-right font-mono">{formatINR(money.budget)}</dd>
                </>
              )}
              <dt className="text-ink-quiet">Paid out</dt>
              <dd className="text-right font-mono">{formatINR(money.paidOut)}</dd>
              {money.expectedProfit !== null && (
                <>
                  <dt className="border-t-2 border-ink pt-1.5 font-semibold">Expected profit</dt>
                  <dd className="border-t-2 border-ink pt-1.5 text-right font-mono font-semibold">{formatINR(money.expectedProfit)}</dd>
                </>
              )}
            </dl>
          </Panel>
        )}
        {header.client && (
          <Panel title="Client">
            <div className="flex flex-col gap-1 px-3.5 py-3 text-[14px]">
              <p className="font-bold">{header.client.name}</p>
              {header.client.phone && <p>{formatPhone(header.client.phone)}</p>}
              {header.client.contacts.map((c) => (
                <p key={`${c.name}-${c.phone}`} className="text-ink-quiet">
                  {c.name}
                  {c.relation ? ` (${c.relation})` : ""}
                  {c.phone ? ` · ${formatPhone(c.phone)}` : ""}
                </p>
              ))}
            </div>
          </Panel>
        )}
        <Panel title="Team">
          <div className="flex flex-col gap-1 px-3.5 py-3 text-[14px]">
            <p>
              <span className="text-ink-quiet">Manager:</span> {header.managers.join(", ") || "not assigned"}
            </p>
            <p>
              <span className="text-ink-quiet">Supervisor:</span> {header.supervisors.join(", ") || "not assigned"}
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}

async function Schedule({ actor, eventId }: { actor: Actor; eventId: string }) {
  const items = await getBookingSchedule(db, actor, eventId);
  if (!items.length) return <Panel><EmptyState title="No run sheet yet">Schedule items for each function appear here.</EmptyState></Panel>;
  const now = new Date();
  return (
    <Panel title={`Run sheet · ${items.length}`}>
      <ol>
        {items.map((s) => {
          const past = (s.endsAt ?? s.startsAt) < now;
          return (
            <li key={s.id} className={`grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 border-b border-rule-soft px-3.5 py-2.5 last:border-b-0 ${past ? "text-ink-quiet" : ""}`}>
              <span className="font-mono text-[13.5px] font-semibold">{formatTime(s.startsAt)}</span>
              <span className="flex flex-col leading-tight">
                <span className="text-[14.5px] font-semibold">{s.title}</span>
                <span className="text-[12.5px] text-ink-quiet">
                  {s.function?.name ?? "Whole booking"} · {formatDate(s.startsAt)}
                  {s.visibleToVendors ? " · vendors see this" : ""}
                  {s.visibleToCrew ? " · crew see this" : ""}
                </span>
              </span>
              <span className="label-mono text-[10.5px]">{s.type.replace("_", " ")}</span>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

async function Vendors({ actor, eventId }: { actor: Actor; eventId: string }) {
  const rows = await getBookingVendors(db, actor, eventId);
  const seesMoney = can(actor, "quotes.view");
  if (!rows.length) return <Panel><EmptyState title="No vendors yet">Vendors asked to quote or booked for this event appear here.</EmptyState></Panel>;
  return (
    <Panel title={`Vendors · ${rows.length}`} action={can(actor, "approvals.decide") ? <ButtonLink href="/approvals" variant="ghost">Approvals →</ButtonLink> : undefined}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-[13.5px]">
          <thead>
            <tr className="label-mono border-b-2 border-ink text-left text-[11px] text-ink-quiet">
              <th scope="col" className="px-3.5 py-2 font-semibold">Vendor</th>
              <th scope="col" className="px-3 py-2 font-semibold">Work · functions</th>
              <th scope="col" className="px-3 py-2 font-semibold">Stage</th>
              {seesMoney && <th scope="col" className="px-3 py-2 text-right font-semibold">Agreed / quote</th>}
              <th scope="col" className="px-3.5 py-2 text-right font-semibold">Proof</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const step = vendorStageIndex(r.status);
              const needsYou = r.status === "QUOTED";
              return (
                <tr key={r.id} className={`border-b border-rule-soft last:border-b-0 ${needsYou ? "bg-look/15" : ""}`}>
                  <td className="px-3.5 py-2.5">
                    <span className="flex items-center gap-2.5">
                      <span className="h-8 w-2 shrink-0" style={{ background: r.color }} aria-hidden="true" />
                      <span className="flex flex-col leading-tight">
                        <span className="font-bold">{r.vendor}</span>
                        <span className="text-[12px] text-ink-quiet">{r.department ?? ""}</span>
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="flex flex-col leading-tight">
                      <span>{r.scope}</span>
                      <span className="text-[12px] text-ink-quiet">{r.functions.join(" · ") || "—"}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="flex flex-col gap-1">
                      <span role="img" aria-label={`Stage ${step} of ${VENDOR_STAGES.length}`} className="grid w-36 grid-cols-6 gap-0.5">
                        {VENDOR_STAGES.map((st, i) => (
                          <span key={st} className={`h-1.5 ${i < step ? "bg-ink" : "bg-rule-soft"}`} />
                        ))}
                      </span>
                      <span className={`font-mono text-[11px] font-semibold uppercase ${needsYou ? "text-plum" : ""}`}>{VENDOR_STAGE_WORDS[r.status] ?? r.status}</span>
                    </span>
                  </td>
                  {seesMoney && (
                    <td className="px-3 py-2.5 text-right font-mono">
                      {r.agreed !== null ? formatINR(r.agreed) : r.latestQuote ? `${formatINR(r.latestQuote.total)} (v${r.latestQuote.version})` : "—"}
                    </td>
                  )}
                  <td className="px-3.5 py-2.5 text-right font-mono">{r.proofCount || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

async function Crew({ actor, eventId }: { actor: Actor; eventId: string }) {
  const rows = await getBookingCrew(db, actor, eventId);
  const seesPay = can(actor, "crew.pay.view");
  if (!rows.length) return <Panel><EmptyState title="No crew yet">Crew booked for this event appear here.</EmptyState></Panel>;
  return (
    <Panel title={`Crew · ${rows.length}`}>
      <ul>
        {rows.map((r) => (
          <li key={r.id} className="grid grid-cols-1 gap-2 border-b border-rule-soft px-3.5 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] sm:items-center">
            <span className="flex flex-col leading-tight">
              <span className="font-bold">{r.name}</span>
              <span className="text-[12.5px] text-ink-quiet">
                {r.duty}
                {r.skills.length ? ` · ${r.skills.join(", ")}` : ""} · {formatPhone(r.phone)}
              </span>
            </span>
            <span className="flex flex-wrap gap-1.5">
              {r.shifts.map((s) => (
                <span key={s.id} className="flex items-center gap-1.5 rounded-[3px] border border-rule-soft px-2 py-1 text-[12px]">
                  {s.function ?? "Shift"} · {formatDate(s.reportAt, { weekday: "short", day: "numeric" })} {formatTime(s.reportAt)}
                  <Tag tone={s.attendance === "PRESENT" ? "ok" : s.attendance === "LATE" ? "look" : s.attendance === "ABSENT" ? "now" : "quiet"}>{s.attendance}</Tag>
                </span>
              ))}
            </span>
            {seesPay && (
              <span className="text-right font-mono text-[13.5px]">
                {formatINR(r.pay)}
                {r.pendingExtras ? <span className="block text-[11.5px] text-plum">{r.pendingExtras} extra waiting</span> : null}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

async function Tasks({ actor, eventId }: { actor: Actor; eventId: string }) {
  const tasks = await getBookingTasks(db, actor, eventId);
  if (!tasks.length) return <Panel><EmptyState title="No tasks" /></Panel>;
  const tone = (s: string) => (s === "DELAYED" ? "now" : s === "UNDER_REVIEW" ? "look" : s === "IN_PROGRESS" ? "plum" : s === "COMPLETED" ? "ok" : s === "PENDING" ? "quiet" : "outline");
  return (
    <Panel title={`Tasks · ${tasks.length}`}>
      <ul>
        {tasks.map((t) => (
          <li key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-rule-soft px-3.5 py-2.5 last:border-b-0">
            <span className="flex flex-col leading-tight">
              <span className="text-[14.5px] font-semibold">{t.title}</span>
              <span className="text-[12.5px] text-ink-quiet">
                {t.function?.name ? `${t.function.name} · ` : ""}
                {t.assignee?.name ?? "Not assigned"}
                {t.dueAt ? ` · due ${formatDate(t.dueAt)} ${formatTime(t.dueAt)}` : ""}
                {t.needsProof ? " · needs proof" : ""}
                {t._count.proofs ? ` · ${t._count.proofs} proof sent` : ""}
              </span>
            </span>
            <Tag tone={tone(t.status)}>{t.status.replace("_", " ")}</Tag>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
