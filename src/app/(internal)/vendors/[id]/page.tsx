import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BankForm, ConfirmBank, EditVendor } from "@/components/directory-forms";
import { EmptyState, Panel, Tag } from "@/components/ui";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { formatCalendarDate, formatDate, formatINR } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { VENDOR_STAGE_WORDS } from "@/modules/events/labels";
import { can } from "@/modules/identity/policy";
import { requirePermission } from "@/modules/identity/session";
import { getVendor } from "@/modules/vendors/directory";

export const metadata: Metadata = { title: "Vendor" };

export default async function VendorProfile({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission("vendors.view");
  const { id } = await params;
  let v;
  try {
    v = await getVendor(db, actor, id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const departments = await db.vendorCategory.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } });
  const seesTax = can(actor, "vendors.bank");
  const canEdit = actor.grants.get("vendors.edit") === "ALL";

  return (
    <div className="flex flex-col gap-4">
      <Link href="/vendors" className="label-mono text-[12px] no-underline">
        ← Vendors
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="flex flex-wrap gap-1.5">
            {v.departments.map((d) => (
              <span key={d.id} className="px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase" style={{ background: d.color }}>
                {d.name}
              </span>
            ))}
            {v.status !== "ACTIVE" && <Tag tone={v.status === "BLACKLISTED" ? "now" : "quiet"}>{v.status}</Tag>}
          </span>
          <h1 className="font-condensed text-[clamp(30px,3.6vw,42px)] leading-[0.95] uppercase">{v.company}</h1>
          <p className="text-[14px] text-ink-quiet">
            {v.contact}
            {v.phone ? ` · ${formatPhone(v.phone)}` : ""}
            {v.city ? ` · ${v.city}` : ""}
            {v.rating ? ` · rated ${v.rating.toFixed(1)}/5` : ""}
          </p>
        </div>
        {canEdit && (
          <EditVendor
            departments={departments}
            seesTax={seesTax}
            initial={{ id: v.id, companyName: v.company, contactName: v.contact, phone: v.phone ?? "", whatsapp: v.whatsapp && v.whatsapp !== v.phone ? v.whatsapp : "", email: v.email ?? "", city: v.city ?? "", address: v.address ?? "", services: v.services ?? "", categoryIds: v.departments.map((d) => d.id), gstin: v.gstin ?? "", pan: v.pan ?? "", status: v.status, notes: v.notes ?? "" }}
          />
        )}
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-4">
          <Panel title={`Jobs · ${v.jobs.length}`}>
            {v.jobs.length === 0 ? (
              <EmptyState title="No jobs yet">Ask them to quote from a booking&apos;s Vendors tab.</EmptyState>
            ) : (
              <ul>
                {v.jobs.map((j) => (
                  <li key={j.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-rule-soft px-3.5 py-2.5 last:border-b-0">
                    <span className="flex flex-col leading-tight">
                      <Link href={`/bookings/${j.event.id}?tab=vendors`} className="text-[14.5px] font-semibold">
                        {j.event.name}
                      </Link>
                      <span className="text-[12.5px] text-ink-quiet">
                        {j.scope}
                        {j.event.startDate ? ` · ${formatCalendarDate(j.event.startDate, { day: "numeric", month: "short", year: "numeric" })}` : ""}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block font-mono text-[11.5px] font-semibold uppercase">{VENDOR_STAGE_WORDS[j.status] ?? j.status}</span>
                      {j.agreed !== null && <span className="font-mono text-[13px]">{formatINR(j.agreed)}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {v.notes && (
            <Panel title="Team notes">
              <p className="px-3.5 py-3 text-[14.5px] whitespace-pre-line">{v.notes}</p>
            </Panel>
          )}
        </div>
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
          <Panel title="Details">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-3.5 py-3 text-[14px]">
              {v.services && (
                <>
                  <dt className="text-ink-quiet">Does</dt>
                  <dd>{v.services}</dd>
                </>
              )}
              {v.whatsapp && v.whatsapp !== v.phone && (
                <>
                  <dt className="text-ink-quiet">WhatsApp</dt>
                  <dd>{formatPhone(v.whatsapp)}</dd>
                </>
              )}
              {v.email && (
                <>
                  <dt className="text-ink-quiet">Email</dt>
                  <dd>{v.email}</dd>
                </>
              )}
              {v.address && (
                <>
                  <dt className="text-ink-quiet">Address</dt>
                  <dd>{v.address}</dd>
                </>
              )}
              {seesTax && (
                <>
                  <dt className="text-ink-quiet">GSTIN</dt>
                  <dd className="font-mono">{v.gstin ?? "not given"}</dd>
                  <dt className="text-ink-quiet">PAN</dt>
                  <dd className="font-mono">{v.pan ?? "not given"}</dd>
                </>
              )}
            </dl>
          </Panel>
          {seesTax && v.bank?.needsCheck && (
            <div className="flex flex-col gap-2 rounded-[4px] border-2 border-now bg-[#B5391C12] p-3.5">
              <p className="text-[14px] font-semibold text-now">
                {v.company} changed their bank details{v.bank.changedByVendorAt ? ` on ${formatDate(v.bank.changedByVendorAt, { day: "numeric", month: "short" })}` : ""}. Payments wait until someone calls them on their usual number and confirms.
              </p>
              {actor.grants.get("vendors.bank") === "ALL" && <ConfirmBank vendorId={v.id} />}
            </div>
          )}
          {seesTax && (
            <Panel title="Bank">
              {v.bank ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-3.5 py-3 text-[14px]">
                  <dt className="text-ink-quiet">Account</dt>
                  <dd>
                    {v.bank.accountName}
                    {v.bank.last4 ? <span className="font-mono"> · ••••{v.bank.last4}</span> : ""}
                  </dd>
                  {v.bank.ifsc && (
                    <>
                      <dt className="text-ink-quiet">IFSC</dt>
                      <dd className="font-mono">{v.bank.ifsc}</dd>
                    </>
                  )}
                  {v.bank.upiId && (
                    <>
                      <dt className="text-ink-quiet">UPI</dt>
                      <dd className="font-mono">{v.bank.upiId}</dd>
                    </>
                  )}
                </dl>
              ) : (
                <p className="px-3.5 py-3 text-[14px] text-ink-quiet">No bank details yet.</p>
              )}
              {actor.grants.get("vendors.bank") === "ALL" && <BankForm vendorId={v.id} initial={v.bank ? { accountName: v.bank.accountName ?? "", last4: v.bank.last4, ifsc: v.bank.ifsc ?? "", upiId: v.bank.upiId ?? "" } : null} />}
            </Panel>
          )}
          <Panel title="App logins">
            <div className="flex flex-col gap-1.5 px-3.5 py-3 text-[14px]">
              {v.logins.length === 0 && <p className="text-ink-quiet">No login yet. They can still be asked for quotes; the accountant can enter paper quotes and invoices.</p>}
              {v.logins.map((u) => (
                <p key={u.id}>
                  <strong>{u.name}</strong>
                  {u.phoneNumber ? ` · ${formatPhone(u.phoneNumber)}` : ""}
                  <span className="text-ink-quiet"> · {u.status === "ACTIVE" ? (u.lastLoginAt ? `last in ${formatDate(u.lastLoginAt, { day: "numeric", month: "short" })}` : "not signed in yet") : "switched off"}</span>
                </p>
              ))}
              {can(actor, "admin.users") && (
                <Link href="/team" className="text-[13.5px] font-semibold">
                  Give them a login on the Team page →
                </Link>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
