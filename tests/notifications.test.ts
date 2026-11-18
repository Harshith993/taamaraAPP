import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadActor, type Actor } from "@/modules/identity/actor";
import { listNotifications, markAllRead, notificationsPath, openNotification, unreadCount } from "@/modules/notifications/inbox";
import { notify } from "@/modules/notifications/notify";
import { makeUser, testDb } from "./support/factories";

let a: Actor, b: Actor, vendor: Actor;
beforeAll(async () => {
  a = (await loadActor(testDb, (await makeUser({ name: "NT A", roleKey: "EVENT_MANAGER" })).id))!;
  b = (await loadActor(testDb, (await makeUser({ name: "NT B", roleKey: "EVENT_MANAGER" })).id))!;
  vendor = (await loadActor(testDb, (await makeUser({ name: "NT V", roleKey: "VENDOR", accountType: "VENDOR" })).id))!;
});
afterAll(() => testDb.$disconnect());

describe("notifications inbox", () => {
  it("each person reads only their own, and opening marks it read", async () => {
    await notify(testDb, [a.userId], { type: "t", title: "For A", link: "/bookings/x" });
    await notify(testDb, [a.userId], { type: "t", title: "Sneaky", link: "https://evil.example/phish" });
    await notify(testDb, [a.userId], { type: "t", title: "Protocol-relative", link: "//evil.example" });
    await notify(testDb, [b.userId], { type: "t", title: "For B" });
    expect(await unreadCount(testDb, a)).toBe(3);
    const mine = await listNotifications(testDb, a);
    expect(mine.map((n) => n.title).sort()).toEqual(["For A", "Protocol-relative", "Sneaky"]);
    const forB = (await listNotifications(testDb, b))[0];
    expect(await openNotification(testDb, a, forB.id)).toBeNull();
    expect((await testDb.notification.findUniqueOrThrow({ where: { id: forB.id } })).readAt).toBeNull();
    expect(await openNotification(testDb, a, mine.find((n) => n.title === "For A")!.id)).toBe("/bookings/x");
    expect(await openNotification(testDb, a, mine.find((n) => n.title === "Sneaky")!.id)).toBeNull();
    expect(await openNotification(testDb, a, mine.find((n) => n.title === "Protocol-relative")!.id)).toBeNull();
    expect(await unreadCount(testDb, a)).toBe(0);
    await notify(testDb, [b.userId], { type: "t", title: "Another" });
    expect(await markAllRead(testDb, b)).toBe(2);
    expect(notificationsPath(vendor)).toBe("/vendor/notifications");
  });
});
