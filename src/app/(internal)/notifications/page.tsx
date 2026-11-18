import type { Metadata } from "next";
import { NotificationList } from "@/components/notifications";
import { requireActor } from "@/modules/identity/session";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  await requireActor();
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="font-condensed text-[clamp(32px,4vw,46px)] leading-[0.95] uppercase">Notifications</h1>
      <NotificationList />
    </div>
  );
}
