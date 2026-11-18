"use client";

import { useState, useTransition } from "react";
import { Button, Notice } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import {
  acceptWorkOrderAction,
  declineJobAction,
  reportProgressAction,
} from "../../actions";

function useAction() {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  return {
    result,
    pending,
    run: (fn: () => Promise<ActionResult>) =>
      start(async () => setResult(await fn())),
  };
}

function Outcome({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return result.ok ? (
    <Notice tone="ok">{result.message}</Notice>
  ) : (
    <Notice tone="error">{result.error}</Notice>
  );
}

export function DeclineJob({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { result, pending, run } = useAction();
  if (result?.ok) return <Outcome result={result} />;
  if (!open)
    return (
      <Button
        type="button"
        variant="ghost"
        onClick={() => setOpen(true)}
        className="self-start px-0"
      >
        Can&apos;t do this job? Decline
      </Button>
    );
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className="label-mono text-[12px]">
          Why can&apos;t you take it?
        </span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="Booked elsewhere that night"
          className="rounded-[3px] border-2 border-ink bg-paper px-3 py-2 text-[15px]"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="danger"
          disabled={pending || !reason.trim()}
          onClick={() => run(() => declineJobAction(jobId, reason))}
        >
          {pending ? "Saving…" : "Decline job"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => setOpen(false)}
        >
          Keep it
        </Button>
      </div>
      <Outcome result={result} />
    </div>
  );
}

export function AcceptWorkOrder({
  jobId,
  number,
}: {
  jobId: string;
  number: string;
}) {
  const { result, pending, run } = useAction();
  if (result?.ok) return <Outcome result={result} />;
  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="look"
        className="min-h-12"
        disabled={pending}
        onClick={() => run(() => acceptWorkOrderAction(jobId))}
      >
        {pending ? "Saving…" : `Accept work order ${number}`}
      </Button>
      <Outcome result={result} />
    </div>
  );
}

export function ProgressButton({
  jobId,
  stage,
}: {
  jobId: string;
  stage: "IN_PROGRESS" | "DELIVERED";
}) {
  const [note, setNote] = useState("");
  const { result, pending, run } = useAction();
  if (result?.ok) return <Outcome result={result} />;
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className="label-mono text-[12px]">
          Note for the team (optional)
        </span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={
            stage === "IN_PROGRESS"
              ? "Truck reached the venue"
              : "All lights tested"
          }
          className="min-h-11 rounded-[3px] border-2 border-ink bg-paper px-3 text-[15px]"
        />
      </label>
      <Button
        type="button"
        variant={stage === "DELIVERED" ? "look" : "primary"}
        className="min-h-12"
        disabled={pending}
        onClick={() => run(() => reportProgressAction(jobId, stage, note))}
      >
        {pending
          ? "Saving…"
          : stage === "IN_PROGRESS"
            ? "We've started"
            : "Work is done"}
      </Button>
      <Outcome result={result} />
    </div>
  );
}
