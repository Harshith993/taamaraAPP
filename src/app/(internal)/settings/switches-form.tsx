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
  const toggles = (["crewSelfCheckIn", "crewCanSeePay", "proofFromGallery", "finalVendorPaymentNeedsProof", "clientInvoices"] as const).map((k) => (
    <label key={k} className="grid min-h-14 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-rule-soft px-3.5 py-3 last:border-b-0">
      <span className="flex flex-col">
        <span className="text-[15px] font-semibold">{labels[k].label}</span>
        <span className="text-[13px] text-ink-quiet">{labels[k].help}</span>
      </span>
      <span className="flex items-center gap-2">
        <span className="font-mono text-[11.5px] font-semibold uppercase">{v[k] ? "On" : "Off"}</span>
        <input type="checkbox" role="switch" className="h-6 w-6 accent-plum" checked={v[k]} onChange={(e) => (setV({ ...v, [k]: e.target.checked }), setResult(null))} />
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
