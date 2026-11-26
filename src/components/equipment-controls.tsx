"use client";

/** Equipment (D58): add or edit an item, book it out to a booking, check it out and back in. */
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { bookEquipmentAction, cancelEquipmentBookingAction, checkInEquipmentAction, checkOutEquipmentAction, resolveEquipmentIssueAction, saveEquipmentItemAction } from "@/app/actions/equipment";
import { DocumentUpload } from "@/components/document-upload";
import { Button, Field, Notice, SelectField } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";

const CATEGORIES = [
  { value: "DECOR", label: "Decor" },
  { value: "FURNITURE", label: "Furniture" },
  { value: "LIGHTING", label: "Lights" },
  { value: "SOUND", label: "Sound" },
  { value: "OTHER", label: "Other" },
];
const CONDITIONS = [
  { value: "GOOD", label: "Good" },
  { value: "WORN", label: "Worn" },
  { value: "NEEDS_REPAIR", label: "Needs repair" },
  { value: "RETIRED", label: "Retired (no longer used)" },
];

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

export interface ItemValues {
  id: string;
  name: string;
  category: string | null;
  quantity: number;
  condition: string;
  location: string | null;
  notes: string | null;
  photoFileId: string | null;
}

export function ItemForm({ item, label }: { item?: ItemValues; label?: string }) {
  const { result, pending, run, fe } = useRun();
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState<string | null>(item?.photoFileId ?? null);
  if (!open)
    return (
      <div className="flex flex-col gap-2">
        {result?.ok && !item && <Notice tone="ok">{result.message}</Notice>}
        <Button type="button" variant={item ? "secondary" : "primary"} className={item ? "min-h-10 px-3.5 text-[12.5px]" : "self-start"} onClick={() => setOpen(true)}>
          {label ?? (item ? "Edit" : "+ Add equipment")}
        </Button>
      </div>
    );
  return (
    <form
      noValidate
      aria-label={item ? `Edit ${item.name}` : "Add equipment"}
      className="flex w-full flex-col gap-3 rounded-2xl border border-line bg-paper p-3.5 shadow-[var(--shadow-card)]"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const get = (k: string) => String(f.get(k) ?? "");
        run(() => saveEquipmentItemAction({ id: item?.id, name: get("name"), category: get("category") as "DECOR", quantity: get("quantity"), condition: get("condition") as "GOOD", location: get("location"), notes: get("notes"), photoFileId: photo ?? "" }), () => setOpen(false));
      }}
    >
      <h3 className="label-mono text-[12.5px]">{item ? `Edit ${item.name}` : "Add equipment"}</h3>
      {result && !result.ok && <Notice tone="error">{result.error}</Notice>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field className="sm:col-span-2" label="Item" name="name" defaultValue={item?.name} placeholder="Gold chiavari chair" error={fe.name} />
        <SelectField label="Category" name="category" defaultValue={item?.category ?? "DECOR"} options={CATEGORIES} error={fe.category} />
        <Field label="How many the company owns" name="quantity" inputMode="numeric" defaultValue={item ? String(item.quantity) : ""} error={fe.quantity} />
        <SelectField label="Condition" name="condition" defaultValue={item?.condition ?? "GOOD"} options={CONDITIONS} />
        <Field label="Kept at" name="location" defaultValue={item?.location ?? ""} placeholder="Godown, rack B" />
        <Field className="sm:col-span-2 lg:col-span-3" label="Notes" name="notes" defaultValue={item?.notes ?? ""} placeholder="Comes with white covers; 4 have a wobbly leg" />
      </div>
      <DocumentUpload label={item?.photoFileId ? "Replace the photo (optional)" : "Photo (optional)"} onChange={(id) => setPhoto(id ?? item?.photoFileId ?? null)} error={fe.photoFileId} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : item ? "Save" : "Add to the register"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function BookEquipmentForm({ eventId, items, from, to }: { eventId: string; items: { id: string; name: string; free: number; owned: number; condition: string }[]; from: string; to: string }) {
  const { result, pending, run, fe } = useRun();
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState("");
  const picked = items.find((i) => i.id === itemId);
  if (!open)
    return (
      <div className="flex flex-col gap-2">
        {result?.ok && <Notice tone={/Clash/.test(result.message ?? "") ? "info" : "ok"}>{result.message}</Notice>}
        <Button type="button" className="self-start" onClick={() => setOpen(true)}>
          + Book equipment
        </Button>
      </div>
    );
  return (
    <form
      noValidate
      aria-label="Book equipment"
      className="flex flex-col gap-3 rounded-2xl border border-line bg-paper p-3.5 shadow-[var(--shadow-card)]"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const get = (k: string) => String(f.get(k) ?? "");
        run(() => bookEquipmentAction({ eventId, itemId, quantity: get("quantity"), from: get("from"), to: get("to"), note: get("note") }), () => setOpen(false));
      }}
    >
      <h3 className="label-mono text-[12.5px]">Book equipment from the register</h3>
      {result && !result.ok && <Notice tone="error">{result.error}</Notice>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SelectField
          className="sm:col-span-2"
          label="Item"
          name="itemId"
          value={itemId}
          onChange={(e) => setItemId(e.target.value)}
          error={fe.itemId}
          options={[{ value: "", label: "Pick an item…" }, ...items.map((i) => ({ value: i.id, label: `${i.name} · ${i.free} of ${i.owned} free${i.condition === "NEEDS_REPAIR" ? " · needs repair" : ""}` }))]}
        />
        <Field label="How many" name="quantity" inputMode="numeric" error={fe.quantity} hint={picked ? (picked.free < picked.owned ? `${picked.free} free on these dates` : `All ${picked.owned} free`) : undefined} />
        <span />
        <Field label="Out from" name="from" type="date" defaultValue={from} error={fe.from} />
        <Field label="Back by" name="to" type="date" defaultValue={to} error={fe.to} />
        <Field className="sm:col-span-2" label="Note (optional)" name="note" placeholder="For the stage backdrop" />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Booking…" : "Book it"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function CheckOutEquipment({ id }: { id: string }) {
  const { result, pending, run } = useRun();
  const [note, setNote] = useState("");
  if (result?.ok) return <Outcome result={result} />;
  return (
    <Inline label="Check out" variant="primary">
      {(close) => (
        <>
          <Field label="Condition going out (optional)" name={`co-${id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="All fine, packed in 3 boxes" />
          <span className="flex gap-1.5">
            <Button type="button" className="min-h-10 px-3 text-[12px]" disabled={pending} onClick={() => run(() => checkOutEquipmentAction(id, note), close)}>
              {pending ? "Saving…" : "Checked out"}
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

export function CheckInEquipment({ id, quantity }: { id: string; quantity: number }) {
  const { result, pending, run, fe } = useRun();
  const [good, setGood] = useState(String(quantity));
  const [damaged, setDamaged] = useState("0");
  const [missing, setMissing] = useState("0");
  const [note, setNote] = useState("");
  if (result?.ok) return <Outcome result={result} />;
  return (
    <Inline label="Check in" variant="look">
      {(close) => (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Fine" name={`cg-${id}`} inputMode="numeric" value={good} onChange={(e) => setGood(e.target.value)} error={fe.good} />
            <Field label="Damaged" name={`cd-${id}`} inputMode="numeric" value={damaged} onChange={(e) => setDamaged(e.target.value)} />
            <Field label="Missing" name={`cm-${id}`} inputMode="numeric" value={missing} onChange={(e) => setMissing(e.target.value)} />
          </div>
          <Field label="Condition notes" name={`cn-${id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="2 chairs with broken legs; 1 left at the venue" error={fe.note} />
          <span className="flex gap-1.5">
            <Button type="button" className="min-h-10 px-3 text-[12px]" disabled={pending} onClick={() => run(() => checkInEquipmentAction(id, { good, damaged, missing, note }), close)}>
              {pending ? "Saving…" : "Checked in"}
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

export function CancelEquipmentBooking({ id }: { id: string }) {
  const { result, pending, run } = useRun();
  const [reason, setReason] = useState("");
  if (result?.ok) return <Outcome result={result} />;
  return (
    <Inline label="Cancel" variant="ghost">
      {(close) => (
        <>
          <Field label="Why?" name={`cx-${id}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Hiring instead" />
          <span className="flex gap-1.5">
            <Button type="button" variant="danger" className="min-h-10 px-3 text-[12px]" disabled={pending || !reason.trim()} onClick={() => run(() => cancelEquipmentBookingAction(id, reason), close)}>
              Cancel booking
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

export function ResolveIssue({ id }: { id: string }) {
  const { result, pending, run } = useRun();
  const [note, setNote] = useState("");
  if (result?.ok) return <Outcome result={result} />;
  return (
    <Inline label="Settle" variant="secondary">
      {(close) => (
        <>
          <Field label="How was it settled?" name={`rs-${id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Found in the van / repaired / written off" />
          <span className="flex gap-1.5">
            <Button type="button" className="min-h-10 px-3 text-[12px]" disabled={pending || !note.trim()} onClick={() => run(() => resolveEquipmentIssueAction(id, note), close)}>
              Settled
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
