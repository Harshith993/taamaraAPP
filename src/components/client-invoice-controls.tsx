"use client";

/** Client GST invoices on a booking's Money tab: bill-to details, drafting, issuing, cancelling. */
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { cancelInvoiceAction, deleteDraftAction, draftInvoiceAction, issueInvoiceAction, updateClientBillingAction } from "@/app/actions/client-invoices";
import { Button, Field, SelectField } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import { GST_STATES } from "@/lib/gst";

const STATES = [{ value: "", label: "Pick…" }, ...Object.entries(GST_STATES).map(([code, name]) => ({ value: code, label: name }))];
const inr = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
const small = "min-h-10 px-3 text-[11.5px]";

function useRun() {
  const router = useRouter();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  return {
    result,
    pending,
    fe: result && !result.ok ? (result.fieldErrors ?? {}) : ({} as Record<string, string>),
    run: (fn: () => Promise<ActionResult>, onOk?: () => void) =>
      start(async () => {
        const r = await fn();
        setResult(r);
        if (r.ok) {
          onOk?.();
          router.refresh();
        }
      }),
  };
}

function Outcome({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return result.ok ? <span className="text-[12.5px] font-semibold text-ok-text">{result.message}</span> : <span role="alert" className="text-[12.5px] font-semibold text-now">{result.error}</span>;
}

function Inline({ label, variant = "secondary", children }: { label: string; variant?: "secondary" | "ghost" | "look" | "primary"; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button type="button" variant={variant} className="min-h-9 px-3 text-[11.5px]" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  return <div className="flex w-full min-w-[260px] flex-col gap-2 rounded-xl border border-line bg-paper p-2.5 text-left">{children(() => setOpen(false))}</div>;
}

export function BillingDetailsForm({ eventId, client }: { eventId: string; client: { gstin: string | null; address: string | null; city: string | null; stateCode: string | null } }) {
  const { result, pending, run, fe } = useRun();
  return (
    <Inline label="Edit billing details">
      {(close) => (
        <form
          noValidate
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const get = (k: string) => String(f.get(k) ?? "");
            run(() => updateClientBillingAction(eventId, { gstin: get("gstin"), address: get("address"), city: get("city"), stateCode: get("stateCode") }), close);
          }}
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label="Client GSTIN (if registered)" name="gstin" defaultValue={client.gstin ?? ""} error={fe.gstin} autoCapitalize="characters" hint="Leave empty for a person or an unregistered business." />
            <SelectField label="State" name="stateCode" defaultValue={client.stateCode ?? ""} options={STATES} error={fe.stateCode} />
            <Field label="Billing address" name="address" defaultValue={client.address ?? ""} className="sm:col-span-2" />
            <Field label="City" name="city" defaultValue={client.city ?? ""} />
          </div>
          <span className="flex gap-1.5">
            <Button type="submit" className={small} disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="secondary" className={small} onClick={close}>
              Cancel
            </Button>
          </span>
          <Outcome result={result} />
        </form>
      )}
    </Inline>
  );
}

