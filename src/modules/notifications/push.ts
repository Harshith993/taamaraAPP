/**
 * Web push (Phase 10, D44, D67): a person turns on notifications on a phone or computer, and the
 * bell's notifications also pop up there. Each device's subscription is kept here; the driver below
 * sends to all of a person's devices and forgets the ones the browser has dropped.
 *
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (npx web-push generate-vapid-keys), VAPID_SUBJECT (mailto:…)
 *
 * The message is encrypted on our server for that one device (RFC 8291), so the browser's push
 * service (Google, Apple, Mozilla) carries it without being able to read it. It holds only what the
 * bell shows: the title, a line of text and a link.
 */
import webpush from "web-push";
import { z } from "zod";
import type { Db, DbTx } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { parseInput } from "@/lib/validate";
import type { Actor } from "@/modules/identity/actor";
import type { DeliveryDriver } from "./delivery";

export const subscriptionSchema = z.object({
  endpoint: z.string().url().max(1000).refine((u) => u.startsWith("https://"), "Push needs a secure address."),
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
});

/** Saves this device for the signed-in person (a shared phone moves to whoever turned it on last). */
export async function savePushSubscription(db: Db, actor: Actor, input: unknown, userAgent: string | null = null) {
  if (actor.status !== "ACTIVE") throw new ForbiddenError();
  const v = parseInput(subscriptionSchema, input);
  await db.pushSubscription.upsert({
    where: { endpoint: v.endpoint },
    create: { userId: actor.userId, endpoint: v.endpoint, p256dh: v.keys.p256dh, auth: v.keys.auth, userAgent: userAgent?.slice(0, 300) ?? null },
    update: { userId: actor.userId, p256dh: v.keys.p256dh, auth: v.keys.auth, userAgent: userAgent?.slice(0, 300) ?? null },
  });
  return { ok: true };
}

/** Turns push off on this device (only the person's own devices). */
export async function removePushSubscription(db: Db, actor: Actor, endpoint: string) {
  const r = await db.pushSubscription.deleteMany({ where: { endpoint, userId: actor.userId } });
  return { removed: r.count };
}

export interface PushSender {
  sendNotification(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string, opts: { TTL: number; urgency?: "normal" | "high" }): Promise<unknown>;
}

export function webPushDriver(db: DbTx, opts: { publicKey: string; privateKey: string; subject: string; sender?: PushSender }): DeliveryDriver {
  if (!opts.publicKey || !opts.privateKey || !opts.subject) throw new Error("VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT are needed for push.");
  let sender = opts.sender;
  if (!sender) {
    webpush.setVapidDetails(opts.subject, opts.publicKey, opts.privateKey);
    sender = webpush;
  }
  return {
    channel: "push",
    async deliver(n) {
      const subs = await db.pushSubscription.findMany({ where: { userId: n.userId } });
      const payload = JSON.stringify({ title: n.title, body: n.body ?? "", link: n.link ?? "/", tag: n.type, id: n.id });
      let failure: unknown = null;
      for (const s of subs) {
        try {
          // A day to arrive: a phone switched off at the venue still gets it in the morning.
          await sender.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 24 * 3600, urgency: n.type.startsWith("approval") ? "normal" : "high" });
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          // Gone or unknown: the browser dropped this device.
          if (status === 404 || status === 410) await db.pushSubscription.deleteMany({ where: { id: s.id } });
          else failure = err;
        }
      }
      if (failure) throw failure;
    },
  };
}
