import { redirect } from "next/navigation";
import { AppHeader, type NavItem } from "@/components/app-header";
import { db } from "@/lib/db";
import { ROLES } from "@/modules/identity/permissions";
import { can } from "@/modules/identity/policy";
import { homePathFor, requireActor } from "@/modules/identity/session";
import { proofToCheckCount } from "@/modules/proof/service";
import { invoicesToCheckCount } from "@/modules/vendors/invoices";

/** Internal staff only: owners, event managers, the accountant and supervisors. */
export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  if (actor.accountType !== "INTERNAL") redirect(homePathFor(actor));

  // Only pages that exist and that this person may open appear in the menu.
  const items: NavItem[] = [{ href: "/home", label: "Home" }];
  if (can(actor, "bookings.view")) items.push({ href: "/bookings", label: "Bookings" });
  if (can(actor, "attendance.mark")) items.push({ href: "/event-day", label: "Event day" });
  if (can(actor, "proof.view")) items.push({ href: "/proof", label: "Proof", badge: await proofToCheckCount(db, actor) });
  if (can(actor, "payments.prepare")) items.push({ href: "/invoices", label: "Invoices", badge: await invoicesToCheckCount(db, actor) });
  if (can(actor, "approvals.decide")) {
    items.push({ href: "/approvals", label: "Approvals", badge: await db.approvalRequest.count({ where: { state: "PENDING" } }) });
  }
  if (can(actor, "admin.users")) items.push({ href: "/team", label: "Team" });
  if (can(actor, "admin.settings")) items.push({ href: "/settings", label: "Settings" });

  const roleLabel = actor.isOwner ? "Owner" : actor.roles.map((r) => ROLES[r].name).join(" · ");
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader name={actor.name} roleLabel={roleLabel} items={items} />
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-5 pb-10 sm:px-8">{children}</main>
    </div>
  );
}
