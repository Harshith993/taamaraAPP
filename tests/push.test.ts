import { afterAll, beforeAll, describe, expect, it } from "vitest";
import webpush from "web-push";
import { loadActor, type Actor } from "@/modules/identity/actor";
import { removePushSubscription, savePushSubscription, webPushDriver, type PushSender } from "@/modules/notifications/push";
import { driversFromEnv } from "@/modules/reminders/background";
import { makeUser, testDb } from "./support/factories";

let a: Actor, b: Actor;
const sub = (n: number) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/test-${Date.now()}-${n}`, keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" } });
const N = (userId: string) => ({ id: "n1", userId, type: "crew.assigned", title: "New booking: Aditi & Karan", body: "Stage decor", link: "/crew", user: { name: "x", email: "x@y.in", hasRealEmail: false, phoneNumber: null } });

beforeAll(async () => {
  a = (await loadActor(testDb, (await makeUser({ name: "PU One", roleKey: "LABOUR", accountType: "LABOUR" })).id))!;
  b = (await loadActor(testDb, (await makeUser({ name: "PU Two", roleKey: "EVENT_MANAGER" })).id))!;
});
afterAll(() => testDb.$disconnect());

describe("web push (Phase 10)", () => {
  it("saves a device; a shared phone moves to whoever turned it on last; only your own can be removed", async () => {
    const s = sub(1);
    await expect(savePushSubscription(testDb, a, { ...s, endpoint: "http://insecure.example/x" })).rejects.toThrow(/secure/);
    await savePushSubscription(testDb, a, s, "Pixel");
    await savePushSubscription(testDb, b, s);
    expect((await testDb.pushSubscription.findUniqueOrThrow({ where: { endpoint: s.endpoint } })).userId).toBe(b.userId);
    expect((await removePushSubscription(testDb, a, s.endpoint)).removed).toBe(0);
    expect((await removePushSubscription(testDb, b, s.endpoint)).removed).toBe(1);
  });

  it("sends to each of a person's devices and forgets the ones the browser dropped", async () => {
    const live = sub(2);
    const gone = sub(3);
    await savePushSubscription(testDb, a, live);
    await savePushSubscription(testDb, a, gone);
    const sent: { endpoint: string; payload: string }[] = [];
    const sender: PushSender = {
      async sendNotification(s, payload) {
        if (s.endpoint === gone.endpoint) throw Object.assign(new Error("Gone"), { statusCode: 410 });
        sent.push({ endpoint: s.endpoint, payload });
      },
    };
    const driver = webPushDriver(testDb, { publicKey: "p", privateKey: "k", subject: "mailto:a@b.in", sender });
    await driver.deliver(N(a.userId));
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0].payload)).toMatchObject({ title: "New booking: Aditi & Karan", body: "Stage decor", link: "/crew" });
    expect(await testDb.pushSubscription.count({ where: { endpoint: gone.endpoint } })).toBe(0);
  });

  it("other failures are thrown so the outbox tries again", async () => {
    const sender: PushSender = { sendNotification: async () => Promise.reject(Object.assign(new Error("Busy"), { statusCode: 503 })) };
    await expect(webPushDriver(testDb, { publicKey: "p", privateKey: "k", subject: "mailto:a@b.in", sender }).deliver(N(a.userId))).rejects.toThrow(/Busy/);
  });

  it("drivers come from the environment: push with VAPID keys, email with EMAIL_DRIVER=ses", () => {
    const keys = webpush.generateVAPIDKeys();
    expect(driversFromEnv({} as NodeJS.ProcessEnv).map((d) => d.channel)).toEqual(["inApp"]);
    const all = driversFromEnv({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: "mailto:a@b.in", EMAIL_DRIVER: "ses", EMAIL_FROM: "no-reply@taamara.in" } as unknown as NodeJS.ProcessEnv);
    expect(all.map((d) => d.channel)).toEqual(["inApp", "push", "email"]);
  });
});
