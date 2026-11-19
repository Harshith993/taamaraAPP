"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import { decideAction } from "./actions";

export function DecisionButtons({ id, canRevise, warning }: { id: string; canRevise: boolean; warning?: string | null }) {
  const [mode, setMode] = useState<"REJECT" | "REVISE" | null>(null);
  const [comment, setComment] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  if (result?.ok) {
    return (
      <p role="status" className="text-[14px] font-semibold text-ok-text">
        {result.message}
      </p>
    );
  }

  const decide = (decision: "APPROVE" | "REJECT" | "REVISE") => start(async () => setResult(await decideAction(id, decision, comment)));

  return (
    <div className="flex flex-col gap-2">
      {warning && <p className="text-[13px] font-semibold text-now">{warning}</p>}
      {mode && (
        <label className="flex flex-col gap-1">
          <span className="label-mono text-[11.5px]">{mode === "REVISE" ? "What should they change?" : "Why not?"}</span>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} className="rounded-xl border border-line bg-paper px-3 py-2 text-[14px]" />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        {mode ? (
          <>
            <Button type="button" variant={mode === "REJECT" ? "danger" : "primary"} disabled={pending || !comment.trim()} onClick={() => decide(mode)}>
              {mode === "REVISE" ? "Send back" : "Confirm not approved"}
            </Button>
            <Button type="button" variant="secondary" disabled={pending} onClick={() => setMode(null)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button type="button" disabled={pending} onClick={() => decide("APPROVE")}>
              {pending ? "Saving…" : "Approve"}
            </Button>
            {canRevise && (
              <Button type="button" variant="secondary" disabled={pending} onClick={() => setMode("REVISE")}>
                Ask to revise
              </Button>
            )}
            <Button type="button" variant="danger" disabled={pending} onClick={() => setMode("REJECT")}>
              Don&apos;t approve
            </Button>
          </>
        )}
      </div>
      {result && !result.ok && (
        <p role="alert" className="text-[13.5px] font-semibold text-now">
          {result.error}
        </p>
      )}
    </div>
  );
}
