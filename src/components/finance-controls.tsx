"use client";

/** Small inline forms for money: prepare, mark paid, void, receipts, charges, crew extras. */
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { addChargeAction, markPaidAction, preparePaymentAction, recordReceiptAction, removeChargeAction, reopenBookingAction, requestAdjustmentAction, settleBookingAction, voidPaymentAction } from "@/app/actions/finance";
import { Button, Field, SelectField } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";

const METHODS = [
  { value: "BANK", label: "Bank transfer" },
  { value: "UPI", label: "UPI" },
  { value: "CASH", label: "Cash" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "CARD", label: "Card" },
];
const inr = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);

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

function Inline({ label, children, variant = "secondary" }: { label: string; children: (close: () => void) => ReactNode; variant?: "secondary" | "ghost" | "look" | "primary" }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button type="button" variant={variant} className="min-h-9 px-3 text-[11.5px]" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  return <div className="flex w-full min-w-[260px] flex-col gap-2 rounded-[3px] border-2 border-ink bg-paper p-2.5 text-left">{children(() => setOpen(false))}</div>;
}

function Outcome({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return result.ok ? <span className="text-[12.5px] font-semibold text-ok-text">{result.message}</span> : <span role="alert" className="text-[12.5px] font-semibold text-now">{result.error}</span>;
}

export function PreparePayment({ kind, id, left, label = "Prepare payment" }: { kind: "VENDOR_INVOICE" | "CREW"; id: string; left: number; label?: string }) {
  const { result, pending, run, fe } = useRun();
  const [amount, setAmount] = useState(String(left));
  const [method, setMethod] = useState(kind === "CREW" ? "UPI" : "BANK");
  const [note, setNote] = useState("");
  if (result?.ok) return <Outcome result={result} />;
  const send = (close: () => void) =>
    run(() => preparePaymentAction(kind === "CREW" ? { kind, assignmentId: id, amount, method: method as "UPI", note } : { kind, invoiceId: id, amount, method: method as "BANK", note }), close);
  return (
    <Inline label={label} variant="look">
      {(close) => (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Amount ₹" name={`pa-${id}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={fe.amount} hint={`Up to ${inr(left)}`} />
            <SelectField label="How" name={`pm-${id}`} value={method} onChange={(e) => setMethod(e.target.value)} options={METHODS} />
          </div>
          <Field label="Note (optional)" name={`pn-${id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === "CREW" ? "Pay for the event" : "Advance / balance"} />
          <span className="flex gap-1.5">
            <Button type="button" className="min-h-10 px-3 text-[11.5px]" disabled={pending} onClick={() => send(close)}>
              {pending ? "Sending…" : "Send for approval"}
            </Button>
            <Button type="button" variant="secondary" className="min-h-10 px-3 text-[11.5px]" onClick={close}>
              Cancel
            </Button>
          </span>
          <Outcome result={result} />
        </>
      )}
    </Inline>
  );
}

export function MarkPaid({ paymentId, method, today }: { paymentId: string; method: string; today: string }) {
  const { result, pending, run, fe } = useRun();
  const [m, setM] = useState(method);
  const [ref, setRef] = useState("");
  const [on, setOn] = useState(today);
  if (result?.ok) return <Outcome result={result} />;
  return (
    <Inline label="Mark paid" variant="primary">
      {(close) => (
        <>
          <div className="grid grid-cols-2 gap-2">
            <SelectField label="How" name={`pm-${paymentId}`} value={m} onChange={(e) => setM(e.target.value)} options={METHODS} />
            <Field label="Paid on" name={`pd-${paymentId}`} type="date" max={today} value={on} onChange={(e) => setOn(e.target.value)} error={fe.paidOn} />
          </div>
          {m !== "CASH" && <Field label="UTR / UPI / cheque no." name={`pr-${paymentId}`} value={ref} onChange={(e) => setRef(e.target.value)} error={fe.reference} />}
          <span className="flex gap-1.5">
            <Button type="button" className="min-h-10 px-3 text-[11.5px]" disabled={pending} onClick={() => run(() => markPaidAction(paymentId, { method: m as "BANK", reference: ref || undefined, paidOn: on }), close)}>
              {pending ? "Saving…" : "Paid"}
            </Button>
            <Button type="button" variant="secondary" className="min-h-10 px-3 text-[11.5px]" onClick={close}>
              Cancel
            </Button>
          </span>
          <Outcome result={result} />
        </>
      )}
    </Inline>
  );
}

export function VoidPayment({ paymentId }: { paymentId: string }) {
  const { result, pending, run } = useRun();
  const [reason, setReason] = useState("");
  if (result?.ok) return <Outcome result={result} />;
  return (
    <Inline label="Void" variant="ghost">
      {(close) => (
        <>
          <Field label="Why is it void?" name={`v-${paymentId}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Paid to the wrong account" />
          <span className="flex gap-1.5">
            <Button type="button" variant="danger" className="min-h-10 px-3 text-[11.5px]" disabled={pending || !reason.trim()} onClick={() => run(() => voidPaymentAction(paymentId, reason), close)}>
              Void payment
            </Button>
            <Button type="button" variant="secondary" className="min-h-10 px-3 text-[11.5px]" onClick={close}>
              Keep
            </Button>
          </span>
          <Outcome result={result} />
        </>
      )}
    </Inline>
  );
}

export function ReceiptForm({ eventId, today }: { eventId: string; today: string }) {
  const { result, pending, run, fe } = useRun();
  return (
    <Inline label="+ Record a payment received">
      {(close) => (
        <form
          noValidate
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const get = (k: string) => String(f.get(k) ?? "");
            run(() => recordReceiptAction({ eventId, amount: get("amount"), tdsAmount: get("tdsAmount"), method: get("method") as "BANK", reference: get("reference"), paidOn: get("paidOn"), note: get("note") }), close);
          }}
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Field label="Amount ₹" name="amount" inputMode="decimal" error={fe.amount} />
            <SelectField label="How" name="method" defaultValue="BANK" options={METHODS} />
            <Field label="Received on" name="paidOn" type="date" max={today} defaultValue={today} error={fe.paidOn} />
            <Field label="Reference" name="reference" placeholder="UTR / cheque" />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <Field label="TDS deducted ₹ (if any)" name="tdsAmount" inputMode="decimal" error={fe.tdsAmount} hint="Tax the client kept back; it counts as paid." />
            <Field label="Note (optional)" name="note" placeholder="Second instalment" />
          </div>
          <span className="flex gap-1.5">
            <Button type="submit" className="min-h-10 px-3 text-[11.5px]" disabled={pending}>
              {pending ? "Saving…" : "Record"}
            </Button>
            <Button type="button" variant="secondary" className="min-h-10 px-3 text-[11.5px]" onClick={close}>
              Cancel
            </Button>
          </span>
          <Outcome result={result} />
        </form>
      )}
    </Inline>
  );
}

