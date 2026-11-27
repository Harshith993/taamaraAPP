import { db } from "@/lib/db";
import { unreadTotal } from "@/modules/communication/chat";
import { unreadCount } from "@/modules/notifications/inbox";
import { getActor } from "@/modules/identity/session";
import { PortalTabBar, type PortalTab } from "./portal-tab-bar";

/**
 * The bottom tab bar of the vendor portal and the crew app: four big targets in thumb reach, with
 * the unread counts that used to sit in the header.
 */
export async function PortalTabs() {
  const actor = await getActor();
  if (!actor || actor.accountType === "INTERNAL") return null;
  const [messages, alerts] = await Promise.all([unreadTotal(db, actor), unreadCount(db, actor)]);
  const vendor = actor.accountType === "VENDOR";
  const tabs: PortalTab[] = vendor
    ? [
        { href: "/vendor", label: "Jobs", icon: "jobs", exact: true },
        { href: "/vendor/messages", label: "Messages", icon: "messages", count: messages },
        { href: "/vendor/notifications", label: "Alerts", aria: "Notifications", icon: "alerts", count: alerts },
        { href: "/vendor/profile", label: "Profile", icon: "profile" },
      ]
    : [
        { href: "/crew", label: "Today", icon: "today", exact: true },
        { href: "/crew/messages", label: "Messages", icon: "messages", count: messages },
        { href: "/crew/notifications", label: "Alerts", aria: "Notifications", icon: "alerts", count: alerts },
        { href: "/crew/me", label: "Me", icon: "profile" },
      ];
  return <PortalTabBar tabs={tabs} />;
}
