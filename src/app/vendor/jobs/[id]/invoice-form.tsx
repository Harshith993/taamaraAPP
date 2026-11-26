"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { submitInvoiceAction } from "@/app/actions/invoices";
import { DocumentUpload } from "@/components/document-upload";
import { Button, Field, Notice } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";

const inr = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);

/** The vendor's invoice: their number and date, amount before GST, GST, and the invoice file. */
export function InvoiceForm({ jobId, left, defaultGstRate, today }: { jobId: string; left: number; defaultGstRate: number; today: string }) {
  const router = useRouter();
  const [taxable, setTaxable] = useState("");
  const [rate, setRate] = useState(String(defaultGstRate));
  const [gst, setGst] = useState("");
  const [fileId, setFileId] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const fe = result && !result.ok ? (result.fieldErrors ?? {}) : {};
  const t = Number(taxable) || 0;
  const g = gst === "" ? Math.round(t * Number(rate)) / 100 : Number(gst) || 0;
  const total = Math.round((t + g) * 100) / 100;

  if (result?.ok) return <Notice tone="ok">{result.message}</Notice>;
  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        start(async () => {
          const r = await submitInvoiceAction(jobId, {
            invoiceNumber: String(f.get("invoiceNumber") ?? ""),
            invoiceDate: String(f.get("invoiceDate") ?? ""),
            taxableAmount: taxable,
            gstAmount: g,
            fileId: fileId ?? "",
          });
          setResult(r);
          if (r.ok) router.refresh();
        });
      }}
    >
      {result && !result.ok && <Notice tone="error">{result.error}</Notice>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Your invoice number" name="invoiceNumber" placeholder="RL/2026/041" error={fe.invoiceNumber} />
        <Field label="Invoice date" name="invoiceDate" type="date" defaultValue={today} max={today} error={fe.invoiceDate} />
        <Field label="Amount before GST ₹" name="taxable" inputMode="decimal" value={taxable} onChange={(e) => setTaxable(e.target.value)} error={fe.taxableAmount} hint={`Up to ${inr(left)} left on the work order, with GST`} />
        <div className="flex flex-col gap-1">
          <label htmlFor="inv-gst" className="text-[13px] font-medium text-ink">
            GST
          </label>
          <span className="grid grid-cols-[84px_minmax(0,1fr)] gap-2">
            <select aria-label="GST rate" value={rate} onChange={(e) => (setRate(e.target.value), setGst(""))} className="min-h-11 rounded-xl border border-line bg-paper px-2 text-[15px]">
              {[0, 5, 12, 18, 28].map((r) => (
                <option key={r} value={r}>
                  {r}%
                </option>
              ))}
            </select>
            <input id="inv-gst" inputMode="decimal" value={gst === "" ? (t ? String(g) : "") : gst} onChange={(e) => setGst(e.target.value)} className="min-h-11 rounded-xl border border-line bg-paper px-3 text-[15px]" aria-invalid={fe.gstAmount ? true : undefined} />
          </span>
          {fe.gstAmount && <span className="text-[13px] font-semibold text-now">{fe.gstAmount}</span>}
        </div>
      </div>
      <DocumentUpload label="The invoice (PDF or a clear photo)" onChange={setFileId} error={fe.fileId} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <span className="text-[14px]">
          Total <strong className="font-mono text-[18px]">{inr(total)}</strong>
        </span>
        <Button type="submit" className="min-h-12 px-6" disabled={pending || !fileId}>
          {pending ? "Sending…" : "Send invoice"}
        </Button>
      </div>
    </form>
  );
}
