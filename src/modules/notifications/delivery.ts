/**
 * Delivering notifications beyond the database row (Phase 8 interface; Phase 10 drivers).
 *
 * notify() only writes rows, inside the transaction of whatever caused them, so a rolled-back
 * change never notifies anyone. A background loop (src/modules/reminders/background.ts) then picks
 * up rows not yet delivered (an outbox) and hands each to the drivers the person has switched on
 * for that kind of notification (NotificationPreference; in-app and push on, email off by default).
 *
 *   in-app   the row itself, shown by the bell: nothing more to do
 *   push     web push (needs VAPID keys)            Phase 10
 *   email    Amazon SES, Mumbai (needs credentials)  Phase 10
 *
 * A driver that fails leaves the row undelivered, and it is tried again on the next run for a day.
 */
import type { Db } from "@/lib/db";

export type DeliveryChannel = "inApp" | "push" | "email";

export interface OutgoingNotification {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  user: { name: string; email: string; hasRealEmail: boolean; phoneNumber: string | null };
}

export interface DeliveryDriver {
  channel: DeliveryChannel;
  deliver(n: OutgoingNotification): Promise<void>;
}

/** The bell reads the rows directly. */
export const inAppDriver: DeliveryDriver = { channel: "inApp", deliver: async () => {} };

const DEFAULTS: Record<DeliveryChannel, boolean> = { inApp: true, push: true, email: false };
let drivers: DeliveryDriver[] = [inAppDriver];

/** Replace the drivers (Phase 10 adds push and email; tests use fakes). */
export function setDrivers(list: DeliveryDriver[]) {
  drivers = list;
}

const RETRY_FOR_MS = 24 * 3600_000;

export async function deliverPending(db: Db, opts: { limit?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const rows = await db.notification.findMany({
    where: { deliveredAt: null, createdAt: { gte: new Date(now.getTime() - RETRY_FOR_MS) } },
    orderBy: { createdAt: "asc" },
    take: opts.limit ?? 200,
    include: { user: { select: { name: true, email: true, hasRealEmail: true, phoneNumber: true, status: true, notificationPrefs: true } } },
  });
  let delivered = 0;
  let failed = 0;
  for (const r of rows) {
    if (r.user.status !== "ACTIVE") {
      await db.notification.update({ where: { id: r.id }, data: { deliveredAt: now } });
      continue;
    }
    const pref = r.user.notificationPrefs.find((p) => p.type === r.type);
    const wants = (c: DeliveryChannel) => (pref ? pref[c] : DEFAULTS[c]);
    let ok = true;
    for (const d of drivers) {
      if (!wants(d.channel)) continue;
      // Email only reaches people who gave a real address.
      if (d.channel === "email" && !r.user.hasRealEmail) continue;
      try {
        await d.deliver({ id: r.id, userId: r.userId, type: r.type, title: r.title, body: r.body, link: r.link, user: r.user });
      } catch (err) {
        ok = false;
        console.error(`Notification ${r.id}: ${d.channel} delivery failed`, err);
      }
    }
    if (ok) {
      await db.notification.update({ where: { id: r.id }, data: { deliveredAt: now } });
      delivered += 1;
    } else failed += 1;
  }
  return { delivered, failed };
}
