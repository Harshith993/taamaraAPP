"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { markRepaidAction, submitExpenseAction } from "@/app/actions/expenses";
import { DocumentUpload } from "@/components/document-upload";
import { Button, Field, Notice, SelectField } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";

export function ExpenseForm({ bookings, categories, allowNoBooking, today, threshold }: { bookings: { id: string; name: string }[]; categories: { id: string; name: string }[]; allowNoBooking: boolean; today: string; threshold: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fileId, setFileId] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const fe = result && !result.ok ? (result.fieldErrors ?? {}) : {};
  if (!open)
    return (
      <div className="flex flex-col gap-2">
        {result?.ok && <Notice tone="ok">{result.message}</Notice>}
        <Button type="button" className="self-start" onClick={() => (setOpen(true), setResult(null))}>
          + Record an expense
        </Button>
      </div>
    );
  return (
    <form
      noValidate
      className="flex flex-col gap-3 rounded-[4px] border-2 border-ink bg-paper p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const get = (k: string) => String(f.get(k) ?? "");
        start(async () => {
          const r = await submitExpenseAction({ eventId: get("eventId"), categoryId: get("categoryId"), description: get("description"), amount: get("amount"), spentOn: get("spentOn"), paidVia: get("paidVia") as "OWN_POCKET", receiptFileId: fileId ?? "" });
          setResult(r);
          if (r.ok) {
            setOpen(false);
            setFileId(null);
            router.refresh();
          }
        });
      }}
    >
      <h3 className="label-mono text-[12.5px]">Record an expense</h3>
      {result && !result.ok && <Notice tone="error">{result.error}</Notice>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <SelectField label="Booking" name="eventId" error={fe.eventId} options={[...(allowNoBooking ? [{ value: "", label: "Company (no booking)" }] : [{ value: "", label: "Pick a booking…" }]), ...bookings.map((b) => ({ value: b.id, label: b.name }))]} />
        <SelectField label="For" name="categoryId" error={fe.categoryId} options={[{ value: "", label: "Pick…" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]} />
        <Field label="Amount ₹" name="amount" inputMode="decimal" error={fe.amount} />
        <Field className="sm:col-span-2" label="What was bought" name="description" placeholder="Tea and snacks for the crew" error={fe.description} />
        <Field label="Date" name="spentOn" type="date" max={today} defaultValue={today} error={fe.spentOn} />
        <SelectField
          label="Paid by"
          name="paidVia"
          defaultValue="OWN_POCKET"
          options={[
            { value: "OWN_POCKET", label: "Me, please repay" },
            { value: "COMPANY", label: "The company (card, account)" },
          ]}
        />
      </div>
      <DocumentUpload label={`Bill or receipt (needed above ₹${threshold})`} onChange={setFileId} error={fe.receiptFileId} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send for approval"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function RepayButton({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<"CASH" | "UPI" | "BANK">("UPI");
  const [ref, setRef] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  if (result?.ok) return <span className="text-[12.5px] font-semibold text-ok-text">{result.message}</span>;
  if (!open)
    return (
      <Button type="button" variant="look" className="min-h-9 px-3 text-[11.5px]" onClick={() => setOpen(true)}>
        Repay
      </Button>
    );
  return (
    <span className="flex min-w-[220px] flex-col gap-1.5">
      <SelectField label="How" name={`rm-${id}`} value={method} onChange={(e) => setMethod(e.target.value as "UPI")} options={[{ value: "UPI", label: "UPI" }, { value: "CASH", label: "Cash" }, { value: "BANK", label: "Bank" }]} />
      {method !== "CASH" && <Field label="Reference" name={`rr-${id}`} value={ref} onChange={(e) => setRef(e.target.value)} />}
      <span className="flex gap-1.5">
        <Button type="button" className="min-h-9 px-3 text-[11.5px]" disabled={pending} onClick={() => start(async () => {
          const r = await markRepaidAction(id, method, ref);
          setResult(r);
          if (r.ok) router.refresh();
        })}>
          {pending ? "Saving…" : "Repaid"}
        </Button>
        <Button type="button" variant="secondary" className="min-h-9 px-3 text-[11.5px]" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </span>
      {result && !result.ok && <span className="text-[12.5px] font-semibold text-now">{result.error}</span>}
    </span>
  );
}
