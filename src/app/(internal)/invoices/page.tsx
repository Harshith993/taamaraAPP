import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, Panel, Tag } from "@/components/ui";
import { db } from "@/lib/db";
import { formatCalendarDate, formatDate, formatINR } from "@/lib/format";
import { requirePermission } from "@/modules/identity/session";
import { listInvoices } from "@/modules/vendors/invoices";
import { InvoiceReview } from "./review-buttons";

export const metadata: Metadata = { title: "Vendor invoices" };

const STATES = [
  { key: "SUBMITTED", label: "To check" },
  { key: "VERIFIED", label: "Ready to pay" },
  { key: "DISPUTED", label: "Sent back" },
  { key: "all", label: "All" },
] as const;

const TONE: Record<string, "look" | "ok" | "now" | "quiet" | "outline"> = { SUBMITTED: "look", VERIFIED: "ok", APPROVED: "ok", PART_PAID: "outline", PAID: "ok", DISPUTED: "now", VOID: "quiet" };

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const actor = await requirePermission("payments.prepare");
  const sp = await searchParams;
  const state = STATES.find((s) => s.key === sp.state)?.key ?? "SUBMITTED";
  const invoices = await listInvoices(db, actor, { status: state });
  const needsProof = actor.switches.finalVendorPaymentNeedsProof;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-condensed text-[26px] leading-tight tracking-[-0.03em] sm:text-[30px]">Vendor invoices</h1>
        <p className="mt-1 text-[15px] text-ink-quiet">Check each invoice against its work order and the approved proof. Verified invoices are ready for payment.</p>
      </div>
      <nav aria-label="Filter invoices" className="flex w-fit max-w-full flex-wrap self-start gap-1 rounded-full border border-line bg-ground p-1 text-[13.5px] font-medium">
        {STATES.map((s) => (
          <Link key={s.key} href={`/invoices?state=${s.key}`} aria-current={s.key === state ? "page" : undefined} className={`flex min-h-9 items-center rounded-full px-3.5 no-underline transition ${s.key === state ? "bg-white text-ink shadow-[var(--shadow-card)]" : "text-ink-quiet hover:text-ink"}`}>
            {s.label}
          </Link>
        ))}
      </nav>
      {invoices.length === 0 ? (
        <Panel>
          <EmptyState title={state === "SUBMITTED" ? "Nothing to check" : "No invoices here"}>Invoices vendors send from their phones appear here, and you get a notification.</EmptyState>
        </Panel>
      ) : (
        <Panel title={`Invoices · ${invoices.length}`}>
          <ul>
            {invoices.map((inv) => {
              const over = inv.workOrder && inv.workOrder.invoiced !== null && inv.workOrder.invoiced > inv.workOrder.amount + 0.5;
              const noProof = needsProof && inv.job && inv.job.approvedProof === 0;
              return (
                <li key={inv.id} className="grid grid-cols-1 gap-3 border-b border-rule-soft px-3.5 py-3.5 last:border-b-0 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto] lg:items-start">
                  <span className="flex flex-col gap-0.5 leading-tight">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-bold">{inv.vendor}</span>
                      <Tag tone={TONE[inv.status] ?? "outline"}>{inv.status.replace("_", " ")}</Tag>
                    </span>
                    <span className="font-mono text-[12.5px]">
                      {inv.number} · {formatCalendarDate(inv.date, { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                    <span className="text-[12.5px] text-ink-quiet">
                      {inv.event ? (
                        <Link href={`/bookings/${inv.event.id}?tab=vendors`}>{inv.event.name}</Link>
                      ) : (
                        "No booking"
                      )}
                      {inv.job ? ` · ${inv.job.scope}` : ""}
                      {inv.vendorGstin ? ` · GSTIN ${inv.vendorGstin}` : " · no GSTIN on file"}
                    </span>
                    <span className="text-[12px] text-ink-quiet">Sent {formatDate(inv.createdAt, { day: "numeric", month: "short" })}</span>
                    {inv.note && <span className="text-[12.5px] font-semibold text-now">{inv.note}</span>}
                  </span>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-[13px]">
                    <dt className="text-ink-quiet">Before GST</dt>
                    <dd className="text-right font-mono">{formatINR(inv.taxable, { decimals: true })}</dd>
                    <dt className="text-ink-quiet">GST</dt>
                    <dd className="text-right font-mono">{formatINR(inv.gst, { decimals: true })}</dd>
                    <dt className="font-semibold">Total</dt>
                    <dd className="text-right font-mono text-[15px] font-bold">{formatINR(inv.total, { decimals: true })}</dd>
                  </dl>
                  <span className="flex flex-col gap-0.5 text-[13px]">
                    {inv.workOrder && (
                      <span>
                        <span className="font-mono font-semibold">{inv.workOrder.number}</span> · {formatINR(inv.workOrder.amount)}
                        <span className={`block text-[12.5px] ${over ? "font-semibold text-now" : "text-ink-quiet"}`}>Invoiced so far {formatINR(inv.workOrder.invoiced)}</span>
                      </span>
                    )}
                    {inv.job && (
                      <Link href={`/bookings/${inv.event?.id}?tab=proof`} className={`text-[12.5px] font-semibold ${inv.job.approvedProof ? "text-ok-text" : "text-now"}`}>
                        {inv.job.approvedProof ? `${inv.job.approvedProof} approved proof` : "No approved proof yet"}
                      </Link>
                    )}
                    {inv.file?.originalUrl && (
                      <a href={inv.file.originalUrl} target="_blank" rel="noopener" className="text-[12.5px] font-semibold">
                        Open the invoice ({inv.file.kind === "pdf" ? "PDF" : "photo"})
                      </a>
                    )}
                  </span>
                  {["SUBMITTED", "VERIFIED", "DISPUTED"].includes(inv.status) && (
                    <InvoiceReview id={inv.id} status={inv.status} warning={noProof ? "No approved photo or video of this work yet. Payment will need it." : null} />
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </div>
  );
}
