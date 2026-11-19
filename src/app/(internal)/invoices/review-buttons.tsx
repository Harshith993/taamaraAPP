"use client";

import { useState, useTransition } from "react";
import { reviewInvoiceAction } from "@/app/actions/invoices";
import { Button } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";

export function InvoiceReview({ id, status, warning }: { id: string; status: string; warning?: string | null }) {
  const [mode, setMode] = useState<"DISPUTE" | "VOID" | null>(null);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const decide = (d: "VERIFY" | "DISPUTE" | "VOID") => start(async () => setResult(await reviewInvoiceAction(id, d, note)));
  if (result?.ok) return <p className="text-[13.5px] font-semibold text-ok-text">{result.message}</p>;
  const canVerify = status === "SUBMITTED" || status === "DISPUTED";
  const canDispute = status === "SUBMITTED" || status === "VERIFIED";
  return (
    <div className="flex flex-col gap-1.5">
      {warning && canVerify && <p className="text-[12.5px] font-semibold text-now">{warning}</p>}
      {mode && (
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === "DISPUTE" ? "GST number missing on the invoice" : "Entered twice by mistake"} aria-label={mode === "DISPUTE" ? "What should the vendor correct?" : "Why is it void?"} className="rounded-xl border border-line bg-paper px-2 py-1.5 text-[13.5px]" />
      )}
      <span className="flex flex-wrap gap-1.5">
        {mode ? (
          <>
            <Button type="button" variant="danger" className="min-h-10 px-3 text-[11.5px]" disabled={pending || !note.trim()} onClick={() => decide(mode)}>
              {mode === "DISPUTE" ? "Send back" : "Void invoice"}
            </Button>
            <Button type="button" variant="secondary" className="min-h-10 px-3 text-[11.5px]" disabled={pending} onClick={() => setMode(null)}>
              Back
            </Button>
          </>
        ) : (
          <>
            {canVerify && (
              <Button type="button" className="min-h-10 px-3 text-[11.5px]" disabled={pending} onClick={() => decide("VERIFY")}>
                {pending ? "Saving…" : "Verified"}
              </Button>
            )}
            {canDispute && (
              <Button type="button" variant="secondary" className="min-h-10 px-3 text-[11.5px]" disabled={pending} onClick={() => setMode("DISPUTE")}>
                Ask to correct
              </Button>
            )}
            <Button type="button" variant="ghost" className="min-h-10 px-2 text-[11.5px]" disabled={pending} onClick={() => setMode("VOID")}>
              Void
            </Button>
          </>
        )}
      </span>
      {result && !result.ok && (
        <p role="alert" className="text-[12.5px] font-semibold text-now">
          {result.error}
        </p>
      )}
    </div>
  );
}
