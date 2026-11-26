import type { Metadata } from "next";
import { ButtonLink, Panel, Tag } from "@/components/ui";
import { db } from "@/lib/db";
import { formatDate, formatTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { requirePermission } from "@/modules/identity/session";
import { listTeam } from "@/modules/identity/users";
import { AddPersonForm } from "./add-person-form";
import { MemberActions } from "./member-actions";

export const metadata: Metadata = { title: "Team" };

const KIND = { INTERNAL: "Staff", VENDOR: "Vendor", LABOUR: "Crew" } as const;

export default async function TeamPage() {
  const actor = await requirePermission("admin.users");
  const [team, vendors, workers] = await Promise.all([
    listTeam(db, actor),
    db.vendor.findMany({ where: { deletedAt: null, status: "ACTIVE" }, orderBy: { companyName: "asc" }, select: { id: true, companyName: true } }),
    db.worker.findMany({ where: { userId: null, deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, phone: true } }),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-condensed text-[clamp(32px,4vw,46px)] leading-[0.95]">Team</h1>
          <p className="mt-1 text-[15px] text-ink-quiet">Everyone who can sign in. Only hosts see this page.</p>
        </div>
        <ButtonLink href="/team/roles" variant="secondary">
          What each role can do →
        </ButtonLink>
      </div>

      <Panel title="Add a person">
        <AddPersonForm vendors={vendors.map((v) => ({ id: v.id, name: v.companyName }))} workers={workers} />
      </Panel>

      <Panel title={`People · ${team.length}`}>
        <ul>
          {team.map((u) => {
            const role = u.roles[0]?.role;
            return (
              <li key={u.id} className={`grid grid-cols-1 gap-3 border-b border-rule-soft px-3.5 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${u.status === "DISABLED" ? "opacity-60" : ""}`}>
                <div className="flex min-w-0 flex-col gap-1 leading-tight">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-bold">{u.name}</span>
                    {u.id === actor.userId && <Tag tone="look">YOU</Tag>}
                    <Tag tone="outline">{(role?.key === "OWNER" ? (u.title ?? "Host") : (role?.name ?? "No role")).toUpperCase()}</Tag>
                    <span className="label-mono text-[10.5px] text-ink-quiet">{KIND[u.accountType]}</span>
                    {u.status === "DISABLED" && <Tag tone="now">SWITCHED OFF</Tag>}
                    {u.mustChangePassword && u.status === "ACTIVE" && <Tag tone="quiet">FIRST SIGN-IN PENDING</Tag>}
                  </span>
                  <span className="text-[13px] text-ink-quiet">
                    {formatPhone(u.phoneNumber)}
                    {u.hasRealEmail ? ` · ${u.email}` : ""}
                    {u.vendorLinks.length ? ` · ${u.vendorLinks.map((v) => v.vendor.companyName).join(", ")}` : ""}
                  </span>
                  <span className="text-[12.5px] text-ink-quiet">{u.lastLoginAt ? `Last signed in ${formatDate(u.lastLoginAt)} ${formatTime(u.lastLoginAt)}` : "Never signed in"}</span>
                </div>
                <MemberActions userId={u.id} name={u.name} status={u.status} roleKey={role?.key === "OWNER" && u.title === "Co-host" ? "CO_HOST" : (role?.key ?? "")} accountType={u.accountType} isSelf={u.id === actor.userId} />
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}
