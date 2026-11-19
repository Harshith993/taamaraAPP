"use client";

import { useMemo, useState, useTransition } from "react";
import { Button, Notice } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import { PERMISSION_LIST, type Scope } from "@/modules/identity/permissions";
import { updateRoleGrantsAction } from "../actions";

/** Powers that stay with owners whatever is ticked here. */
const OWNER_ONLY = new Set(["admin.users", "admin.settings", "approvals.decide", "quotes.approve", "bookings.assignTeam", "bookings.cancel", "bookings.delete", "documents.confidential", "audit.view"]);

const SCOPE_WORDS: Record<Scope, string> = { ALL: "All records", ASSIGNED: "Their bookings", OWN: "Their own" };

export interface EditableRole {
  key: string;
  name: string;
  description: string | null;
  userCount: number;
  grants: Record<string, Scope>;
}

export function RoleEditor({ roles }: { roles: EditableRole[] }) {
  const [active, setActive] = useState(roles[0]?.key ?? "");
  const [drafts, setDrafts] = useState<Record<string, Record<string, Scope>>>(() => Object.fromEntries(roles.map((r) => [r.key, { ...r.grants }])));
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  const internalPermissions = useMemo(() => PERMISSION_LIST.filter((p) => p.accountTypes.includes("INTERNAL")), []);
  const groups = useMemo(() => {
    const m = new Map<string, typeof internalPermissions>();
    for (const p of internalPermissions) m.set(p.group, [...(m.get(p.group) ?? []), p]);
    return [...m.entries()];
  }, [internalPermissions]);

  const role = roles.find((r) => r.key === active);
  const draft = drafts[active] ?? {};
  const dirty = role ? JSON.stringify(Object.entries(draft).sort()) !== JSON.stringify(Object.entries(role.grants).sort()) : false;

  function setScope(key: string, value: string) {
    setResult(null);
    setDrafts((d) => {
      const next = { ...(d[active] ?? {}) };
      if (value === "") delete next[key];
      else next[key] = value as Scope;
      return { ...d, [active]: next };
    });
  }

  return (
    <div className="flex flex-col">
      <div role="tablist" aria-label="Role" className="flex flex-wrap border-b-2 border-ink bg-ground">
        {roles.map((r) => (
          <button
            key={r.key}
            role="tab"
            type="button"
            aria-selected={r.key === active}
            onClick={() => {
              setActive(r.key);
              setResult(null);
            }}
            className={`min-h-11 px-4 font-mono text-[12.5px] font-semibold tracking-[0.06em] uppercase ${r.key === active ? "bg-look text-ink" : "text-ink-quiet hover:text-ink"}`}
          >
            {r.name} · {r.userCount}
          </button>
        ))}
      </div>

      {role && (
        <div className="flex flex-col gap-3 p-3.5">
          <p className="text-[14px] text-ink-quiet">{role.description}</p>
          {result && <Notice tone={result.ok ? "ok" : "error"}>{result.ok ? result.message : result.error}</Notice>}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-[14px]">
              <tbody>
                {groups.map(([group, perms]) => (
                  <GroupRows key={group} group={group} perms={perms} draft={draft} setScope={setScope} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="secondary" disabled={!dirty || pending} onClick={() => setDrafts((d) => ({ ...d, [active]: { ...role.grants } }))}>
              Undo changes
            </Button>
            <Button type="button" disabled={!dirty || pending} onClick={() => start(async () => setResult(await updateRoleGrantsAction(active, draft)))}>
              {pending ? "Saving…" : `Save ${role.name}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function GroupRows({ group, perms, draft, setScope }: { group: string; perms: typeof PERMISSION_LIST; draft: Record<string, Scope>; setScope: (k: string, v: string) => void }) {
  return (
    <>
      <tr>
        <th colSpan={2} scope="colgroup" className="label-mono bg-ground px-3 pt-3 pb-1.5 text-left text-[12px] text-plum">
          {group}
        </th>
      </tr>
      {perms.map((p) => {
        const locked = OWNER_ONLY.has(p.key);
        const id = `perm-${p.key}`;
        return (
          <tr key={p.key} className="border-b border-rule-soft">
            <th scope="row" className="px-3 py-2 text-left font-semibold">
              <label htmlFor={id}>
                {p.label}
                {p.financial && <span className="ml-2 label-mono text-[10px] text-ink-quiet">MONEY</span>}
              </label>
            </th>
            <td className="w-56 px-3 py-1.5">
              {locked ? (
                <span className="label-mono text-[11px] text-ink-quiet">Hosts only</span>
              ) : (
                <select id={id} value={draft[p.key] ?? ""} onChange={(e) => setScope(p.key, e.target.value)} className="min-h-11 w-full rounded-[3px] border-2 border-ink bg-paper px-2 text-[14px]">
                  <option value="">No access</option>
                  {p.scopes.map((s) => (
                    <option key={s} value={s}>
                      {SCOPE_WORDS[s]}
                    </option>
                  ))}
                </select>
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}
