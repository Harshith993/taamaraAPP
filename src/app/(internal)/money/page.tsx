import type { Metadata } from "next";
import Link from "next/link";
import { MarkPaid, PreparePayment } from "@/components/finance-controls";
import { ArrowDownLeft, ArrowUpRight, Clock, HandCoins, Receipt, TrendingUp, type LucideIcon } from "lucide-react";
import { EmptyState, IconTile, Panel, Tag, type Tint } from "@/components/ui";
import { db } from "@/lib/db";
import { formatCalendarDate, formatDate, formatINR, todayInIndia } from "@/lib/format";
import { EVENT_STATUS_TONE } from "@/modules/events/labels";
import { moneyOverview } from "@/modules/finance/overview";
import { EXPORT_KINDS, EXPORT_LABELS } from "@/modules/finance/exports";
import { financialYearOf, fyLabel, fyMonths, monthlyPnl, type PnlMonth } from "@/modules/finance/pnl";
import { can } from "@/modules/identity/policy";
import { requirePermission } from "@/modules/identity/session";

export const metadata: Metadata = { title: "Money" };

function Tile({ label, value, note, tone, icon: Icon, tint }: { label: string; value: number; note?: string; tone?: "ok" | "now"; icon: LucideIcon; tint: Tint }) {
  return (
    <div className="lift flex flex-col gap-2 rounded-[20px] border border-line bg-white p-4 shadow-[var(--shadow-card)]">
      <span className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-ink-quiet">{label}</span>
        <IconTile tint={tint} size="sm">
          <Icon aria-hidden className="size-4" />
        </IconTile>
      </span>
      <span className={`font-condensed text-[28px] leading-tight tabular-nums ${tone === "ok" ? "text-ok-text" : tone === "now" ? "text-now" : ""}`}>{formatINR(value)}</span>
      {note && <span className="text-[12.5px] text-ink-quiet">{note}</span>}
    </div>
  );
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (ym: string) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;

function PnlRow({ r, total }: { r: PnlMonth; total?: boolean }) {
  const cell = "px-3 py-2 text-right font-mono";
  const quiet = !total && r.bookings === 0 && r.received === 0 && r.paidOut === 0 && r.officeCost === 0;
  return (
    <tr className={`border-b border-rule-soft ${total ? "border-t border-t-line font-semibold" : ""} ${quiet ? "text-ink-quiet" : ""}`}>
      <th scope="row" className="px-3.5 py-2 text-left font-semibold">
        {total ? "Total" : monthName(r.month)}
      </th>
      <td className={cell}>
        {r.bookings}
        {r.settled ? <span className="block text-[11px] text-ok-text">{r.settled} settled</span> : null}
      </td>
      <td className={cell}>{formatINR(r.billed)}</td>
      <td className={cell}>{formatINR(r.vendorCost + r.crewCost + r.expenseCost)}</td>
      <td className={`${cell} font-semibold ${r.margin < 0 ? "text-now" : ""}`}>{formatINR(r.margin)}</td>
      <td className={cell}>{r.officeCost ? formatINR(r.officeCost) : "—"}</td>
      <td className={`${cell} ${r.afterOffice < 0 ? "text-now" : ""}`}>{formatINR(r.afterOffice)}</td>
      <td className={`${cell} border-l border-line text-ok-text`}>{formatINR(r.received)}</td>
      <td className={cell}>{formatINR(r.paidOut)}</td>
      <td className={`${cell} ${r.net < 0 ? "text-now" : ""}`}>{formatINR(r.net)}</td>
    </tr>
  );
}

export default async function MoneyPage({ searchParams }: { searchParams: Promise<{ fy?: string }> }) {
  const actor = await requirePermission("finance.company");
  const today = todayInIndia();
  const sp = await searchParams;
  const thisFy = financialYearOf(today);
  const fy = /^\d{4}$/.test(sp.fy ?? "") && Math.abs(Number(sp.fy) - thisFy) <= 10 ? Number(sp.fy) : thisFy;
  const [m, pnl] = await Promise.all([moneyOverview(db, actor), monthlyPnl(db, actor, fyMonths(fy))]);
  const pays = can(actor, "payments.markPaid");
  const prepares = can(actor, "payments.prepare");

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-condensed text-[clamp(32px,4vw,46px)] leading-[0.95]">Money</h1>
        <p className="mt-1 text-[15px] text-ink-quiet">Across every booking. Client amounts are before GST; vendor costs include the GST on their invoices.</p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Billed to clients" value={m.totals.billed} icon={Receipt} tint="violet" />
        <Tile label="Received" value={m.totals.received} tone="ok" icon={ArrowDownLeft} tint="green" />
        <Tile label="Clients still owe" value={m.totals.due} note="with GST" tone={m.totals.due > 0 ? "now" : undefined} icon={Clock} tint="rose" />
        <Tile label="Paid out" value={m.totals.paidOut} icon={ArrowUpRight} tint="orange" />
        <Tile label="Approved, to pay" value={m.totals.toPay} note={m.waitingApproval ? `${m.waitingApproval} more waiting for a host` : undefined} icon={HandCoins} tint="yellow" />
        <Tile label="Margin before tax" value={m.totals.margin} tone={m.totals.margin < 0 ? "now" : "ok"} icon={TrendingUp} tint="sky" />
      </div>

      <Panel
        title={`Month by month · FY ${fyLabel(fy)}`}
        action={
          <span className="flex items-center gap-1.5">
            <Link href={`/money?fy=${fy - 1}`} className="label-mono inline-flex min-h-11 items-center px-2 text-[12px]" aria-label={`Financial year ${fyLabel(fy - 1)}`}>
              ← {fyLabel(fy - 1)}
            </Link>
            {fy < thisFy && (
              <Link href={`/money?fy=${fy + 1}`} className="label-mono inline-flex min-h-11 items-center px-2 text-[12px]" aria-label={`Financial year ${fyLabel(fy + 1)}`}>
                {fyLabel(fy + 1)} →
              </Link>
            )}
            <a href={`/api/v1/exports?kind=pnl&from=${fy}-04-01&to=${fy + 1}-03-31`} className="label-mono inline-flex min-h-11 items-center border border-line px-2.5 text-[12px] font-semibold">
              Excel
            </a>
          </span>
        }
      >
        <p className="px-3.5 pt-2.5 text-[13px] text-ink-quiet">Bookings count in the month of their first day. Received and paid out are by payment date. Office expenses are approved expenses not tied to a booking.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-[13.5px]" aria-label={`Monthly profit and loss, FY ${fyLabel(fy)}`}>
            <thead>
              <tr className="label-mono border-b border-line text-left text-[11px] text-ink-quiet">
                <th scope="col" className="px-3.5 py-2 font-semibold">Month</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Bookings</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Billed</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Costs</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Margin</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Office</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">After office</th>
                <th scope="col" className="border-l border-line px-3 py-2 text-right font-semibold">Received</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Paid out</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Net cash</th>
              </tr>
            </thead>
            <tbody>
              {pnl.months.map((r) => (
                <PnlRow key={r.month} r={r} />
              ))}
              <PnlRow r={pnl.total} total />
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="flex flex-wrap items-start gap-4">
        <Panel title={`Payments to make · ${m.toPay.length}`} className="min-w-0 flex-[1_1_460px]">
          {m.toPay.length === 0 ? (
            <EmptyState title="Nothing approved and waiting">Payments appear here once a host approves them.</EmptyState>
          ) : (
            <ul>
              {m.toPay.map((p) => (
                <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-rule-soft px-3.5 py-2.5 last:border-b-0">
                  <span className="flex flex-col leading-tight">
                    <span className="font-semibold">
                      {p.party} · <span className="font-mono">{formatINR(p.amount)}</span>
                    </span>
                    <span className="text-[12.5px] text-ink-quiet">
                      {p.event ? <Link href={`/bookings/${p.event.id}?tab=money`}>{p.event.name}</Link> : "No booking"}
                      {p.invoice ? ` · ${p.invoice}` : ""}
                      {p.approvedAt ? ` · approved ${formatDate(p.approvedAt, { day: "numeric", month: "short" })}` : ""}
                    </span>
                  </span>
                  {pays && <MarkPaid paymentId={p.id} method={p.method} today={today} />}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={`Checked invoices to pay · ${m.readyInvoices.length}`} className="min-w-0 flex-[1_1_460px]">
          {m.readyInvoices.length === 0 ? (
            <EmptyState title="No checked invoices waiting" />
          ) : (
            <ul>
              {m.readyInvoices.map((i) => (
                <li key={i.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-rule-soft px-3.5 py-2.5 last:border-b-0">
                  <span className="flex flex-col leading-tight">
                    <span className="font-semibold">
                      {i.vendor} · <span className="font-mono text-[13px]">{i.number}</span>
                    </span>
                    <span className="text-[12.5px] text-ink-quiet">
                      {formatINR(i.left)} left of {formatINR(i.total)}
                      {i.event ? ` · ${i.event.name}` : ""}
                      {i.approvedProof ? "" : " · no approved proof yet"}
                    </span>
                  </span>
                  {prepares && <PreparePayment kind="VENDOR_INVOICE" id={i.id} left={i.left} />}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {can(actor, "reports.finance") && (
        <Panel title="Exports for the accountant">
          <form action="/api/v1/exports" method="get" className="flex flex-wrap items-end gap-3 px-3.5 py-3">
            <label className="flex flex-col gap-1">
              <span className="label-mono text-[12px]">Report</span>
              <select name="kind" className="min-h-11 rounded-xl border border-line bg-paper px-2.5 text-[15px]">
                {EXPORT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {EXPORT_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="label-mono text-[12px]">From</span>
              <input type="date" name="from" defaultValue={`${today.slice(0, 7)}-01`} className="min-h-11 rounded-xl border border-line bg-paper px-2.5 text-[15px]" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="label-mono text-[12px]">To</span>
              <input type="date" name="to" defaultValue={today} className="min-h-11 rounded-xl border border-line bg-paper px-2.5 text-[15px]" />
            </label>
            <button type="submit" className="min-h-11 rounded-xl border border-line px-4 font-mono text-[12.5px] font-semibold uppercase">
              Download Excel
            </button>
          </form>
        </Panel>
      )}

      <Panel title="By booking">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse text-[13.5px]">
            <thead>
              <tr className="label-mono border-b border-line text-left text-[11px] text-ink-quiet">
                <th scope="col" className="px-3.5 py-2 font-semibold">Booking</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Billed</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Received</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Still owed</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Costs</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Paid out</th>
                <th scope="col" className="px-3.5 py-2 text-right font-semibold">Margin</th>
              </tr>
            </thead>
            <tbody>
              {m.bookings.map((b) => (
                <tr key={b.id} className="border-b border-rule-soft last:border-b-0">
                  <td className="px-3.5 py-2.5">
                    <Link href={`/bookings/${b.id}?tab=money`} className="font-bold">
                      {b.name}
                    </Link>
                    <span className="block text-[12px] text-ink-quiet">
                      {b.code} · {b.client}
                      {b.startDate ? ` · ${formatCalendarDate(b.startDate, { day: "numeric", month: "short" })}` : ""} <Tag tone={EVENT_STATUS_TONE[b.status]}>{b.status}</Tag>
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">{formatINR(b.billed)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-ok-text">{formatINR(b.received)}</td>
                  <td className={`px-3 py-2.5 text-right font-mono ${b.due > 0.5 ? "text-now" : ""}`}>{formatINR(Math.max(0, b.due))}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{formatINR(b.costs)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{formatINR(b.paidOut)}</td>
                  <td className={`px-3.5 py-2.5 text-right font-mono font-semibold ${b.margin < 0 ? "text-now" : ""}`}>{formatINR(b.margin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
