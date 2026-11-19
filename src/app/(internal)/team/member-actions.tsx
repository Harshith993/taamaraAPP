"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import { resetPasswordAction, setRoleAction, setStatusAction } from "./actions";
import { suggestTemporaryPassword } from "./temp-password";

const INTERNAL_ROLES = [
  { value: "OWNER", label: "Host" },
  { value: "CO_HOST", label: "Co-host" },
  { value: "EVENT_MANAGER", label: "Event Manager" },
  { value: "ACCOUNTANT", label: "Accountant" },
  { value: "SUPERVISOR", label: "Supervisor" },
];

export function MemberActions({ userId, name, status, roleKey, accountType, isSelf }: { userId: string; name: string; status: "ACTIVE" | "DISABLED"; roleKey: string; accountType: string; isSelf: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [reset, setReset] = useState<string | null>(null);

  const run = (fn: () => Promise<ActionResult>) => start(async () => setResult(await fn()));

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <div className="flex flex-wrap justify-end gap-2">
        {accountType === "INTERNAL" && (
          <label className="flex items-center gap-1.5">
            <span className="sr-only">Role for {name}</span>
            <select
              defaultValue={roleKey}
              disabled={pending}
              onChange={(e) => run(() => setRoleAction(userId, e.target.value))}
              className="min-h-11 rounded-[3px] border-2 border-ink bg-paper px-2 text-[14px]"
            >
              {INTERNAL_ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button type="button" variant="secondary" disabled={pending} onClick={() => setReset(reset ? null : suggestTemporaryPassword())}>
          Reset password
        </Button>
        {!isSelf && (
          <Button
            type="button"
            variant={status === "ACTIVE" ? "danger" : "secondary"}
            disabled={pending}
            onClick={() => {
              if (status === "ACTIVE" && !window.confirm(`Switch off ${name}? They will be signed out everywhere.`)) return;
              run(() => setStatusAction(userId, status === "ACTIVE" ? "DISABLED" : "ACTIVE"));
            }}
          >
            {status === "ACTIVE" ? "Switch off" : "Switch on"}
          </Button>
        )}
      </div>
      {reset && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <label className="flex items-center gap-2 text-[13px]">
            New temporary password
            <input value={reset} onChange={(e) => setReset(e.target.value)} className="min-h-11 w-44 rounded-[3px] border-2 border-ink bg-paper px-2 font-mono text-[14px]" />
          </label>
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const r = await resetPasswordAction(userId, reset);
                if (r.ok) setReset(null);
                return r.ok ? { ...r, message: `${r.message} Temporary password: ${reset}` } : r;
              })
            }
          >
            Save
          </Button>
        </div>
      )}
      {result && (
        <p role={result.ok ? "status" : "alert"} className={`text-right text-[13px] font-semibold ${result.ok ? "text-ok-text" : "text-now"}`}>
          {result.ok ? result.message : result.error}
        </p>
      )}
    </div>
  );
}
