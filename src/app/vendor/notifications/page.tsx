import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NotificationList } from "@/components/notifications";
import { PushToggle } from "@/components/push-toggle";
import { PortalShell } from "@/components/portal-shell";
import { homePathFor, requireActor } from "@/modules/identity/session";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const actor = await requireActor();
  if (actor.accountType !== "VENDOR") redirect(homePathFor(actor));
  return (
    <PortalShell title="Notifications" subtitle="Taamara Taamara · vendor" back={{ href: "/vendor", label: "All jobs" }}>
      <div className="flex flex-col gap-3">
        {process.env.VAPID_PUBLIC_KEY && <PushToggle publicKey={process.env.VAPID_PUBLIC_KEY} />}
        <NotificationList />
      </div>
    </PortalShell>
  );
}
