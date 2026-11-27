import type { Metadata } from "next";
import { NotificationList } from "@/components/notifications";
import { PushToggle } from "@/components/push-toggle";
import { requireActor } from "@/modules/identity/session";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  await requireActor();
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="font-condensed text-[26px] leading-tight tracking-[-0.03em] sm:text-[30px]">Notifications</h1>
      <div className="flex flex-col gap-3">
        {process.env.VAPID_PUBLIC_KEY && <PushToggle publicKey={process.env.VAPID_PUBLIC_KEY} />}
        <NotificationList />
      </div>
    </div>
  );
}
