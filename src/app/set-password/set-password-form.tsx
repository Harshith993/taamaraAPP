"use client";

import { useActionState, useEffect } from "react";
import { Button, Field, Notice } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import { setPasswordAction } from "./actions";

export function SetPasswordForm({ firstTime }: { firstTime: boolean }) {
  const [state, action, pending] = useActionState<ActionResult<{ home: string }> | null, FormData>(setPasswordAction, null);

  useEffect(() => {
    if (state?.ok && state.data) window.location.assign(state.data.home);
  }, [state]);

  const err = state && !state.ok ? state : null;
  return (
    <form action={action} className="flex flex-col gap-4 rounded-2xl shadow-[var(--shadow-card)] border border-line bg-paper p-5">
      <p className="text-[14.5px]">
        {firstTime ? "A host set up your login with a temporary password. Choose your own now; only you will know it." : "Choose a new password. You will stay signed in on this device only."}
      </p>
      {err && <Notice tone="error">{err.error}</Notice>}
      <Field label={firstTime ? "Temporary password" : "Current password"} name="current" type="password" autoComplete="current-password" error={err?.fieldErrors?.current} required />
      <Field label="New password" name="next" type="password" autoComplete="new-password" hint="At least 8 characters." error={err?.fieldErrors?.next} required />
      <Field label="New password again" name="confirm" type="password" autoComplete="new-password" error={err?.fieldErrors?.confirm} required />
      <Button type="submit" disabled={pending} className="min-h-12">
        {pending ? "Saving…" : "Save password"}
      </Button>
    </form>
  );
}
