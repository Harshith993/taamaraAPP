"use client";

import { useState, useTransition } from "react";
import { updateSwitchesAction } from "@/app/actions/settings";
import { Button, Notice } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import type { CompanySwitches } from "@/modules/identity/actor";

type Labels = Record<keyof CompanySwitches, { label: string; help: string }>;

export function SwitchesForm({ initial, labels }: { initial: CompanySwitches; labels: Labels }) {
  const [v, setV] = useState(initial);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const toggles = (["crewCanSeePay", "proofFromGallery", "finalVendorPaymentNeedsProof", "clientInvoices"] as const).map((k) => (
    <label key={k} className="grid min-h-14 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-rule-soft px-3.5 py-3 last:border-b-0">
      <span className="flex flex-col">
        <span className="text-[15px] font-semibold">{labels[k].label}</span>
        <span className="text-[13px] text-ink-quiet">{labels[k].help}</span>
      </span>
      <span className="flex items-center gap-2">
        <span className={`text-[12.5px] font-semibold ${v[k] ? "text-[#15803d]" : "text-ink-quiet"}`}>{v[k] ? "On" : "Off"}</span>
        <input type="checkbox" role="switch" className="relative h-7 w-12 shrink-0 cursor-pointer appearance-none rounded-full bg-[#e7e5ef] shadow-[inset_0_1px_2px_rgb(22_20_31/0.12)] transition-colors duration-200 before:absolute before:top-1 before:left-1 before:size-5 before:rounded-full before:bg-white before:shadow-[0_1px_3px_rgb(22_20_31/0.3)] before:transition-transform before:duration-200 before:content-[''] checked:bg-[#22c55e] checked:before:translate-x-5" checked={v[k]} onChange={(e) => (setV({ ...v, [k]: e.target.checked }), setResult(null))} />
      </span>
    </label>
  ));
  return (
    <form
      className="flex flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await updateSwitchesAction(v)));
      }}
    >
      {toggles}
      <label className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-rule-soft px-3.5 py-3">
        <span className="flex flex-col">
          <span className="text-[15px] font-semibold">{labels.maxVideoSeconds.label}</span>
          <span className="text-[13px] text-ink-quiet">{labels.maxVideoSeconds.help}</span>
        </span>
        <input type="number" min={15} max={300} step={15} value={v.maxVideoSeconds} onChange={(e) => (setV({ ...v, maxVideoSeconds: Number(e.target.value) }), setResult(null))} className="min-h-11 w-24 rounded-xl border border-line bg-paper px-2 text-right font-mono text-[15px]" />
      </label>
      <div className="flex flex-wrap items-center gap-3 px-3.5 py-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
        {result && <Notice tone={result.ok ? "ok" : "error"}>{result.ok ? result.message : result.error}</Notice>}
      </div>
    </form>
  );
}
