/**
 * In-process scheduler for reminders and notification delivery, started from instrumentation.ts.
 * One app server (D5), so a timer is enough; every job is safe to run twice.
 */
import { db } from "@/lib/db";
import { deliverPending, inAppDriver, setDrivers, type DeliveryDriver } from "@/modules/notifications/delivery";
import { sesEmailDriver } from "@/modules/notifications/drivers/email";
import { webPushDriver } from "@/modules/notifications/push";
import { runReminders } from "./jobs";

let started = false;

/** Delivery drivers from the environment: push when VAPID keys are set, email when EMAIL_DRIVER=ses (Phase 10). */
export function driversFromEnv(env: NodeJS.ProcessEnv = process.env): DeliveryDriver[] {
  const list: DeliveryDriver[] = [inAppDriver];
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) list.push(webPushDriver(db, { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || "mailto:admin@taamara.in" }));
  if (env.EMAIL_DRIVER === "ses") list.push(sesEmailDriver({ from: env.EMAIL_FROM ?? "", appUrl: env.APP_URL || env.BETTER_AUTH_URL || "http://localhost:3000", region: env.AWS_REGION || "ap-south-1" }));
  return list;
}

export function startReminders() {
  if (started) return;
  started = true;
  setDrivers(driversFromEnv());
  const remind = () => runReminders(db).catch((err) => console.error("Reminders failed", err));
  const deliver = () => deliverPending(db).catch((err) => console.error("Notification delivery failed", err));
  setTimeout(remind, 30_000).unref();
  setInterval(remind, 10 * 60_000).unref();
  setInterval(deliver, 30_000).unref();
}
