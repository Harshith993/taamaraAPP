import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Banknote, HandCoins, Wallet } from "lucide-react";
import { CloseAdvance, GiveAdvanceForm, HandOverAdvance, VoidAdvance } from "@/components/advance-controls";
import { ButtonLink, EmptyState, IconTile, Panel, Tag } from "@/components/ui";
import { db } from "@/lib/db";
import { formatCalendarDate, formatINR, todayAsDate, todayInIndia } from "@/lib/format";
import { advanceBalances, advanceHolders, listAdvances, type AdvanceItem } from "@/modules/finance/advances";
import { can } from "@/modules/identity/policy";
import { requireActor } from "@/modules/identity/session";

export const metadata: Metadata = { title: "Cash advances" };

const TONE = { PENDING_APPROVAL: "look", APPROVED: "plum", GIVEN: "ok", CLOSED: "quiet", REJECTED: "quiet", VOIDED: "quiet" } as const;
const WORDS = { PENDING_APPROVAL: "Waiting for a host", APPROVED: "Approved, to hand over", GIVEN: "Open", CLOSED: "Closed", REJECTED: "Not approved", VOIDED: "Voided" } as const;
const EXPENSE_WORDS = { SUBMITTED: "waiting", APPROVED: "approved", REJECTED: "not approved", REIMBURSED: "repaid" } as const;

