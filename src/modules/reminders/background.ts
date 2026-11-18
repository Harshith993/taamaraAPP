/**
 * In-process scheduler for reminders and notification delivery, started from instrumentation.ts.
 * One app server (D5), so a timer is enough; every job is safe to run twice.
 */
import { db } from "@/lib/db";
import { deliverPending } from "@/modules/notifications/delivery";
import { runReminders } from "./jobs";

let started = false;

export function startReminders() {
  if (started) return;
  started = true;
  const remind = () => runReminders(db).catch((err) => console.error("Reminders failed", err));
  const deliver = () => deliverPending(db).catch((err) => console.error("Notification delivery failed", err));
  setTimeout(remind, 30_000).unref();
  setInterval(remind, 10 * 60_000).unref();
  setInterval(deliver, 30_000).unref();
}
