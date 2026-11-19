"use client";

import { useActionState, useState } from "react";
import { Button, Field, Notice, SelectField } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import { addPersonAction } from "./actions";
import { suggestTemporaryPassword } from "./temp-password";

const ROLE_OPTIONS = [
  { value: "EVENT_MANAGER", label: "Event Manager" },
  { value: "SUPERVISOR", label: "Supervisor" },
  { value: "ACCOUNTANT", label: "Accountant" },
  { value: "OWNER", label: "Host (full access)" },
  { value: "CO_HOST", label: "Co-host (full access)" },
  { value: "VENDOR", label: "Vendor login" },
  { value: "LABOUR", label: "Crew login" },
];

type Result = ActionResult<{ name: string; login: string; password: string }>;

export function AddPersonForm({ vendors, workers }: { vendors: { id: string; name: string }[]; workers: { id: string; name: string; phone: string }[] }) {
  const [state, action, pending] = useActionState<Result | null, FormData>(addPersonAction, null);
  const [role, setRole] = useState("EVENT_MANAGER");
  const [password, setPassword] = useState(() => suggestTemporaryPassword());
  const err = state && !state.ok ? state : null;
  const done = state && state.ok ? state.data : null;

  return (
    <form
      action={action}
      key={done ? `${done.login}` : "new"}
      className="grid grid-cols-1 gap-3 p-3.5 sm:grid-cols-2 lg:grid-cols-3"
      onSubmit={() => undefined}
    >
      {done && (
        <div className="sm:col-span-2 lg:col-span-3">
          <Notice tone="ok">
            Added {done.name}. Share this with them: sign in with <strong>{done.login}</strong> and the temporary password <strong className="font-mono">{done.password}</strong>. They will choose their own on first sign-in.
          </Notice>
        </div>
      )}
      {err && (
        <div className="sm:col-span-2 lg:col-span-3">
          <Notice tone="error">{err.error}</Notice>
        </div>
      )}
      <Field label="Name" name="name" autoComplete="off" required error={err?.fieldErrors?.name} />
      <Field label="Mobile number" name="phone" inputMode="tel" placeholder="98100 00005" required error={err?.fieldErrors?.phone} />
      <Field label="Email (optional)" name="email" type="email" autoComplete="off" error={err?.fieldErrors?.email} hint="Crew and vendors can sign in with their phone only." />
      <SelectField label="Role" name="roleKey" options={ROLE_OPTIONS} value={role} onChange={(e) => setRole(e.target.value)} error={err?.fieldErrors?.roleKey} />
      {role === "VENDOR" && (
        <SelectField
          label="Vendor company"
          name="vendorId"
          options={[{ value: "", label: "Pick a vendor…" }, ...vendors.map((v) => ({ value: v.id, label: v.name }))]}
          error={err?.fieldErrors?.vendorId}
        />
      )}
      {role === "LABOUR" && (
        <SelectField
          label="Crew record"
          name="workerId"
          options={[{ value: "", label: "Create a new crew record" }, ...workers.map((w) => ({ value: w.id, label: `${w.name} · ${w.phone}` }))]}
        />
      )}
      <div className="flex items-end gap-2">
        <Field
          label="Temporary password"
          name="temporaryPassword"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="flex-1"
          autoComplete="off"
          error={err?.fieldErrors?.temporaryPassword}
        />
        <Button type="button" variant="secondary" onClick={() => setPassword(suggestTemporaryPassword())} aria-label="Suggest another temporary password">
          New
        </Button>
      </div>
      <div className="flex items-end">
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Adding…" : "Add person"}
        </Button>
      </div>
    </form>
  );
}