function AdvanceCard({ a, office, isHost, today }: { a: AdvanceItem; office: boolean; isHost: boolean; today: string }) {
  const open = ["PENDING_APPROVAL", "APPROVED", "GIVEN"].includes(a.status);
  return (
    <li aria-label={`Advance: ${a.holder.name}, ${a.purpose}`} className="flex flex-col gap-2.5 border-b border-rule-soft px-3.5 py-3.5 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[15.5px] font-bold">{office ? a.holder.name : a.purpose}</span>
            <Tag tone={TONE[a.status]}>{WORDS[a.status]}</Tag>
          </span>
          <span className="mt-0.5 text-[13px] text-ink-quiet">
            {office ? `${a.purpose} · ` : ""}
            {a.event ? <Link href={`/bookings/${a.event.id}`}>{a.event.name}</Link> : "Not for one booking"}
            {a.givenOn ? ` · given ${formatCalendarDate(a.givenOn, { day: "numeric", month: "short" })} (${a.method.toLowerCase()}${a.reference ? ` ${a.reference}` : ""})` : ""}
          </span>
        </span>
        <span className="text-right">
          <span className="block font-condensed text-[26px] leading-none tabular-nums">{formatINR(a.amount)}</span>
          {a.status === "GIVEN" && <span className="text-[13px] font-semibold text-plum">{formatINR(a.left)} left</span>}
        </span>
      </div>

      {(a.status === "GIVEN" || a.status === "CLOSED") && (
        <dl className="grid grid-cols-2 gap-2 text-[13px] sm:grid-cols-4">
          <div className="rounded-xl bg-ground px-3 py-2">
            <dt className="text-ink-quiet">Spent, approved</dt>
            <dd className="font-mono font-semibold">{formatINR(a.approved)}</dd>
          </div>
          <div className="rounded-xl bg-ground px-3 py-2">
            <dt className="text-ink-quiet">Spent, waiting</dt>
            <dd className="font-mono font-semibold">{formatINR(a.waiting)}</dd>
          </div>
          <div className="rounded-xl bg-ground px-3 py-2">
            <dt className="text-ink-quiet">Returned</dt>
            <dd className="font-mono font-semibold">{formatINR(a.returned)}</dd>
          </div>
          <div className="rounded-xl bg-ground px-3 py-2">
            <dt className="text-ink-quiet">{a.status === "CLOSED" ? "Settled short" : "Still with them"}</dt>
            <dd className="font-mono font-semibold">{formatINR(a.status === "CLOSED" ? a.shortfall : a.left + a.waiting)}</dd>
          </div>
        </dl>
      )}

      {a.expenses.length > 0 && (
        <ul className="flex flex-col gap-1 text-[13px]">
          {a.expenses.map((e) => (
            <li key={e.id} className="flex flex-wrap justify-between gap-2 border-t border-rule-soft pt-1">
              <span>
                {formatCalendarDate(e.spentOn, { day: "numeric", month: "short" })} · {e.description} <span className="text-ink-quiet">({e.category}, {EXPENSE_WORDS[e.status]})</span>
                {e.receipt?.originalUrl && (
                  <>
                    {" · "}
                    <a href={e.receipt.originalUrl} target="_blank" rel="noopener" className="font-semibold">
                      Bill
                    </a>
                  </>
                )}
              </span>
              <span className={`font-mono ${e.status === "REJECTED" ? "text-ink-quiet line-through" : ""}`}>{formatINR(e.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      {a.closeNote && <p className="text-[13px] text-ink-quiet">Settled: {a.closeNote}</p>}
      {a.voidReason && <p className="text-[13px] text-ink-quiet">Voided: {a.voidReason}</p>}

      <div className="flex flex-wrap items-start gap-2">
        {a.mine && a.status === "GIVEN" && (
          <ButtonLink href={`/expenses?advance=${a.id}`} variant="look" className="min-h-10 px-3.5 text-[12.5px]">
            Record spending
          </ButtonLink>
        )}
        {office && a.status === "APPROVED" && <HandOverAdvance id={a.id} today={today} />}
        {office && a.status === "GIVEN" && <CloseAdvance id={a.id} left={a.left} isHost={isHost} />}
        {office && open && (a.status !== "GIVEN" || (isHost && a.approved + a.waiting === 0)) && <VoidAdvance id={a.id} />}
      </div>
    </li>
  );
}

export default async function AdvancesPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const actor = await requireActor();
  const office = can(actor, "payments.prepare");
  if (!office && !can(actor, "expenses.record")) redirect("/home?denied=1");
  const sp = await searchParams;
  const showAll = sp.show === "all";
  const isHost = can(actor, "approvals.decide");
  const [advances, balances, holders, bookings] = await Promise.all([
    listAdvances(db, actor, { open: !showAll }),
    office ? advanceBalances(db, actor) : Promise.resolve(null),
    advanceHolders(db, actor),
    office
      ? db.event.findMany({
          where: { status: { notIn: ["CANCELLED", "SETTLED"] }, OR: [{ endDate: { gte: new Date(todayAsDate().getTime() - 30 * 86400_000) } }, { endDate: null }] },
          orderBy: { startDate: "asc" },
          select: { id: true, name: true },
          take: 100,
        })
      : Promise.resolve([]),
  ]);
  const today = todayInIndia();
  const mine = advances.filter((a) => a.mine && a.status === "GIVEN");
  const withMe = mine.reduce((s, a) => s + a.left + a.waiting, 0);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-condensed text-[clamp(32px,4vw,46px)] leading-[0.95]">Cash advances</h1>
        <p className="mt-1 max-w-prose text-[15px] text-ink-quiet">
          Company cash carried by managers and supervisors. Spending is recorded as expenses, each with its bill; what is left comes back and the advance is closed.
        </p>
      </div>

      {!office && (
        <section aria-label="Company cash with you" className="flex items-center gap-4 rounded-[24px] border border-line bg-white p-4 shadow-[var(--shadow-lift)]">
          <IconTile tint="green">
            <Wallet aria-hidden className="size-5" />
          </IconTile>
          <span className="flex flex-col">
            <span className="text-[13px] font-medium text-ink-quiet">Company cash with you</span>
            <span className="font-condensed text-[34px] leading-none tabular-nums">{formatINR(withMe)}</span>
            <span className="text-[13px] text-ink-quiet">{mine.length ? `${mine.length} open advance${mine.length === 1 ? "" : "s"}` : "Nothing open"}</span>
          </span>
        </section>
      )}

      {office && <GiveAdvanceForm holders={holders} bookings={bookings} isHost={isHost} today={today} />}

      {balances && (
        <Panel title={`Cash with the team · ${formatINR(balances.held)}`}>
          {balances.people.length === 0 ? (
            <EmptyState title="Nobody is holding company cash" />
          ) : (
            <ul>
              {balances.people.map((p) => (
                <li key={p.userId} className="flex items-center justify-between gap-3 border-b border-rule-soft px-3.5 py-2.5 last:border-b-0">
                  <span className="flex items-center gap-2.5">
                    <IconTile tint="yellow" size="sm">
                      <HandCoins aria-hidden className="size-4" />
                    </IconTile>
                    <span className="flex flex-col leading-tight">
                      <span className="font-semibold">{p.name}</span>
                      <span className="text-[12.5px] text-ink-quiet">
                        {p.open} open{p.waiting ? ` · ${formatINR(p.waiting)} of spending waiting for a host` : ""}
                        {p.toHandOver ? ` · ${formatINR(p.toHandOver)} to hand over` : ""}
                      </span>
                    </span>
                  </span>
                  <span className="font-mono text-[15px] font-semibold">{formatINR(p.held)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      <Panel
        title={`${showAll ? "All advances" : "Open advances"} · ${advances.length}`}
        action={
          <Link href={showAll ? "/advances" : "/advances?show=all"} className="label-mono inline-flex min-h-11 items-center px-2 text-[12px]">
            {showAll ? "Open only" : "Show closed too"}
          </Link>
        }
      >
        {advances.length === 0 ? (
          <EmptyState title={showAll ? "No advances yet" : "No open advances"}>
            <span className="inline-flex items-center gap-1.5">
              <Banknote aria-hidden className="size-4" /> {office ? "Give one above when someone needs cash on site." : "When a host gives you cash for a booking, it appears here."}
            </span>
          </EmptyState>
        ) : (
          <ul>
            {advances.map((a) => (
              <AdvanceCard key={a.id} a={a} office={office} isHost={isHost} today={today} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
