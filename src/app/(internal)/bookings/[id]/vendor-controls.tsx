"use client";

import { useState, useTransition } from "react";
import { Button, Field, Notice, SelectField } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import {
  cancelJobAction,
  inviteVendorAction,
  issueWorkOrderAction,
  signOffJobAction,
} from "./actions";

interface VendorOption {
  id: string;
  name: string;
  city: string | null;
  categories: { id: string; name: string }[];
}

/** "Ask a vendor to quote": pick a department, a vendor in it, the work and the functions. */
export function InviteVendorForm({
  eventId,
  vendors,
  departments,
  functions,
}: {
  eventId: string;
  vendors: VendorOption[];
  departments: { id: string; name: string }[];
  functions: { id: string; name: string; when: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [department, setDepartment] = useState("");
  const [fnIds, setFnIds] = useState<string[]>(
    functions.length === 1 ? [functions[0].id] : [],
  );
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const fe = result && !result.ok ? (result.fieldErrors ?? {}) : {};
  const shown = department
    ? vendors.filter((v) => v.categories.some((c) => c.id === department))
    : vendors;

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        {result?.ok && <Notice tone="ok">{result.message}</Notice>}
        <Button
          type="button"
          variant="secondary"
          className="self-start"
          onClick={() => {
            setOpen(true);
            setResult(null);
          }}
        >
          + Ask a vendor to quote
        </Button>
      </div>
    );
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-3 rounded-2xl shadow-[var(--shadow-card)] border border-line bg-paper p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const get = (k: string) => String(f.get(k) ?? "").trim();
        start(async () => {
          const r = await inviteVendorAction({
            eventId,
            vendorId: get("vendorId"),
            categoryId: department || undefined,
            scopeOfWork: get("scopeOfWork"),
            functionIds: fnIds,
            reportingDate: get("reportingDate"),
            reportingTime: get("reportingTime"),
          });
          setResult(r);
          if (r.ok) setOpen(false);
        });
      }}
    >
      <h3 className="label-mono text-[12.5px]">Ask a vendor to quote</h3>
      {result && !result.ok && <Notice tone="error">{result.error}</Notice>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SelectField
          label="Department"
          name="department"
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          options={[
            { value: "", label: "Any department" },
            ...departments.map((d) => ({ value: d.id, label: d.name })),
          ]}
        />
        <SelectField
          label="Vendor"
          name="vendorId"
          error={fe.vendorId}
          options={[
            {
              value: "",
              label: shown.length
                ? "Pick a vendor…"
                : "No vendors in this department",
            },
            ...shown.map((v) => ({
              value: v.id,
              label: `${v.name}${v.city ? ` · ${v.city}` : ""}`,
            })),
          ]}
        />
        <Field
          className="sm:col-span-2"
          label="The work"
          name="scopeOfWork"
          placeholder="Stage and mandap decor in marigold and white"
          error={fe.scopeOfWork}
        />
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className="label-mono mb-1 text-[12px]">
          For which functions
        </legend>
        <div className="flex flex-wrap gap-2">
          {functions.map((fn) => {
            const on = fnIds.includes(fn.id);
            return (
              <label
                key={fn.id}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-[14px] ${on ? "border-line bg-look" : "border-rule-soft"}`}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-plum"
                  checked={on}
                  onChange={() =>
                    setFnIds((ids) =>
                      on ? ids.filter((x) => x !== fn.id) : [...ids, fn.id],
                    )
                  }
                />
                <span>
                  <strong>{fn.name}</strong>{" "}
                  <span className="text-ink-quiet">{fn.when}</span>
                </span>
              </label>
            );
          })}
        </div>
        {fe.functionIds && (
          <span className="text-[13px] font-semibold text-now">
            {fe.functionIds}
          </span>
        )}
      </fieldset>
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <Field
          label="Reporting day (optional)"
          name="reportingDate"
          type="date"
        />
        <Field label="Reporting time" name="reportingTime" type="time" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send request"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Per-vendor actions on a booking: issue the work order, sign off delivered work, or withdraw. */
export function VendorRowActions({
  eventId,
  jobId,
  vendor,
  canIssue,
  canSignOff,
  canWithdraw,
}: {
  eventId: string;
  jobId: string;
  vendor: string;
  canIssue: boolean;
  canSignOff: boolean;
  canWithdraw: boolean;
}) {
  const [mode, setMode] = useState<"issue" | "withdraw" | null>(null);
  const [text, setText] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => setResult(await fn()));

  if (!canIssue && !canSignOff && !canWithdraw) return null;
  if (result?.ok)
    return (
      <span className="text-[12.5px] font-semibold text-ok-text">
        {result.message}
      </span>
    );

  if (mode) {
    return (
      <div className="flex min-w-[220px] flex-col gap-1.5">
        <label className="flex flex-col gap-1">
          <span className="label-mono text-[11px]">
            {mode === "issue" ? "Terms (optional)" : `Why withdraw ${vendor}?`}
          </span>
          <textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              mode === "issue"
                ? "50% advance, balance within 7 days of the event"
                : "Client dropped this"
            }
            className="rounded-xl border border-line bg-paper px-2 py-1.5 text-[13.5px]"
          />
        </label>
        <span className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            variant={mode === "withdraw" ? "danger" : "primary"}
            className="min-h-9 px-3 text-[11.5px]"
            disabled={pending || (mode === "withdraw" && !text.trim())}
            onClick={() =>
              run(() =>
                mode === "issue"
                  ? issueWorkOrderAction(eventId, jobId, text)
                  : cancelJobAction(eventId, jobId, text),
              )
            }
          >
            {pending
              ? "Saving…"
              : mode === "issue"
                ? "Send work order"
                : "Withdraw"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="min-h-9 px-3 text-[11.5px]"
            disabled={pending}
            onClick={() => setMode(null)}
          >
            Back
          </Button>
        </span>
        {result && !result.ok && (
          <span role="alert" className="text-[12.5px] font-semibold text-now">
            {result.error}
          </span>
        )}
      </div>
    );
  }

  return (
    <span className="flex flex-wrap justify-end gap-1.5">
      {canIssue && (
        <Button
          type="button"
          variant="look"
          className="min-h-9 px-3 text-[11.5px]"
          onClick={() => setMode("issue")}
        >
          Work order
        </Button>
      )}
      {canSignOff && (
        <Button
          type="button"
          className="min-h-9 px-3 text-[11.5px]"
          disabled={pending}
          onClick={() => run(() => signOffJobAction(eventId, jobId))}
        >
          {pending ? "Saving…" : "Sign off"}
        </Button>
      )}
      {canWithdraw && (
        <Button
          type="button"
          variant="ghost"
          className="min-h-9 px-2 text-[11.5px]"
          onClick={() => setMode("withdraw")}
        >
          Withdraw
        </Button>
      )}
      {result && !result.ok && (
        <span
          role="alert"
          className="w-full text-right text-[12.5px] font-semibold text-now"
        >
          {result.error}
        </span>
      )}
    </span>
  );
}
