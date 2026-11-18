"use client";

import { useState, useTransition } from "react";
import { Button, Field, Notice } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import { GST_RATES, priceLines } from "@/modules/vendors/pricing";
import { submitQuoteAction } from "../../actions";

interface Line {
  key: number;
  description: string;
  quantity: string;
  unit: string;
  rate: string;
  gstRate: string;
}

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);

export function QuoteForm({
  jobId,
  startFrom,
  isRevision,
}: {
  jobId: string;
  startFrom: {
    description: string;
    quantity: number;
    unit: string | null;
    rate: number;
    gstRate: number;
  }[];
  isRevision: boolean;
}) {
  const initial: Line[] = startFrom.length
    ? startFrom.map((l, i) => ({
        key: i,
        description: l.description,
        quantity: String(l.quantity),
        unit: l.unit ?? "",
        rate: String(l.rate),
        gstRate: String(l.gstRate),
      }))
    : [
        {
          key: 0,
          description: "",
          quantity: "1",
          unit: "",
          rate: "",
          gstRate: "18",
        },
      ];
  const [lines, setLines] = useState<Line[]>(initial);
  const [nextKey, setNextKey] = useState(initial.length);
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<ActionResult<{
    version: number;
    total: number;
  }> | null>(null);
  const [pending, start] = useTransition();

  const priced = priceLines(
    lines.map((l) => ({
      quantity: Number(l.quantity),
      rate: Number(l.rate),
      gstRate: Number(l.gstRate),
    })),
  );
  const fe = result && !result.ok ? (result.fieldErrors ?? {}) : {};
  const update = (key: number, patch: Partial<Line>) =>
    setLines((rows) =>
      rows.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );

  if (result?.ok) return <Notice tone="ok">{result.message}</Notice>;

  return (
    <form
      noValidate
      className="flex flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () =>
          setResult(
            await submitQuoteAction(jobId, {
              items: lines.map((l) => ({
                description: l.description,
                quantity: l.quantity,
                unit: l.unit || undefined,
                rate: l.rate,
                gstRate: l.gstRate,
              })),
              validUntil,
              notes: notes || undefined,
            }),
          ),
        );
      }}
    >
      {result && !result.ok && (
        <div className="px-3.5 pt-3">
          <Notice tone="error">{result.error}</Notice>
        </div>
      )}
      <ol className="flex flex-col">
        {lines.map((l, i) => (
          <li
            key={l.key}
            className="grid grid-cols-2 gap-2.5 border-b border-rule-soft px-3.5 py-3 sm:grid-cols-[minmax(0,2.2fr)_0.7fr_0.7fr_1fr_0.8fr_auto] sm:items-end"
          >
            <Field
              className="col-span-2 sm:col-span-1"
              label={`Line ${i + 1}`}
              name={`d-${l.key}`}
              value={l.description}
              onChange={(e) => update(l.key, { description: e.target.value })}
              placeholder="LED par cans with operator"
              error={fe[`items.${i}.description`]}
            />
            <Field
              label="Qty"
              name={`q-${l.key}`}
              inputMode="decimal"
              value={l.quantity}
              onChange={(e) => update(l.key, { quantity: e.target.value })}
              error={fe[`items.${i}.quantity`]}
            />
            <Field
              label="Unit"
              name={`u-${l.key}`}
              value={l.unit}
              onChange={(e) => update(l.key, { unit: e.target.value })}
              placeholder="pcs"
            />
            <Field
              label="Rate ₹"
              name={`r-${l.key}`}
              inputMode="decimal"
              value={l.rate}
              onChange={(e) => update(l.key, { rate: e.target.value })}
              error={fe[`items.${i}.rate`]}
            />
            <div className="flex flex-col gap-1">
              <label htmlFor={`g-${l.key}`} className="label-mono text-[12px]">
                GST
              </label>
              <select
                id={`g-${l.key}`}
                value={l.gstRate}
                onChange={(e) => update(l.key, { gstRate: e.target.value })}
                className="min-h-11 rounded-[3px] border-2 border-ink bg-paper px-2 text-[15px]"
              >
                {GST_RATES.map((g) => (
                  <option key={g} value={g}>
                    {g}%
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2 flex items-center justify-between gap-2 sm:col-span-1 sm:flex-col sm:items-end sm:justify-end">
              <span className="font-mono text-[14px] font-semibold">
                {inr(priced.lines[i].amount)}
              </span>
              <button
                type="button"
                disabled={lines.length === 1}
                onClick={() =>
                  setLines((rows) => rows.filter((r) => r.key !== l.key))
                }
                className="min-h-11 px-1 font-mono text-[11.5px] font-semibold text-plum uppercase disabled:opacity-40"
                aria-label={`Remove line ${i + 1}`}
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-col gap-3 px-3.5 py-3">
        <Button
          type="button"
          variant="secondary"
          className="self-start"
          onClick={() => {
            setLines((rows) => [
              ...rows,
              {
                key: nextKey,
                description: "",
                quantity: "1",
                unit: "",
                rate: "",
                gstRate: rows.at(-1)?.gstRate ?? "18",
              },
            ]);
            setNextKey((k) => k + 1);
          }}
        >
          + Add a line
        </Button>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[200px_minmax(0,1fr)]">
          <Field
            label="Valid until (optional)"
            name="validUntil"
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            error={fe.validUntil}
          />
          <div className="flex flex-col gap-1">
            <label htmlFor="q-notes" className="label-mono text-[12px]">
              Notes (optional)
            </label>
            <textarea
              id="q-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What's included, transport, payment terms"
              className="rounded-[3px] border-2 border-ink bg-paper px-3 py-2 text-[15px]"
            />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3 border-t-2 border-ink bg-ground px-3.5 py-3">
        <dl className="grid grid-cols-[auto_auto] gap-x-4 text-[13.5px]">
          <dt className="text-ink-quiet">Before GST</dt>
          <dd className="text-right font-mono">{inr(priced.subtotal)}</dd>
          <dt className="text-ink-quiet">GST</dt>
          <dd className="text-right font-mono">{inr(priced.tax)}</dd>
          <dt className="font-semibold">Total</dt>
          <dd
            className="text-right font-mono text-[18px] font-bold"
            aria-live="polite"
          >
            {inr(priced.total)}
          </dd>
        </dl>
        <Button type="submit" disabled={pending} className="min-h-12 px-6">
          {pending ? "Sending…" : isRevision ? "Send new quote" : "Send quote"}
        </Button>
      </div>
    </form>
  );
}
