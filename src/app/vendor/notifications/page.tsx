import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NotificationList } from "@/components/notifications";
import { PortalShell } from "@/components/portal-shell";
import { homePathFor, requireActor } from "@/modules/identity/session";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const actor = await requireActor();
  if (actor.accountType !== "VENDOR") redirect(homePathFor(actor));
  return (
    <PortalShell title="Notifications" subtitle="Taamara Taamara · vendor" back={{ href: "/vendor", label: "All jobs" }}>
      <NotificationList />
    </PortalShell>
  );
}
