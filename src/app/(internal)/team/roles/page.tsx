import type { Metadata } from "next";
import { ButtonLink, Panel } from "@/components/ui";
import { db } from "@/lib/db";
import { listRoles } from "@/modules/identity/roles";
import { requirePermission } from "@/modules/identity/session";
import { RoleEditor } from "./role-editor";

export const metadata: Metadata = { title: "Roles and permissions" };

export default async function RolesPage() {
  const actor = await requirePermission("admin.users");
  const roles = await listRoles(db, actor);
  const editable = roles.filter((r) => r.editable);
  const fixed = roles.filter((r) => !r.editable);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-condensed text-[clamp(32px,4vw,46px)] leading-[0.95]">WHAT EACH ROLE CAN DO</h1>
          <p className="mt-1 max-w-prose text-[15px] text-ink-quiet">
            &ldquo;Their bookings&rdquo; means only the bookings a person is assigned to. Changes apply the next time they open a page, and every change is kept in the audit log.
          </p>
        </div>
        <ButtonLink href="/team" variant="secondary">
          ← Team
        </ButtonLink>
      </div>

      <Panel title="Editable roles">
        <RoleEditor roles={editable.map((r) => ({ key: r.key, name: r.name, description: r.description, userCount: r.userCount, grants: r.grants }))} />
      </Panel>

      <Panel title="Fixed roles">
        <ul>
          {fixed.map((r) => (
            <li key={r.key} className="border-b border-rule-soft px-3.5 py-3 last:border-b-0">
              <p className="text-[15px] font-bold">
                {r.name} <span className="label-mono ml-2 text-[11px] text-ink-quiet">{r.userCount} people</span>
              </p>
              <p className="text-[13.5px] text-ink-quiet">{r.description}</p>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
