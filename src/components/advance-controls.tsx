"use client";

/** Cash advances (D57): give one, hand it over, close it, void it. */
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { closeAdvanceAction, giveAdvanceAction, markAdvanceGivenAction, voidAdvanceAction } from "@/app/actions/advances";
import { Button, Field, Notice, SelectField } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";

const METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "BANK", label: "Bank transfer" },
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

function Outcome({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return result.ok ? <span className="text-[12.5px] font-semibold text-ok-text">{result.message}</span> : <span role="alert" className="text-[12.5px] font-semibold text-now">{result.error}</span>;
}

function Inline({ label, children, variant = "secondary" }: { label: string; children: (close: () => void) => ReactNode; variant?: "secondary" | "ghost" | "look" | "primary" }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button type="button" variant={variant} className="min-h-10 px-3.5 text-[12.5px]" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  return <div className="flex w-full min-w-[260px] flex-col gap-2 rounded-2xl border border-line bg-paper p-3 text-left">{children(() => setOpen(false))}</div>;
}

export function GiveAdvanceForm({ holders, bookings, isHost, today }: { holders: { id: string; name: string }[]; bookings: { id: string; name: string }[]; isHost: boolean; today: string }) {
  const { result, pending, run, fe } = useRun();
  const [open, setOpen] = useState(false);
  const [handedOver, setHandedOver] = useState(isHost);
  const [method, setMethod] = useState("CASH");
  if (!open)
    return (
      <div className="flex flex-col gap-2">
        {result?.ok && <Notice tone="ok">{result.message}</Notice>}
        <Button type="button" className="self-start" onClick={() => setOpen(true)}>
          + Give a cash advance
        </Button>
      </div>
    );
  return (
    <form
      noValidate
      aria-label="Give a cash advance"
      className="flex flex-col gap-3 rounded-2xl border border-line bg-paper p-3.5 shadow-[var(--shadow-card)]"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const get = (k: string) => String(f.get(k) ?? "");
        run(
          () => giveAdvanceAction({ holderId: get("holderId"), eventId: get("eventId"), amount: get("amount"), purpose: get("purpose"), method: method as "CASH", handedOver, givenOn: get("givenOn") || undefined, reference: get("reference") || undefined }),
          () => setOpen(false),
        );
      }}
    >
      <h3 className="label-mono text-[12.5px]">Give a cash advance</h3>
      {result && !result.ok && <Notice tone="error">{result.error}</Notice>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <SelectField label="Who carries it" name="holderId" error={fe.holderId} options={[{ value: "", label: "Pick a manager or supervisor…" }, ...holders.map((h) => ({ value: h.id, label: h.name }))]} />
        <SelectField label="For a booking (optional)" name="eventId" error={fe.eventId} options={[{ value: "", label: "Not for one booking" }, ...bookings.map((b) => ({ value: b.id, label: b.name }))]} />
        <Field label="Amount ₹" name="amount" inputMode="decimal" error={fe.amount} />
        <Field className="sm:col-span-2" label="What it is for" name="purpose" placeholder="Flowers, tea and autos on the wedding day" error={fe.purpose} />
        <SelectField label="Handed over as" name="method" value={method} onChange={(e) => setMethod(e.target.value)} options={METHODS} />
      </div>
      {isHost ? (
        <label className="flex min-h-11 items-center gap-2.5 text-[14px]">
          <input type="checkbox" className="size-5 accent-[#7c3aed]" checked={handedOver} onChange={(e) => setHandedOver(e.target.checked)} />
          The cash is handed over now
        </label>
      ) : (
        <p className="text-[13px] text-ink-quiet">A host approves it before the cash is handed over.</p>
      )}
      {handedOver && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Handed over on" name="givenOn" type="date" max={today} defaultValue={today} error={fe.givenOn} />
          {method !== "CASH" && <Field label="UPI / bank reference" name="reference" error={fe.reference} />}
        </div>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : isHost ? (handedOver ? "Give the advance" : "Approve the advance") : "Send for approval"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function HandOverAdvance({ id, today }: { id: string; today: string }) {
  const { result, pending, run, fe } = useRun();
  const [method, setMethod] = useState<"CASH" | "UPI" | "BANK">("CASH");
  const [ref, setRef] = useState("");
  const [on, setOn] = useState(today);
  if (result?.ok) return <Outcome result={result} />;
  return (
    <Inline label="Mark handed over" variant="primary">
      {(close) => (
        <>
          <div className="grid grid-cols-2 gap-2">
            <SelectField label="How" name={`hm-${id}`} value={method} onChange={(e) => setMethod(e.target.value as "CASH")} options={METHODS} />
            <Field label="On" name={`hd-${id}`} type="date" max={today} value={on} onChange={(e) => setOn(e.target.value)} error={fe.givenOn} />
          </div>
          {method !== "CASH" && <Field label="Reference" name={`hr-${id}`} value={ref} onChange={(e) => setRef(e.target.value)} error={fe.reference} />}
          <span className="flex gap-1.5">
            <Button type="button" className="min-h-10 px-3 text-[12px]" disabled={pending} onClick={() => run(() => markAdvanceGivenAction(id, { method, reference: ref || undefined, givenOn: on }), close)}>
              {pending ? "Saving…" : "Handed over"}
            </Button>
            <Button type="button" variant="secondary" className="min-h-10 px-3 text-[12px]" onClick={close}>
              Cancel
            </Button>
          </span>
          <Outcome result={result} />
        </>
      )}
    </Inline>
  );
}

export function CloseAdvance({ id, left, isHost }: { id: string; left: number; isHost: boolean }) {
  const { result, pending, run, fe } = useRun();
  const [returned, setReturned] = useState(String(left));
  const [note, setNote] = useState("");
  if (result?.ok) return <Outcome result={result} />;
  const short = Math.round((left - (Number(returned) || 0)) * 100) / 100;
  return (
    <Inline label="Close" variant="look">
      {(close) => (
        <>
          <Field label="Cash returned ₹" name={`cr-${id}`} inputMode="decimal" value={returned} onChange={(e) => setReturned(e.target.value)} error={fe.returned} hint={`${inr(left)} is left`} />
          {short > 0.5 && (isHost ? <Field label="How the missing cash is settled" name={`cn-${id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Taken from next month's pay" error={fe.note} /> : <span className="text-[12.5px] font-semibold text-now">{inr(short)} missing: a host settles a shortfall.</span>)}
          <span className="flex gap-1.5">
            <Button type="button" className="min-h-10 px-3 text-[12px]" disabled={pending} onClick={() => run(() => closeAdvanceAction(id, { returned, note: note || undefined }), close)}>
              {pending ? "Saving…" : "Close the advance"}
            </Button>
            <Button type="button" variant="secondary" className="min-h-10 px-3 text-[12px]" onClick={close}>
              Cancel
            </Button>
          </span>
          <Outcome result={result} />
        </>
      )}
    </Inline>
  );
}

export function VoidAdvance({ id }: { id: string }) {
  const { result, pending, run } = useRun();
  const [reason, setReason] = useState("");
  if (result?.ok) return <Outcome result={result} />;
  return (
    <Inline label="Void" variant="ghost">
      {(close) => (
        <>
          <Field label="Why is it void?" name={`va-${id}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Given to the wrong person" />
          <span className="flex gap-1.5">
            <Button type="button" variant="danger" className="min-h-10 px-3 text-[12px]" disabled={pending || !reason.trim()} onClick={() => run(() => voidAdvanceAction(id, reason), close)}>
              Void advance
            </Button>
            <Button type="button" variant="secondary" className="min-h-10 px-3 text-[12px]" onClick={close}>
              Keep
            </Button>
          </span>
          <Outcome result={result} />
        </>
      )}
    </Inline>
  );
}