export function ChargeForm({ eventId }: { eventId: string }) {
  const { result, pending, run, fe } = useRun();
  return (
    <Inline label="+ Add a charge">
      {(close) => (
        <form
          noValidate
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const get = (k: string) => String(f.get(k) ?? "");
            run(() => addChargeAction({ eventId, description: get("description"), amount: get("amount"), gstRate: get("gstRate") }), close);
          }}
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,2fr)_1fr_100px]">
            <Field label="What the client is charged for" name="description" placeholder="Wedding package: five functions" error={fe.description} />
            <Field label="Amount before GST ₹" name="amount" inputMode="decimal" error={fe.amount} />
            <SelectField label="GST" name="gstRate" defaultValue="18" options={[0, 5, 12, 18, 28].map((r) => ({ value: String(r), label: `${r}%` }))} />
          </div>
          <span className="flex gap-1.5">
            <Button type="submit" className="min-h-10 px-3 text-[11.5px]" disabled={pending}>
              {pending ? "Saving…" : "Add charge"}
            </Button>
            <Button type="button" variant="secondary" className="min-h-10 px-3 text-[11.5px]" onClick={close}>
              Cancel
            </Button>
          </span>
          <Outcome result={result} />
        </form>
      )}
    </Inline>
  );
}

export function RemoveCharge({ id }: { id: string }) {
  const { pending, run, result } = useRun();
  return (
    <span className="flex flex-col items-end">
      <Button type="button" variant="ghost" className="min-h-9 px-2 text-[11.5px]" disabled={pending} onClick={() => run(() => removeChargeAction(id))}>
        Remove
      </Button>
      {result && !result.ok && <Outcome result={result} />}
    </span>
  );
}

