"use client";

/** Task buttons (start, done, sign off / send back) and the "Add a task" form. */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createTaskAction, moveTaskAction, reviewTaskAction } from "@/app/actions/tasks";
import { Button, ButtonLink, Field, Notice, SelectField } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";

export interface TaskButtonState {
  start: boolean;
  done: boolean;
  needsProofFirst: boolean;
  addProof: boolean;
  review: boolean;
}

export function TaskButtons({ taskId, actions, proofHref, size = "small" }: { taskId: string; actions: TaskButtonState; proofHref?: string | null; size?: "small" | "large" }) {
  const router = useRouter();
  const [sendingBack, setSendingBack] = useState(false);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult<unknown>>) =>
    start(async () => {
      const r = await fn();
      setResult(r);
      if (r.ok) {
        setSendingBack(false);
        setNote("");
        router.refresh();
      }
    });
  const btn = size === "large" ? "min-h-12 px-4 text-[12.5px]" : "min-h-9 px-3 text-[11.5px]";
  const any = actions.start || actions.done || actions.addProof || actions.review;
  if (!any) return null;

  return (
    <div className="flex flex-col items-stretch gap-1.5 sm:items-end">
      {sendingBack && (
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What still needs doing?" aria-label="What still needs doing" className="min-h-10 rounded-xl border border-line bg-paper px-2 text-[13.5px] sm:min-w-[240px]" />
      )}
      <span className="flex flex-wrap gap-1.5 sm:justify-end">
        {actions.addProof && proofHref && (
          <ButtonLink href={proofHref} variant="look" className={btn}>
            Add photo
          </ButtonLink>
        )}
        {actions.start && (
          <Button type="button" variant="secondary" className={btn} disabled={pending} onClick={() => run(() => moveTaskAction(taskId, "start"))}>
            Start
          </Button>
        )}
        {actions.done && (
          <Button type="button" className={btn} disabled={pending || actions.needsProofFirst} title={actions.needsProofFirst ? "Add a photo first" : undefined} onClick={() => run(() => moveTaskAction(taskId, "done"))}>
            {pending ? "Saving…" : "Done"}
          </Button>
        )}
        {actions.review &&
          (sendingBack ? (
            <>
              <Button type="button" variant="danger" className={btn} disabled={pending || !note.trim()} onClick={() => run(() => reviewTaskAction(taskId, "SEND_BACK", note))}>
                Send back
              </Button>
              <Button type="button" variant="secondary" className={btn} disabled={pending} onClick={() => setSendingBack(false)}>
                Back
              </Button>
            </>
          ) : (
            <>
              <Button type="button" className={btn} disabled={pending} onClick={() => run(() => reviewTaskAction(taskId, "APPROVE", ""))}>
                Sign off
              </Button>
              <Button type="button" variant="secondary" className={btn} disabled={pending} onClick={() => setSendingBack(true)}>
                Not done
              </Button>
            </>
          ))}
      </span>
      {actions.done && actions.needsProofFirst && <span className="text-[12px] text-ink-quiet">Needs a photo before it can be marked done.</span>}
      {result && !result.ok && (
        <span role="alert" className="text-[12.5px] font-semibold text-now">
          {result.error}
        </span>
      )}
    </div>
  );
}

export function AddTaskForm({ eventId, people, functions }: { eventId: string; people: { id: string; name: string; group: string }[]; functions: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const fe = result && !result.ok ? (result.fieldErrors ?? {}) : {};

  if (!open)
    return (
      <div className="flex flex-col gap-2">
        {result?.ok && <Notice tone="ok">{result.message}</Notice>}
        <Button type="button" variant="secondary" className="self-start" onClick={() => (setOpen(true), setResult(null))}>
          + Add a task
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
        const get = (k: string) => String(f.get(k) ?? "").trim();
        start(async () => {
          const r = await createTaskAction({
            eventId,
            title: get("title"),
            assigneeId: get("assigneeId") || undefined,
            functionId: get("functionId") || undefined,
            priority: (get("priority") || "MEDIUM") as "LOW" | "MEDIUM" | "HIGH" | "URGENT",
            dueDate: get("dueDate"),
            dueTime: get("dueTime"),
            needsProof: f.get("needsProof") === "on",
            needsApproval: f.get("needsApproval") === "on",
          });
          setResult(r);
          if (r.ok) {
            setOpen(false);
            router.refresh();
          }
        });
      }}
    >
      <h3 className="label-mono text-[12.5px]">Add a task</h3>
      {result && !result.ok && <Notice tone="error">{result.error}</Notice>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field className="sm:col-span-2" label="What needs doing" name="title" placeholder="Stage side drapes in ivory" error={fe.title} />
        <SelectField label="For" name="assigneeId" error={fe.assigneeId} options={[{ value: "", label: "Nobody yet" }, ...people.map((p) => ({ value: p.id, label: `${p.name} · ${p.group}` }))]} />
        <SelectField label="Function" name="functionId" options={[{ value: "", label: "Whole booking" }, ...functions.map((f) => ({ value: f.id, label: f.name }))]} />
        <Field label="Due day" name="dueDate" type="date" />
        <Field label="Due time" name="dueTime" type="time" />
        <SelectField
          label="Priority"
          name="priority"
          defaultValue="MEDIUM"
          options={[
            { value: "LOW", label: "Low" },
            { value: "MEDIUM", label: "Medium" },
            { value: "HIGH", label: "High" },
            { value: "URGENT", label: "Urgent" },
          ]}
        />
      </div>
      <div className="flex flex-wrap gap-4 text-[14px]">
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" name="needsProof" className="h-5 w-5 accent-plum" /> Needs a photo or video
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" name="needsApproval" className="h-5 w-5 accent-plum" /> Needs sign-off
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add task"}
        </Button>
        <Button type="button" variant="secondary" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
