"use client";

/** Editors on the booking workspace: details, team, functions, run sheet, requirements, cancelling. */
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Button, Field, Notice, SelectField } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import {
  cancelBookingAction,
  removeFunctionAction,
  removeScheduleItemAction,
  saveFunctionAction,
  saveRequirementAction,
  saveScheduleItemAction,
  setScheduleDoneAction,
  setTeamAction,
  updateDetailsAction,
} from "./planning-actions";

function useRun() {
  const router = useRouter();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>, onOk?: () => void) =>
    start(async () => {
      const r = await fn();
      setResult(r);
      if (r.ok) {
        onOk?.();
        router.refresh();
      }
    });
  return { result, setResult, pending, run, fe: result && !result.ok ? (result.fieldErrors ?? {}) : ({} as Record<string, string>) };
}

/** A button that opens an inline form. */
function Toggle({ label, children, variant = "secondary", small }: { label: string; children: (close: () => void) => ReactNode; variant?: "secondary" | "ghost"; small?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button type="button" variant={variant} className={small ? "min-h-9 px-2.5 text-[11.5px]" : "self-start"} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  return <>{children(() => setOpen(false))}</>;
}

const FORM = "flex flex-col gap-3 rounded-2xl shadow-[var(--shadow-card)] border border-line bg-paper p-3.5";
const STATUS_OPTIONS = [
  { value: "TENTATIVE", label: "Tentative" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "PLANNING", label: "Planning" },
  { value: "LIVE", label: "Live" },
  { value: "COMPLETED", label: "Completed" },
  { value: "POSTPONED", label: "Postponed" },
];

export function DetailsEditor({ eventId, initial, categories }: { eventId: string; initial: { name: string; categoryId: string; status: string; expectedGuests: number | null; description: string | null; shareHostContactWithVendors: boolean }; categories: { id: string; name: string }[] }) {
  const { result, pending, run, fe } = useRun();
  return (
    <Toggle label="Edit details">
      {(close) => (
        <form
          noValidate
          className={FORM}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(
              () =>
                updateDetailsAction(eventId, {
                  name: String(f.get("name") ?? ""),
                  categoryId: String(f.get("categoryId") ?? ""),
                  status: String(f.get("status")) as "TENTATIVE",
                  expectedGuests: String(f.get("expectedGuests") ?? ""),
                  description: String(f.get("description") ?? ""),
                  shareHostContactWithVendors: f.get("share") === "on",
                }),
              close,
            );
          }}
        >
          {result && !result.ok && <Notice tone="error">{result.error}</Notice>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Booking name" name="name" defaultValue={initial.name} error={fe.name} />
            <SelectField label="Type of event" name="categoryId" defaultValue={initial.categoryId} options={categories.map((c) => ({ value: c.id, label: c.name }))} />
            <SelectField label="Status" name="status" defaultValue={STATUS_OPTIONS.some((o) => o.value === initial.status) ? initial.status : "PLANNING"} options={STATUS_OPTIONS} />
            <Field label="Expected guests" name="expectedGuests" inputMode="numeric" defaultValue={initial.expectedGuests ?? ""} error={fe.expectedGuests} />
          </div>
          <label className="flex flex-col gap-1">
            <span className="label-mono text-[12px]">Notes</span>
            <textarea name="description" rows={3} defaultValue={initial.description ?? ""} className="rounded-xl border border-line bg-paper px-3 py-2 text-[15px]" />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-[14px]">
            <input type="checkbox" name="share" defaultChecked={initial.shareHostContactWithVendors} className="h-5 w-5 accent-plum" /> Vendors on this booking can see the host&apos;s name and phone
          </label>
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Toggle>
  );
}

export function TeamEditor({ eventId, candidates, managerIds, supervisorIds }: { eventId: string; candidates: { id: string; name: string; manager: boolean; supervisor: boolean }[]; managerIds: string[]; supervisorIds: string[] }) {
  const { result, pending, run } = useRun();
  const [m, setM] = useState(managerIds);
  const [s, setS] = useState(supervisorIds);
  const flip = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <Toggle label="Change team" small variant="ghost">
      {(close) => (
        <div className="flex flex-col gap-2.5 border-t border-rule-soft px-3.5 py-3">
          {[
            { title: "Managers", who: candidates.filter((c) => c.manager), list: m, set: setM },
            { title: "Supervisors", who: candidates.filter((c) => c.supervisor), list: s, set: setS },
          ].map((g) => (
            <fieldset key={g.title} className="flex flex-col gap-1">
              <legend className="label-mono mb-1 text-[11.5px]">{g.title}</legend>
              <div className="flex flex-wrap gap-1.5">
                {g.who.map((c) => (
                  <label key={c.id} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-2.5 text-[13.5px] ${g.list.includes(c.id) ? "border-line bg-look" : "border-rule-soft"}`}>
                    <input type="checkbox" className="h-4 w-4 accent-plum" checked={g.list.includes(c.id)} onChange={() => g.set(flip(g.list, c.id))} />
                    {c.name}
                  </label>
                ))}
                {g.who.length === 0 && <span className="text-[13px] text-ink-quiet">Nobody has this role yet. Add people on the Team page.</span>}
              </div>
            </fieldset>
          ))}
          {result && !result.ok && <Notice tone="error">{result.error}</Notice>}
          <div className="flex gap-2">
            <Button type="button" className="min-h-10 px-3 text-[11.5px]" disabled={pending} onClick={() => run(() => setTeamAction(eventId, m, s), close)}>
              {pending ? "Saving…" : "Save team"}
            </Button>
            <Button type="button" variant="secondary" className="min-h-10 px-3 text-[11.5px]" onClick={close}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Toggle>
  );
}

export interface FunctionValues {
  id: string;
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  venueId: string | null;
  venueText: string | null;
  guests: number | null;
  notes: string | null;
}

export function FunctionEditor({ eventId, fn, venues, canRemove }: { eventId: string; fn?: FunctionValues; venues: { id: string; name: string }[]; canRemove?: boolean }) {
  const { result, pending, run, fe } = useRun();
  const [venueId, setVenueId] = useState(fn?.venueId ?? "");
  return (
    <Toggle label={fn ? "Edit" : "+ Add a function"} small={Boolean(fn)} variant={fn ? "ghost" : "secondary"}>
      {(close) => (
        <form
          noValidate
          className={`${FORM} ${fn ? "mt-2" : ""}`}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const get = (k: string) => String(f.get(k) ?? "");
            run(() => saveFunctionAction(eventId, { id: fn?.id, name: get("name"), date: get("date"), startTime: get("startTime"), endTime: get("endTime"), venueId, venueText: get("venueText"), guests: get("guests"), notes: get("notes") }), close);
          }}
        >
          {result && !result.ok && <Notice tone="error">{result.error}</Notice>}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Field className="col-span-2" label="Function" name="name" defaultValue={fn?.name} placeholder="Sangeet" error={fe.name} />
            <Field label="Day" name="date" type="date" defaultValue={fn?.date} error={fe.date} />
            <Field label="Guests" name="guests" inputMode="numeric" defaultValue={fn?.guests ?? ""} />
            <Field label="Starts" name="startTime" type="time" defaultValue={fn?.startTime} error={fe.startTime} />
            <Field label="Ends (optional)" name="endTime" type="time" defaultValue={fn?.endTime} />
            <SelectField label="Venue" name="venueId" value={venueId} onChange={(e) => setVenueId(e.target.value)} options={[{ value: "", label: "Another place (type it)" }, ...venues.map((v) => ({ value: v.id, label: v.name }))]} className="col-span-2" />
            {!venueId && <Field className="col-span-2" label="Place" name="venueText" defaultValue={fn?.venueText ?? ""} placeholder="Farmhouse, Ajmer Road" />}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : fn ? "Save" : "Add function"}
            </Button>
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
            {fn && canRemove && (
              <Button type="button" variant="danger" className="ml-auto" disabled={pending} onClick={() => run(() => removeFunctionAction(eventId, fn.id), close)}>
                Remove function
              </Button>
            )}
          </div>
        </form>
      )}
    </Toggle>
  );
}

export function CancelBooking({ eventId }: { eventId: string }) {
  const { result, pending, run } = useRun();
  const [reason, setReason] = useState("");
  return (
    <Toggle label="Cancel booking" variant="ghost">
      {(close) => (
        <div className={FORM}>
          <label className="flex flex-col gap-1">
            <span className="label-mono text-[12px]">Why is it cancelled?</span>
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="rounded-xl border border-line bg-paper px-3 py-2 text-[15px]" placeholder="Client postponed to next season" />
          </label>
          <p className="text-[13px] text-ink-quiet">The team, booked vendors and crew are told. Money already recorded stays; refunds and payments are handled under Money.</p>
          {result && !result.ok && <Notice tone="error">{result.error}</Notice>}
          <div className="flex gap-2">
            <Button type="button" variant="danger" disabled={pending || !reason.trim()} onClick={() => run(() => cancelBookingAction(eventId, reason), close)}>
              {pending ? "Saving…" : "Cancel booking"}
            </Button>
            <Button type="button" variant="secondary" onClick={close}>
              Keep it
            </Button>
          </div>
        </div>
      )}
    </Toggle>
  );
}

const ITEM_TYPES = [
  { value: "SETUP", label: "Setup" },
  { value: "VENDOR_REPORTING", label: "Vendor reporting" },
  { value: "CREW_REPORTING", label: "Crew reporting" },
  { value: "CEREMONY", label: "Ceremony" },
  { value: "MEAL", label: "Meal" },
  { value: "PERFORMANCE", label: "Performance" },
  { value: "DISMANTLE", label: "Dismantle" },
  { value: "DEADLINE", label: "Deadline" },
  { value: "OTHER", label: "Other" },
];

export interface ScheduleValues {
  id: string;
  functionId: string | null;
  type: string;
  title: string;
  date: string;
  time: string;
  endTime: string;
  location: string | null;
  visibleToVendors: boolean;
  visibleToCrew: boolean;
}

export function ScheduleEditor({ eventId, item, functions, defaultDate }: { eventId: string; item?: ScheduleValues; functions: { id: string; name: string; date: string }[]; defaultDate: string }) {
  const { result, pending, run, fe } = useRun();
  const [fnId, setFnId] = useState(item?.functionId ?? functions[0]?.id ?? "");
  const fnDate = functions.find((f) => f.id === fnId)?.date ?? defaultDate;
  return (
    <Toggle label={item ? "Edit" : "+ Add to the run sheet"} small={Boolean(item)} variant={item ? "ghost" : "secondary"}>
      {(close) => (
        <form
          noValidate
          className={`${FORM} ${item ? "mt-2" : ""}`}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const get = (k: string) => String(f.get(k) ?? "");
            run(
              () =>
                saveScheduleItemAction(eventId, {
                  id: item?.id,
                  functionId: fnId,
                  type: get("type") as "OTHER",
                  title: get("title"),
                  date: get("date"),
                  time: get("time"),
                  endTime: get("endTime"),
                  location: get("location"),
                  visibleToVendors: f.get("vendors") === "on",
                  visibleToCrew: f.get("crew") === "on",
                }),
              close,
            );
          }}
        >
          {result && !result.ok && <Notice tone="error">{result.error}</Notice>}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Field className="col-span-2 lg:col-span-3" label="What happens" name="title" defaultValue={item?.title} placeholder="Baraat arrives at the gate" error={fe.title} />
            <SelectField className="lg:col-span-2" label="Function" name="functionId" value={fnId} onChange={(e) => setFnId(e.target.value)} options={[...functions.map((f) => ({ value: f.id, label: f.name })), { value: "", label: "Whole booking" }]} />
            <SelectField label="Kind" name="type" defaultValue={item?.type ?? "OTHER"} options={ITEM_TYPES} />
            <Field label="Day" name="date" type="date" key={fnDate} defaultValue={item?.date ?? fnDate} error={fe.date} />
            <Field label="Time" name="time" type="time" defaultValue={item?.time} error={fe.time} />
            <Field label="Until (optional)" name="endTime" type="time" defaultValue={item?.endTime} />
            <Field className="col-span-2 lg:col-span-3" label="Where (optional)" name="location" defaultValue={item?.location ?? ""} placeholder="Main lawn" />
          </div>
          <div className="flex flex-wrap gap-4 text-[14px]">
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" name="vendors" defaultChecked={item?.visibleToVendors} className="h-5 w-5 accent-plum" /> Vendors see this
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" name="crew" defaultChecked={item?.visibleToCrew} className="h-5 w-5 accent-plum" /> Crew see this
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : item ? "Save" : "Add"}
            </Button>
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
            {item && (
              <Button type="button" variant="danger" className="ml-auto" disabled={pending} onClick={() => run(() => removeScheduleItemAction(eventId, item.id), close)}>
                Remove
              </Button>
            )}
          </div>
        </form>
      )}
    </Toggle>
  );
}

export function DoneToggle({ itemId, done, night = false }: { itemId: string; done: boolean; night?: boolean }) {
  const { pending, run, result } = useRun();
  return (
    <span className="flex flex-col items-end">
      <button
        type="button"
        aria-pressed={done}
        disabled={pending}
        onClick={() => run(() => setScheduleDoneAction(itemId, !done))}
        className={`min-h-11 min-w-11 rounded-full border px-3.5 text-[13px] font-semibold transition ${done ? "border-ok bg-ok text-ink" : night ? "border-night-rule text-night-text" : "border-line text-ink"}`}
      >
        {done ? "✓ Done" : "Done?"}
      </button>
      {result && !result.ok && <span className="text-[12px] font-semibold text-now">{result.error}</span>}
    </span>
  );
}

export interface RequirementValues {
  id: string;
  functionId: string | null;
  vendorCategoryId: string | null;
  title: string;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  source: "CLIENT" | "INTERNAL";
  status: "OPEN" | "QUOTING" | "COVERED" | "DROPPED";
  vendorAssignmentId: string | null;
}

export function RequirementEditor({ eventId, req, functions, categories, jobs }: { eventId: string; req?: RequirementValues; functions: { id: string; name: string }[]; categories: { id: string; name: string }[]; jobs: { id: string; label: string }[] }) {
  const { result, pending, run, fe } = useRun();
  return (
    <Toggle label={req ? "Edit" : "+ Add a requirement"} small={Boolean(req)} variant={req ? "ghost" : "secondary"}>
      {(close) => (
        <form
          noValidate
          className={`${FORM} ${req ? "mt-2" : ""}`}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const get = (k: string) => String(f.get(k) ?? "");
            run(
              () =>
                saveRequirementAction(eventId, {
                  id: req?.id,
                  title: get("title"),
                  description: get("description"),
                  functionId: get("functionId"),
                  vendorCategoryId: get("vendorCategoryId"),
                  quantity: get("quantity"),
                  unit: get("unit"),
                  source: get("source") as "CLIENT",
                  status: get("status") as "OPEN",
                  vendorAssignmentId: get("vendorAssignmentId"),
                }),
              close,
            );
          }}
        >
          {result && !result.ok && <Notice tone="error">{result.error}</Notice>}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Field className="col-span-2" label="What is needed" name="title" defaultValue={req?.title} placeholder="Generator backup, 125 kVA" error={fe.title} />
            <Field label="How many" name="quantity" inputMode="decimal" defaultValue={req?.quantity ?? ""} />
            <Field label="Unit" name="unit" defaultValue={req?.unit ?? ""} placeholder="set" />
            <SelectField label="Function" name="functionId" defaultValue={req?.functionId ?? ""} options={[{ value: "", label: "Whole booking" }, ...functions.map((f) => ({ value: f.id, label: f.name }))]} />
            <SelectField label="Department" name="vendorCategoryId" defaultValue={req?.vendorCategoryId ?? ""} options={[{ value: "", label: "Any" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]} />
            <SelectField label="Asked by" name="source" defaultValue={req?.source ?? "INTERNAL"} options={[{ value: "INTERNAL", label: "Our team" }, { value: "CLIENT", label: "The client" }]} />
            <SelectField label="State" name="status" defaultValue={req?.status ?? "OPEN"} options={[{ value: "OPEN", label: "Open" }, { value: "QUOTING", label: "Being quoted" }, { value: "COVERED", label: "Covered" }, { value: "DROPPED", label: "Dropped" }]} />
            <SelectField className="col-span-2" label="Handled by (the vendor sees it)" name="vendorAssignmentId" defaultValue={req?.vendorAssignmentId ?? ""} options={[{ value: "", label: "No vendor yet" }, ...jobs.map((j) => ({ value: j.id, label: j.label }))]} />
            <Field className="col-span-2" label="Details (optional)" name="description" defaultValue={req?.description ?? ""} placeholder="Silent type, near the stage" />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : req ? "Save" : "Add"}
            </Button>
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Toggle>
  );
}