export function AdjustmentForm({ assignmentId, name }: { assignmentId: string; name: string }) {
  const { result, pending, run, fe } = useRun();
  if (result?.ok) return <Outcome result={result} />;
  return (
    <Inline label="Extra / deduction" variant="ghost">
      {(close) => (
        <form
          noValidate
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(() => requestAdjustmentAction({ assignmentId, type: String(f.get("type")) as "EXTRA", amount: String(f.get("amount") ?? ""), reason: String(f.get("reason") ?? "") }), close);
          }}
        >
          <span className="label-mono text-[11.5px]">{name}</span>
          <div className="grid grid-cols-2 gap-2">
            <SelectField label="Kind" name="type" defaultValue="EXTRA" options={[{ value: "EXTRA", label: "Extra (add)" }, { value: "DEDUCTION", label: "Deduction" }]} />
            <Field label="Amount ₹" name="amount" inputMode="numeric" error={fe.amount} />
          </div>
          <Field label="Why" name="reason" placeholder="Late night after the Sangeet" error={fe.reason} />
          <span className="flex gap-1.5">
            <Button type="submit" className="min-h-10 px-3 text-[11.5px]" disabled={pending}>
              {pending ? "Sending…" : "Ask the hosts"}
            </Button>
            <Button type="button" variant="secondary" className="min-h-10 px-3 text-[11.5px]" onClick={close}>
              Cancel
            </Button>
          </span>
          <Outcome result={result} />
        </form>
      )}
    </Inline>
  );
}

/** An owner settles a booking once its checklist is clear; it then locks. */
export function SettleBooking({ eventId, ready }: { eventId: string; ready: boolean }) {
  const { result, pending, run } = useRun();
  const [note, setNote] = useState("");
  if (result?.ok) return <Outcome result={result} />;
  if (!ready)
    return (
      <Button type="button" className="min-h-11 px-4 text-[12px]" disabled title="Clear the checklist first">
        Settle booking
      </Button>
    );
  return (
    <Inline label="Settle booking" variant="primary">
      {(close) => (
        <>
          <p className="text-[13.5px]">Settling makes this booking&apos;s figures final and locks its money: no new charges, payments, expenses, crew extras or vendor jobs. A host can reopen it with a reason.</p>
          <Field label="Note (optional)" name={`settle-${eventId}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="All paid, books closed" />
          <span className="flex gap-1.5">
            <Button type="button" className="min-h-10 px-3 text-[11.5px]" disabled={pending} onClick={() => run(() => settleBookingAction(eventId, note), close)}>
              {pending ? "Settling…" : "Settle and lock"}
            </Button>
            <Button type="button" variant="secondary" className="min-h-10 px-3 text-[11.5px]" onClick={close}>
              Not yet
            </Button>
          </span>
          <Outcome result={result} />
        </>
      )}
    </Inline>
  );
}

export function ReopenBooking({ eventId }: { eventId: string }) {
  const { result, pending, run, fe } = useRun();
  const [reason, setReason] = useState("");
  if (result?.ok) return <Outcome result={result} />;
  return (
    <Inline label="Reopen" variant="ghost">
      {(close) => (
        <>
          <Field label="Why reopen it?" name={`reopen-${eventId}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Vendor sent a corrected invoice" error={fe.reason} />
          <span className="flex gap-1.5">
            <Button type="button" variant="danger" className="min-h-10 px-3 text-[11.5px]" disabled={pending || reason.trim().length < 5} onClick={() => run(() => reopenBookingAction(eventId, reason), close)}>
              Reopen booking
            </Button>
            <Button type="button" variant="secondary" className="min-h-10 px-3 text-[11.5px]" onClick={close}>
              Keep settled
            </Button>
          </span>
          <Outcome result={result} />
        </>
      )}
    </Inline>
  );
}
