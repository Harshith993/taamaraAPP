import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, Panel, Tag } from "@/components/ui";
import { db } from "@/lib/db";
import { formatCalendarDate, formatINR, todayAsDate, todayInIndia } from "@/lib/format";
import { spendableAdvances } from "@/modules/finance/advances";
import { listExpenses } from "@/modules/finance/expenses";
import { can, eventWhere } from "@/modules/identity/policy";
import { requirePermission } from "@/modules/identity/session";
import { ExpenseForm, RepayButton } from "./expense-forms";

export const metadata: Metadata = { title: "Expenses" };

const TONE = { SUBMITTED: "look", APPROVED: "plum", REJECTED: "quiet", REIMBURSED: "ok" } as const;
const WORDS = { SUBMITTED: "Waiting for host", APPROVED: "Approved", REJECTED: "Not approved", REIMBURSED: "Repaid" } as const;
const STATES = [
  { key: "all", label: "All" },
  { key: "SUBMITTED", label: "Waiting" },
  { key: "APPROVED", label: "Approved" },
  { key: "REIMBURSED", label: "Repaid" },
  { key: "REJECTED", label: "Not approved" },
];

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ state?: string; advance?: string }> }) {
  const actor = await requirePermission("expenses.record");
  const sp = await searchParams;
  const state = STATES.find((s) => s.key === sp.state)?.key ?? "all";
  const [expenses, bookings, categories, advances] = await Promise.all([
    listExpenses(db, actor, { status: state }),
    db.event.findMany({
      where: { AND: [eventWhere(actor, "expenses.record"), { status: { notIn: ["CANCELLED", "SETTLED"] } }, { OR: [{ endDate: { gte: new Date(todayAsDate().getTime() - 30 * 86400_000) } }, { endDate: null }] }] },
      orderBy: { startDate: "asc" },
      select: { id: true, name: true },
      take: 100,
    }),
    db.expenseCategory.findMany({ where: { group: { not: "VENDOR" } }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    spendableAdvances(db, actor),
  ]);
  const startAdvance = advances.find((a) => a.id === sp.advance)?.id ?? null;
  const repays = can(actor, "payments.markPaid");
  const toRepay = expenses.filter((e) => e.status === "APPROVED" && e.paidVia === "OWN_POCKET");

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-condensed text-[clamp(32px,4vw,46px)] leading-[0.95]">Expenses</h1>
        <p className="mt-1 text-[15px] text-ink-quiet">
          Small spends on a booking: tea, transport, last-minute buys. Attach the bill for every expense, however small; a host approves; money from your own pocket is repaid. Spending from a cash advance comes off what is left on it.
        </p>
      </div>
      <ExpenseForm bookings={bookings} categories={categories} allowNoBooking={actor.grants.get("expenses.record") === "ALL"} today={todayInIndia()} advances={advances.map((a) => ({ id: a.id, label: `Cash advance: ${a.purpose} (${formatINR(a.left)} left)`, eventId: a.event?.id ?? null, left: a.left }))} startAdvance={startAdvance} />
      {repays && toRepay.length > 0 && (
        <p className="text-[14px] font-semibold text-plum">
          {toRepay.length} approved expense{toRepay.length === 1 ? "" : "s"} to repay: {formatINR(toRepay.reduce((s, e) => s + e.amount, 0))}
        </p>
      )}
      <nav aria-label="Filter expenses" className="flex w-fit max-w-full flex-wrap self-start gap-1 rounded-full border border-line bg-ground p-1 text-[13.5px] font-medium">
        {STATES.map((s) => (
          <Link key={s.key} href={`/expenses?state=${s.key}`} aria-current={s.key === state ? "page" : undefined} className={`flex min-h-9 items-center rounded-full px-3.5 no-underline transition ${s.key === state ? "bg-white text-ink shadow-[var(--shadow-card)]" : "text-ink-quiet hover:text-ink"}`}>
            {s.label}
          </Link>
        ))}
      </nav>
      <Panel title={`Expenses · ${expenses.length}`}>
        {expenses.length === 0 ? (
          <EmptyState title="No expenses here" />
        ) : (
          <ul>
            {expenses.map((e) => (
              <li key={e.id} className="grid grid-cols-1 items-center gap-2 border-b border-rule-soft px-3.5 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                <span className="flex flex-col leading-tight">
                  <span className="font-semibold">{e.description}</span>
                  <span className="text-[12.5px] text-ink-quiet">
                    {e.category} · {formatCalendarDate(e.spentOn, { day: "numeric", month: "short" })}
                    {e.event ? (
                      <>
                        {" · "}
                        <Link href={`/bookings/${e.event.id}?tab=money`}>{e.event.name}</Link>
                      </>
                    ) : (
                      " · company"
                    )}
                    {" · "}
                    {e.mine ? "you" : e.submittedBy}
                    {e.paidVia === "OWN_POCKET" ? " paid" : " · company paid"}
                    {e.receipt?.originalUrl ? (
                      <>
                        {" · "}
                        <a href={e.receipt.originalUrl} target="_blank" rel="noopener">
                          receipt
                        </a>
                      </>
                    ) : (
                      " · no receipt"
                    )}
                  </span>
                  {e.decisionNote && <span className="text-[12.5px] text-now">{e.decidedBy}: {e.decisionNote}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-mono font-semibold">{formatINR(e.amount)}</span>
                  <Tag tone={TONE[e.status]}>{WORDS[e.status]}</Tag>
                </span>
                {repays && e.status === "APPROVED" && e.paidVia === "OWN_POCKET" ? <RepayButton id={e.id} /> : <span />}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
