import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BankForm, OwnProfileForm } from "@/components/directory-forms";
import { PortalShell } from "@/components/portal-shell";
import { Notice, Panel } from "@/components/ui";
import { db } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { can } from "@/modules/identity/policy";
import { homePathFor, requireActor } from "@/modules/identity/session";

export const metadata: Metadata = { title: "Your details" };

export default async function VendorProfilePage() {
  const actor = await requireActor();
  if (actor.accountType !== "VENDOR" || !actor.vendorIds[0]) redirect(homePathFor(actor));
  const v = await db.vendor.findUniqueOrThrow({
    where: { id: actor.vendorIds[0] },
    include: { categories: { select: { category: { select: { name: true } } } }, bankDetail: true, users: { select: { user: { select: { name: true, phoneNumber: true } } } } },
  });
  const seesBank = can(actor, "vendors.bank");
  return (
    <PortalShell title="Your details" subtitle={v.companyName} back={{ href: "/vendor", label: "All jobs" }}>
      <div className="flex flex-col gap-3.5">
        <Panel title="Company">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-3.5 py-3 text-[14.5px]">
            <dt className="text-ink-quiet">Name</dt>
            <dd className="font-semibold">{v.companyName}</dd>
            <dt className="text-ink-quiet">Phone</dt>
            <dd>{v.phone ? formatPhone(v.phone) : "—"}</dd>
            <dt className="text-ink-quiet">Work</dt>
            <dd>{v.categories.map((c) => c.category.name).join(", ")}</dd>
          </dl>
          <p className="border-t border-rule-soft px-3.5 py-2 text-[12.5px] text-ink-quiet">To change the name, phone or kind of work, please call Taamara Taamara.</p>
        </Panel>
        {can(actor, "vendors.edit") && (
          <Panel title="Contact and tax">
            <OwnProfileForm seesTax={seesBank} initial={{ contactName: v.contactName, email: v.email ?? "", address: v.address ?? "", services: v.services ?? "", gstin: v.gstin ?? "", pan: v.pan ?? "" }} />
          </Panel>
        )}
        {seesBank && (
          <Panel title="Bank details for payments">
            {v.bankDetail?.needsCheck && (
              <div className="px-3.5 pt-3">
                <Notice tone="info">Your new details are waiting for a confirmation call from Taamara Taamara.</Notice>
              </div>
            )}
            {v.bankDetail ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-3.5 py-3 text-[14.5px]">
                <dt className="text-ink-quiet">Account</dt>
                <dd>
                  {v.bankDetail.accountName}
                  {v.bankDetail.accountNumberLast4 ? <span className="font-mono"> · ••••{v.bankDetail.accountNumberLast4}</span> : ""}
                </dd>
                {v.bankDetail.ifsc && (
                  <>
                    <dt className="text-ink-quiet">IFSC</dt>
                    <dd className="font-mono">{v.bankDetail.ifsc}</dd>
                  </>
                )}
                {v.bankDetail.upiId && (
                  <>
                    <dt className="text-ink-quiet">UPI</dt>
                    <dd className="font-mono">{v.bankDetail.upiId}</dd>
                  </>
                )}
              </dl>
            ) : (
              <p className="px-3.5 py-3 text-[14px] text-ink-quiet">Add your bank account or UPI ID so payments reach you.</p>
            )}
            <BankForm vendorId={v.id} byVendor initial={v.bankDetail ? { accountName: v.bankDetail.accountName ?? "", last4: v.bankDetail.accountNumberLast4, ifsc: v.bankDetail.ifsc ?? "", upiId: v.bankDetail.upiId ?? "" } : null} />
          </Panel>
        )}
        <Panel title="Logins for your company">
          <ul className="px-3.5 py-3 text-[14.5px]">
            {v.users.map((u) => (
              <li key={u.user.phoneNumber ?? u.user.name}>
                {u.user.name}
                {u.user.phoneNumber ? ` · ${formatPhone(u.user.phoneNumber)}` : ""}
              </li>
            ))}
          </ul>
          <p className="border-t border-rule-soft px-3.5 py-2 text-[12.5px] text-ink-quiet">Need a login for someone on your team? Ask Taamara Taamara.</p>
        </Panel>
      </div>
    </PortalShell>
  );
}
