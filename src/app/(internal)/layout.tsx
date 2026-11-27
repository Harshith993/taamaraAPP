import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { CommandPalette } from "@/components/shell/command-palette";
import { MobileNav } from "@/components/shell/mobile-nav";
import type { NavItem } from "@/components/shell/nav-icons";
import { Sidebar } from "@/components/shell/sidebar";
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
  const items: NavItem[] = [{ href: "/home", label: "Home", group: "Work" }];
  if (can(actor, "bookings.view")) items.push({ href: "/bookings", label: "Bookings", group: "Work" }, { href: "/calendar", label: "Calendar", group: "Work" });
  if (can(actor, "eventDay.run")) items.push({ href: "/event-day", label: "Event day", group: "Work" });
  if (can(actor, "vendors.view")) items.push({ href: "/vendors", label: "Vendors", group: "People" });
  if (can(actor, "crew.view")) items.push({ href: "/roster", label: "Crew", group: "People" });
  if (can(actor, "equipment.view")) items.push({ href: "/equipment", label: "Equipment", group: "Operations" });
  if (can(actor, "proof.view")) items.push({ href: "/proof", label: "Proof", group: "Operations", badge: await proofToCheckCount(db, actor) });
  if (can(actor, "finance.company")) items.push({ href: "/money", label: "Money", group: "Money", badge: await db.payment.count({ where: { direction: "OUT", status: "APPROVED" } }) });
  if (can(actor, "payments.prepare")) items.push({ href: "/invoices", label: "Invoices", group: "Money", badge: await invoicesToCheckCount(db, actor) });
  if (can(actor, "expenses.record")) items.push({ href: "/expenses", label: "Expenses", group: "Money" });
  // Cash advances (D57): the office sees them all; a manager or supervisor sees the menu item while they carry one.
  if (can(actor, "payments.prepare")) items.push({ href: "/advances", label: "Advances", group: "Money", badge: await db.cashAdvance.count({ where: { status: "APPROVED" } }) });
  else if (can(actor, "expenses.record") && (await db.cashAdvance.count({ where: { userId: actor.userId, status: { in: ["GIVEN", "APPROVED", "PENDING_APPROVAL"] } } }))) items.push({ href: "/advances", label: "Advances", group: "Money" });
  if (can(actor, "approvals.decide")) {
    items.push({ href: "/approvals", label: "Approvals", group: "Money", badge: await db.approvalRequest.count({ where: { state: "PENDING" } }) });
  }
  if (can(actor, "admin.users")) items.push({ href: "/team", label: "Team", group: "Admin" });
  if (can(actor, "admin.settings") || can(actor, "admin.taxSettings")) items.push({ href: "/settings", label: "Settings", group: "Admin" });

  const roleLabel = actor.isOwner ? actor.hostTitle! : actor.roles.map((r) => ROLES[r].name).join(" · ");
  return (
    // Sidebar (laptop: full, iPad portrait: icons) · top bar · page; phones get a bottom bar instead.
    <div className="min-h-dvh md:grid md:grid-cols-[76px_minmax(0,1fr)] lg:grid-cols-[252px_minmax(0,1fr)] print:block">
      <Sidebar items={items} name={actor.name} roleLabel={roleLabel} />
      <div className="flex min-h-dvh min-w-0 flex-col">
        <AppHeader />
        <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 pt-6 pb-[calc(env(safe-area-inset-bottom)+96px)] sm:px-6 md:pb-12 lg:px-8 print:max-w-none print:p-0">{children}</main>
      </div>
      <MobileNav items={items} />
      <CommandPalette items={items} />
    </div>
  );
}