export function NewInvoiceForm({ eventId, charges }: { eventId: string; charges: { id: string; description: string; left: number; gstRate: number }[] }) {
  const { result, pending, run } = useRun();
  const [type, setType] = useState("FINAL");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const open = charges.filter((c) => c.left > 0.005);
  if (open.length === 0) return <p className="text-[13px] text-ink-quiet">Every charge is on an invoice. Add a charge to bill more.</p>;
  const lines = Object.entries(picked).map(([chargeId, amount]) => ({ chargeId, amount }));
  return (
    <Inline label="+ New invoice" variant="look">
      {(close) => (
        <>
          <SelectField
            label="Kind of invoice"
            name="invoiceType"
            value={type}
            onChange={(e) => setType(e.target.value)}
            options={[
              { value: "FINAL", label: "Final" },
              { value: "ADVANCE", label: "Advance" },
              { value: "ADDITIONAL", label: "Additional" },
            ]}
          />
          <fieldset className="flex flex-col gap-1.5">
            <legend className="label-mono mb-1 text-[12px]">Charges to bill</legend>
            {open.map((c) => (
              <div key={c.id} className="grid grid-cols-[auto_minmax(0,1fr)_8rem] items-center gap-2">
                <input
                  type="checkbox"
                  id={`ci-${c.id}`}
                  className="h-5 w-5 accent-plum"
                  checked={c.id in picked}
                  onChange={(e) => {
                    const next = { ...picked };
                    if (e.target.checked) next[c.id] = String(c.left);
                    else delete next[c.id];
                    setPicked(next);
                  }}
                />
                <label htmlFor={`ci-${c.id}`} className="text-[14px] leading-tight">
                  {c.description}
                  <span className="block text-[12px] text-ink-quiet">
                    {inr(c.left)} left · GST {c.gstRate}%
                  </span>
                </label>
                <input
                  aria-label={`Amount to bill for ${c.description}`}
                  inputMode="decimal"
                  disabled={!(c.id in picked)}
                  value={picked[c.id] ?? ""}
                  onChange={(e) => setPicked({ ...picked, [c.id]: e.target.value })}
                  className="min-h-10 rounded-xl border border-line bg-paper px-2 text-right font-mono text-[14px] disabled:opacity-40"
                />
              </div>
            ))}
          </fieldset>
          <span className="flex gap-1.5">
            <Button type="button" className={small} disabled={pending || lines.length === 0} onClick={() => run(() => draftInvoiceAction({ eventId, type: type as "FINAL", lines }), () => (close(), setPicked({})))}>
              {pending ? "Saving…" : "Save draft"}
            </Button>
            <Button type="button" variant="secondary" className={small} onClick={close}>
              Cancel
            </Button>
          </span>
          <Outcome result={result} />
        </>
      )}
    </Inline>
  );
}

export function IssueInvoice({ invoiceId, today }: { invoiceId: string; today: string }) {
  const { result, pending, run, fe } = useRun();
  const [date, setDate] = useState(today);
  if (result?.ok) return <Outcome result={result} />;
  return (
    <Inline label="Issue" variant="primary">
      {(close) => (
        <>
          <p className="text-[13px]">Issuing gives the invoice its number. After that it can&apos;t be changed, only cancelled.</p>
          <Field label="Invoice date" name={`issue-${invoiceId}`} type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} error={fe.issueDate} />
          <span className="flex gap-1.5">
            <Button type="button" className={small} disabled={pending} onClick={() => run(() => issueInvoiceAction(invoiceId, date))}>
              {pending ? "Issuing…" : "Issue invoice"}
            </Button>
            <Button type="button" variant="secondary" className={small} onClick={close}>
              Not yet
            </Button>
          </span>
          <Outcome result={result} />
        </>
      )}
    </Inline>
  );
}

export function DeleteDraft({ invoiceId }: { invoiceId: string }) {
  const { result, pending, run } = useRun();
  if (result?.ok) return <Outcome result={result} />;
  return (
    <>
      <Button type="button" variant="ghost" className="min-h-9 px-3 text-[11.5px]" disabled={pending} onClick={() => run(() => deleteDraftAction(invoiceId))}>
        Delete draft
      </Button>
      <Outcome result={result} />
    </>
  );
}

export function CancelInvoice({ invoiceId }: { invoiceId: string }) {
  const { result, pending, run, fe } = useRun();
  const [reason, setReason] = useState("");
  if (result?.ok) return <Outcome result={result} />;
  return (
    <Inline label="Cancel" variant="ghost">
      {(close) => (
        <>
          <p className="text-[13px]">Cancel only if it hasn&apos;t been filed in GSTR-1 yet. Once filed, the accountant raises a credit note instead.</p>
          <Field label="Why cancel it?" name={`cancel-${invoiceId}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Wrong client name" error={fe.reason} />
          <span className="flex gap-1.5">
            <Button type="button" variant="danger" className={small} disabled={pending || reason.trim().length < 5} onClick={() => run(() => cancelInvoiceAction(invoiceId, reason), close)}>
              Cancel invoice
            </Button>
            <Button type="button" variant="secondary" className={small} onClick={close}>
              Keep it
            </Button>
          </span>
          <Outcome result={result} />
        </>
      )}
    </Inline>
  );
}
