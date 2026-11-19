"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Field, Notice, Panel, SelectField } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import { createBookingAction } from "../actions";

interface FnRow {
  key: number;
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  venueText: string;
  guests: string;
}

const blankFn = (key: number): FnRow => ({ key, name: "", date: "", startTime: "19:00", endTime: "", venueText: "", guests: "" });

export function NewBookingForm({ categories, clients }: { categories: { id: string; name: string }[]; clients: { id: string; name: string; phone: string | null }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult<{ id: string; code: string; taskCount: number }> | null>(null);
  const [clientMode, setClientMode] = useState<"new" | "existing">(clients.length ? "existing" : "new");
  // Row keys come from a per-form counter so the server and browser render the same field names.
  const [fns, setFns] = useState<FnRow[]>([blankFn(0)]);
  const [nextKey, setNextKey] = useState(1);
  const err = result && !result.ok ? result : null;
  const fe = err?.fieldErrors ?? {};

  function update(key: number, patch: Partial<FnRow>) {
    setFns((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const get = (k: string) => String(form.get(k) ?? "").trim();
    start(async () => {
      const r = await createBookingAction({
        name: get("name"),
        categoryId: get("categoryId"),
        status: get("status") as "TENTATIVE" | "CONFIRMED",
        clientId: clientMode === "existing" ? get("clientId") || undefined : undefined,
        clientName: clientMode === "new" ? get("clientName") : undefined,
        clientPhone: clientMode === "new" ? get("clientPhone") || undefined : undefined,
        expectedGuests: get("expectedGuests") ? Number(get("expectedGuests")) : undefined,
        description: get("description") || undefined,
        functions: fns.map((f) => ({ name: f.name.trim(), date: f.date, startTime: f.startTime, endTime: f.endTime || "", venueText: f.venueText.trim() || undefined, guests: f.guests ? Number(f.guests) : undefined })),
      });
      setResult(r);
      if (r.ok && r.data) router.push(`/bookings/${r.data.id}?created=1`);
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {err && <Notice tone="error">{err.error}</Notice>}
      <Panel title="The booking">
        <div className="grid grid-cols-1 gap-3 p-3.5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Booking name" name="name" placeholder="Aditi & Karan" required error={fe.name} className="lg:col-span-2" />
          <SelectField label="Type" name="categoryId" options={[{ value: "", label: "Pick a type…" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]} error={fe.categoryId} />
          <SelectField label="Status" name="status" options={[{ value: "TENTATIVE", label: "Tentative" }, { value: "CONFIRMED", label: "Confirmed" }]} />
          <Field label="Expected guests" name="expectedGuests" type="number" min={0} inputMode="numeric" />
          <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
            <label htmlFor="f-description" className="label-mono text-[12px]">
              Notes (optional)
            </label>
            <textarea id="f-description" name="description" rows={2} className="rounded-xl border border-line bg-paper px-3 py-2 text-[15px]" placeholder="Theme, family wishes, anything the team should know" />
          </div>
        </div>
      </Panel>

      <Panel title="Client">
        <div className="flex flex-col gap-3 p-3.5">
          <div role="radiogroup" aria-label="Client" className="flex flex-wrap gap-4 text-[14.5px]">
            {clients.length > 0 && (
              <label className="flex min-h-11 items-center gap-2">
                <input type="radio" name="clientMode" checked={clientMode === "existing"} onChange={() => setClientMode("existing")} className="h-5 w-5 accent-plum" /> Existing client
              </label>
            )}
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" name="clientMode" checked={clientMode === "new"} onChange={() => setClientMode("new")} className="h-5 w-5 accent-plum" /> New client
            </label>
          </div>
          {clientMode === "existing" ? (
            <SelectField label="Client" name="clientId" options={[{ value: "", label: "Pick a client…" }, ...clients.map((c) => ({ value: c.id, label: `${c.name}${c.phone ? ` · ${c.phone}` : ""}` }))]} error={fe.clientName} />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Client name" name="clientName" placeholder="Anil Gupta" error={fe.clientName} />
              <Field label="Client phone" name="clientPhone" inputMode="tel" placeholder="98100 00005" error={fe.clientPhone} />
            </div>
          )}
        </div>
      </Panel>

      <Panel title={`Functions · ${fns.length}`} action={<span className="text-[12.5px] text-ink-quiet">A single party is one function; a wedding can have five.</span>}>
        <div className="flex flex-col">
          {fns.map((f, i) => (
            <fieldset key={f.key} className="grid grid-cols-2 gap-3 border-b border-rule-soft p-3.5 last:border-b-0 sm:grid-cols-3 lg:grid-cols-[1.3fr_1fr_0.7fr_0.7fr_1.3fr_0.6fr_auto] lg:items-end">
              <legend className="sr-only">Function {i + 1}</legend>
              <Field label="Function" name={`fn-name-${f.key}`} value={f.name} onChange={(e) => update(f.key, { name: e.target.value })} placeholder={i === 0 ? "Sangeet" : "Wedding"} error={fe[`functions.${i}.name`]} />
              <Field label="Date" name={`fn-date-${f.key}`} type="date" value={f.date} onChange={(e) => update(f.key, { date: e.target.value })} error={fe[`functions.${i}.date`]} />
              <Field label="Starts" name={`fn-start-${f.key}`} type="time" value={f.startTime} onChange={(e) => update(f.key, { startTime: e.target.value })} error={fe[`functions.${i}.startTime`]} />
              <Field label="Ends" name={`fn-end-${f.key}`} type="time" value={f.endTime} onChange={(e) => update(f.key, { endTime: e.target.value })} />
              <Field label="Venue" name={`fn-venue-${f.key}`} value={f.venueText} onChange={(e) => update(f.key, { venueText: e.target.value })} placeholder="Rambagh Gardens" />
              <Field label="Guests" name={`fn-guests-${f.key}`} type="number" min={0} value={f.guests} onChange={(e) => update(f.key, { guests: e.target.value })} />
              <Button type="button" variant="ghost" disabled={fns.length === 1} onClick={() => setFns((rows) => rows.filter((r) => r.key !== f.key))} aria-label={`Remove function ${i + 1}`}>
                Remove
              </Button>
            </fieldset>
          ))}
          <div className="p-3.5">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setFns((rows) => [...rows, blankFn(nextKey)]);
                setNextKey((k) => k + 1);
              }}
            >
              + Add another function
            </Button>
          </div>
        </div>
      </Panel>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending} className="min-h-12 px-6">
          {pending ? "Creating…" : "Create booking"}
        </Button>
      </div>
    </form>
  );
}
