import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { formatCalendarDate } from "@/lib/format";
import { invoiceForPrint } from "@/modules/finance/client-invoices";
import { requirePermission } from "@/modules/identity/session";

export const metadata: Metadata = { title: "Client invoice" };

const money = (n: number) => new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const day = (d: Date | null) => (d ? formatCalendarDate(d, { day: "2-digit", month: "short", year: "numeric" }) : "—");

export default async function ClientInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission("finance.billing");
  const { id } = await params;
  let inv;
  try {
    inv = await invoiceForPrint(db, actor, id);
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
  const s = inv.supplier;
  const r = inv.recipient;
  const title = inv.status === "DRAFT" ? "Draft · not a tax invoice" : "Tax invoice";
  const cols = inv.intraState ? ["CGST", "SGST"] : ["IGST"];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/bookings/${inv.event.id}?tab=money`} className="group inline-flex w-fit items-center gap-1 text-[13.5px] font-medium text-ink-quiet no-underline hover:text-ink">
          ← {inv.event.name}
        </Link>
        <PrintButton />
      </div>

      <article aria-label={title} className="relative mx-auto w-full max-w-[860px] border border-line bg-white p-6 text-[13px] text-black sm:p-8 print:max-w-none print:border-0 print:p-0">
        {inv.status === "CANCELLED" && (
          <p role="status" className="mb-3 rounded-xl border border-[#fecdd3] bg-pastel-rose px-3 py-2 text-[13px] font-bold text-[#be123c]">
            Cancelled{inv.cancelReason ? `: ${inv.cancelReason}` : ""}
          </p>
        )}
        <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-black pb-3">
          <div className="flex flex-col leading-snug">
            <span className="font-condensed text-[26px] leading-none">{inv.tradeName}</span>
            {s.name !== inv.tradeName && <span className="font-semibold">{s.name}</span>}
            <span>{[s.address, s.city].filter(Boolean).join(", ")}</span>
            <span>
              {s.state}
              {s.stateCode ? ` (${s.stateCode})` : ""}
            </span>
            <span className="font-mono">GSTIN {s.gstin ?? "—"}{s.pan ? ` · PAN ${s.pan}` : ""}</span>
            {(s.phone || s.email) && <span>{[s.phone, s.email].filter(Boolean).join(" · ")}</span>}
          </div>
          <div className="flex flex-col items-end gap-0.5 text-right">
            <h1 className="font-condensed text-[24px] leading-none">{title}</h1>
            <span className="font-mono text-[15px] font-bold">{inv.number ?? "Not yet numbered"}</span>
            <span>Date: {day(inv.issueDate)}</span>
            {inv.dueDate && <span>Due: {day(inv.dueDate)}</span>}
            <span>
              Place of supply: {inv.placeName ?? "—"}
              {inv.placeOfSupply ? ` (${inv.placeOfSupply})` : ""}
            </span>
          </div>
        </header>

        <section className="grid gap-4 border-b border-black/30 py-3 sm:grid-cols-2">
          <div className="flex flex-col leading-snug">
            <span className="label-mono text-[11px]">Bill to</span>
            <span className="font-semibold">{r.name}</span>
            <span>{[r.address, r.city].filter(Boolean).join(", ")}</span>
            <span>
              {r.state ?? ""}
              {r.stateCode ? ` (${r.stateCode})` : ""}
            </span>
            <span className="font-mono">{r.gstin ? `GSTIN ${r.gstin}` : "Unregistered"}</span>
          </div>
          <div className="flex flex-col leading-snug sm:text-right">
            <span className="label-mono text-[11px]">For</span>
            <span>
              {inv.event.name} ({inv.event.code})
            </span>
            {inv.event.startDate && <span>{day(inv.event.startDate)}</span>}
            <span>Invoice type: {inv.type.toLowerCase()}</span>
          </div>
        </section>

        <div className="overflow-x-auto">
          <table className="mt-3 w-full min-w-[620px] border-collapse">
            <thead>
              <tr className="border-y-2 border-black text-left text-[11px] uppercase">
                <th scope="col" className="py-1.5 pr-2">#</th>
                <th scope="col" className="py-1.5 pr-2">Description</th>
                <th scope="col" className="py-1.5 pr-2">SAC</th>
                <th scope="col" className="py-1.5 pr-2 text-right">Taxable ₹</th>
                <th scope="col" className="py-1.5 pr-2 text-right">GST</th>
                {cols.map((c) => (
                  <th key={c} scope="col" className="py-1.5 pr-2 text-right">
                    {c} ₹
                  </th>
                ))}
                <th scope="col" className="py-1.5 text-right">Total ₹</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((l, i) => (
                <tr key={i} className="border-b border-black/20 align-top">
                  <td className="py-1.5 pr-2">{i + 1}</td>
                  <td className="py-1.5 pr-2">{l.description}</td>
                  <td className="py-1.5 pr-2 font-mono">{l.sac}</td>
                  <td className="py-1.5 pr-2 text-right font-mono">{money(l.amount)}</td>
                  <td className="py-1.5 pr-2 text-right font-mono">{l.gstRate}%</td>
                  {inv.intraState ? (
                    <>
                      <td className="py-1.5 pr-2 text-right font-mono">{money(l.cgst)}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{money(l.sgst)}</td>
                    </>
                  ) : (
                    <td className="py-1.5 pr-2 text-right font-mono">{money(l.igst)}</td>
                  )}
                  <td className="py-1.5 text-right font-mono">{money(l.amount + l.cgst + l.sgst + l.igst)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-black font-semibold">
                <td colSpan={3} className="py-1.5 pr-2">
                  Total
                </td>
                <td className="py-1.5 pr-2 text-right font-mono">{money(inv.subtotal)}</td>
                <td />
                {inv.intraState ? (
                  <>
                    <td className="py-1.5 pr-2 text-right font-mono">{money(inv.cgst)}</td>
                    <td className="py-1.5 pr-2 text-right font-mono">{money(inv.sgst)}</td>
                  </>
                ) : (
                  <td className="py-1.5 pr-2 text-right font-mono">{money(inv.igst)}</td>
                )}
                <td className="py-1.5 text-right font-mono text-[15px]">₹{money(inv.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <p className="mt-3">
          <span className="label-mono text-[11px]">Amount in words: </span>
          <strong>{inv.inWords}</strong>
        </p>
        {inv.taxByRate.length > 1 && (
          <p className="mt-1 font-mono text-[12px]">
            {inv.taxByRate.map((t) => `${t.rate}%: taxable ${money(t.taxable)}, tax ${money(t.cgst + t.sgst + t.igst)}`).join(" · ")}
          </p>
        )}
        {inv.notes && <p className="mt-2">{inv.notes}</p>}

        <footer className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col leading-snug">
            {inv.bankDetails && (
              <>
                <span className="label-mono text-[11px]">Pay to</span>
                <span className="whitespace-pre-line">{inv.bankDetails}</span>
              </>
            )}
            <span className="mt-2 text-[11.5px]">Tax payable on reverse charge: No.</span>
          </div>
          <div className="flex flex-col items-start leading-snug sm:items-end">
            <span>For {s.name}</span>
            <span className="mt-10 border-t border-black pt-1 text-[12px]">Authorised signatory</span>
          </div>
        </footer>
      </article>
    </div>
  );
}
