"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addBudgetLineAction, removeBudgetLineAction, reviseBudgetAction, submitBudgetAction } from "@/app/actions/finance";
import { Button, Field, SelectField } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";

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

function Says({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return <span className={`text-[12.5px] font-semibold ${result.ok ? "text-ok-text" : "text-now"}`}>{result.ok ? result.message : result.error}</span>;
}

export function BudgetLineForm({ eventId, categories }: { eventId: string; categories: { id: string; name: string }[] }) {
  const { result, pending, run, fe } = useRun();
  return (
    <form
      noValidate
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        run(() => addBudgetLineAction(eventId, { categoryId: String(f.get("categoryId") ?? ""), description: String(f.get("description") ?? ""), estimatedAmount: String(f.get("estimatedAmount") ?? "") }), () => form.reset());
      }}
    >
      <SelectField label="Kind of cost" name="categoryId" error={fe.categoryId} options={[{ value: "", label: "Pick…" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]} />
      <Field label="What (optional)" name="description" placeholder="Decor, lights and sound" />
      <Field label="Estimate ₹" name="estimatedAmount" inputMode="numeric" error={fe.estimatedAmount} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Adding…" : "Add line"}
      </Button>
      <Says result={result && !result.ok ? result : null} />
    </form>
  );
}

export function RemoveBudgetLine({ eventId, lineId }: { eventId: string; lineId: string }) {
  const { pending, run, result } = useRun();
  return (
    <span className="flex flex-col items-end">
      <Button type="button" variant="ghost" className="min-h-9 px-2 text-[11.5px]" disabled={pending} onClick={() => run(() => removeBudgetLineAction(eventId, lineId))}>
        Remove
      </Button>
      <Says result={result && !result.ok ? result : null} />
    </span>
  );
}

export function BudgetButtons({ eventId, mode }: { eventId: string; mode: "submit" | "revise" }) {
  const { pending, run, result } = useRun();
  return (
    <span className="flex flex-wrap items-center gap-2">
      {mode === "submit" ? (
        <Button type="button" disabled={pending} onClick={() => run(() => submitBudgetAction(eventId))}>
          {pending ? "Sending…" : "Send to the owners"}
        </Button>
      ) : (
        <Button type="button" variant="secondary" disabled={pending} onClick={() => run(() => reviseBudgetAction(eventId))}>
          {pending ? "Starting…" : "Change the budget"}
        </Button>
      )}
      <Says result={result} />
    </span>
  );
}
