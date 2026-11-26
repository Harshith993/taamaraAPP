"use client";

/** Buttons and forms for crew: hiring, taking off, accepting. */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { assignCrewAction, removeCrewAction, respondToBookingAction } from "@/app/actions/crew";
import { Button, Field, Notice, SelectField } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";


interface WorkerOption {
  id: string;
  name: string;
  skills: string[];
  usualRate: number | null;
  unavailable: boolean;
  onThisBooking: boolean;
  busyElsewhere: string[];
}

interface FunctionOption {
  id: string;
  name: string;
  when: string;
  defaultReport: string;
}

/** "Add crew": who, their duty, the pay for the event and a reporting time per function. */
export function AddCrewForm({ eventId, workers, functions, seesPay }: { eventId: string; workers: WorkerOption[]; functions: FunctionOption[]; seesPay: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [workerId, setWorkerId] = useState("");
  const [pay, setPay] = useState("");
  const [shifts, setShifts] = useState<Record<string, { on: boolean; time: string; location: string }>>(
    Object.fromEntries(functions.map((f) => [f.id, { on: functions.length === 1, time: f.defaultReport, location: "" }])),
  );
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const fe = result && !result.ok ? (result.fieldErrors ?? {}) : {};
  const picked = workers.find((w) => w.id === workerId);

  if (!open)
    return (
      <div className="flex flex-col gap-2">
        {result?.ok && <Notice tone="ok">{result.message}</Notice>}
        <Button type="button" variant="secondary" className="self-start" onClick={() => (setOpen(true), setResult(null))}>
          + Add crew
        </Button>
      </div>
    );

  return (
    <form
      noValidate
      className="flex flex-col gap-3 rounded-2xl shadow-[var(--shadow-card)] border border-line bg-paper p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        start(async () => {
          const r = await assignCrewAction({
            eventId,
            workerId,
            duty: String(f.get("duty") ?? ""),
            agreedPay: seesPay && pay !== "" ? pay : undefined,
            shifts: Object.entries(shifts)
              .filter(([, s]) => s.on)
              .map(([functionId, s]) => ({ functionId, reportTime: s.time, location: s.location || undefined })),
          });
          setResult(r);
          if (r.ok) {
            setOpen(false);
            setWorkerId("");
            setPay("");
            router.refresh();
          }
        });
      }}
    >
      <h3 className="label-mono text-[12.5px]">Add crew</h3>
      {result && !result.ok && <Notice tone="error">{result.error}</Notice>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,0.8fr)]">
        <SelectField
          label="Who"
          name="workerId"
          value={workerId}
          error={fe.workerId}
          onChange={(e) => {
            setWorkerId(e.target.value);
            const w = workers.find((x) => x.id === e.target.value);
            if (w?.usualRate) setPay(String(w.usualRate));
          }}
          options={[
            { value: "", label: "Pick a crew member…" },
            ...workers.map((w) => ({
              value: w.id,
              label: `${w.name}${w.skills.length ? ` · ${w.skills.join(", ")}` : ""}${w.onThisBooking ? " (already on)" : w.unavailable ? " (away)" : w.busyElsewhere.length ? ` (busy: ${w.busyElsewhere[0]})` : ""}`,
            })),
          ]}
        />
        <Field label="Duty" name="duty" placeholder="Stage decor and drapes" error={fe.duty} />
        {seesPay && <Field label="Pay for the event ₹" name="agreedPay" inputMode="numeric" value={pay} onChange={(e) => setPay(e.target.value)} error={fe.agreedPay} hint={picked?.usualRate ? `Usual ₹${picked.usualRate}` : undefined} />}
      </div>
      {picked && (picked.unavailable || picked.busyElsewhere.length > 0 || picked.onThisBooking) && (
        <p className="text-[13px] font-semibold text-now">
          {picked.onThisBooking ? `${picked.name} is already on this booking.` : picked.unavailable ? `${picked.name} has marked these days as unavailable.` : `${picked.name} is also booked for ${picked.busyElsewhere.join(", ")} that day.`}
        </p>
      )}
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-[13px] font-medium text-ink">Shifts · reporting time</legend>
        {functions.map((fn) => {
          const s = shifts[fn.id];
          return (
            <div key={fn.id} className={`grid grid-cols-[minmax(0,1fr)_110px] items-center gap-2 rounded-xl border px-3 py-1.5 sm:grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)] ${s.on ? "border-line bg-look/25" : "border-rule-soft"}`}>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[14px]">
                <input type="checkbox" className="h-4 w-4 accent-plum" checked={s.on} onChange={() => setShifts((all) => ({ ...all, [fn.id]: { ...s, on: !s.on } }))} />
                <span>
                  <strong>{fn.name}</strong> <span className="text-ink-quiet">{fn.when}</span>
                </span>
              </label>
              <input type="time" aria-label={`Reporting time for ${fn.name}`} value={s.time} disabled={!s.on} onChange={(e) => setShifts((all) => ({ ...all, [fn.id]: { ...s, time: e.target.value } }))} className="min-h-11 rounded-xl border border-line bg-paper px-2 font-mono text-[14px] disabled:opacity-40" />
              <input aria-label={`Where to report for ${fn.name}`} placeholder="Gate 2" value={s.location} disabled={!s.on} onChange={(e) => setShifts((all) => ({ ...all, [fn.id]: { ...s, location: e.target.value } }))} className="col-span-2 min-h-11 rounded-xl border border-line bg-paper px-2 text-[14px] disabled:opacity-40 sm:col-span-1" />
            </div>
          );
        })}
        {fe.shifts && <span className="text-[13px] font-semibold text-now">{fe.shifts}</span>}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || !workerId}>
          {pending ? "Adding…" : "Add to booking"}
        </Button>
        <Button type="button" variant="secondary" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function RemoveCrew({ assignmentId, name }: { assignmentId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  if (result?.ok) return <span className="text-[12.5px] font-semibold text-ok-text">{result.message}</span>;
  if (!open)
    return (
      <Button type="button" variant="ghost" className="min-h-9 px-2 text-[11.5px]" onClick={() => setOpen(true)}>
        Take off
      </Button>
    );
  return (
    <span className="flex min-w-[200px] flex-col gap-1.5">
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? (they are told)" aria-label={`Why take ${name} off`} className="min-h-10 rounded-xl border border-line bg-paper px-2 text-[13.5px]" />
      <span className="flex gap-1.5">
        <Button type="button" variant="danger" className="min-h-9 px-3 text-[11.5px]" disabled={pending || !reason.trim()} onClick={() => start(async () => setResult(await removeCrewAction(assignmentId, reason)))}>
          {pending ? "Saving…" : "Take off"}
        </Button>
        <Button type="button" variant="secondary" className="min-h-9 px-3 text-[11.5px]" onClick={() => setOpen(false)}>
          Back
        </Button>
      </span>
      {result && !result.ok && <span className="text-[12.5px] font-semibold text-now">{result.error}</span>}
    </span>
  );
}

/** The crew member's Accept / Can't make it. */
export function RespondButtons({ assignmentId }: { assignmentId: string }) {
  const router = useRouter();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const run = (accept: boolean) =>
    start(async () => {
      const r = await respondToBookingAction(assignmentId, accept, reason);
      setResult(r);
      if (r.ok) router.refresh();
    });
  if (result?.ok) return <Notice tone="ok">{result.message}</Notice>;
  return (
    <div className="flex flex-col gap-2">
      {declining && (
        <label className="flex flex-col gap-1">
          <span className="label-mono text-[12px]">Why can&apos;t you come?</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Working at another event" className="min-h-11 rounded-xl border border-line bg-paper px-3 text-[15px]" />
        </label>
      )}
      <div className="grid grid-cols-2 gap-2">
        {declining ? (
          <>
            <Button type="button" variant="danger" className="min-h-[58px]" disabled={pending || !reason.trim()} onClick={() => run(false)}>
              {pending ? "Saving…" : "Send"}
            </Button>
            <Button type="button" variant="secondary" className="min-h-[58px]" disabled={pending} onClick={() => setDeclining(false)}>
              Back
            </Button>
          </>
        ) : (
          <>
            <Button type="button" className="min-h-[58px]" disabled={pending} onClick={() => run(true)}>
              {pending ? "Saving…" : "Accept"}
            </Button>
            <Button type="button" variant="secondary" className="min-h-[58px]" disabled={pending} onClick={() => setDeclining(true)}>
              Can&apos;t make it
            </Button>
          </>
        )}
      </div>
      {result && !result.ok && <Notice tone="error">{result.error}</Notice>}
    </div>
  );
}

