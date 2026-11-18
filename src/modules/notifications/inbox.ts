/** Reading one's own notifications. Nobody can read or change anyone else's. */
import type { Db } from "@/lib/db";
import type { Actor } from "@/modules/identity/actor";

export async function unreadCount(db: Db, actor: Actor): Promise<number> {
  return db.notification.count({ where: { userId: actor.userId, readAt: null } });
}

export async function listNotifications(db: Db, actor: Actor, take = 60) {
  return db.notification.findMany({
    where: { userId: actor.userId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, type: true, title: true, body: true, link: true, readAt: true, createdAt: true },
  });
}

/** Marks one notification read and returns where it points (only paths inside the app). */
export async function openNotification(db: Db, actor: Actor, id: string): Promise<string | null> {
  const n = await db.notification.findFirst({ where: { id, userId: actor.userId }, select: { id: true, link: true, readAt: true } });
  if (!n) return null;
  if (!n.readAt) await db.notification.update({ where: { id: n.id }, data: { readAt: new Date() } });
  return n.link && n.link.startsWith("/") && !n.link.startsWith("//") ? n.link : null;
}

export async function markAllRead(db: Db, actor: Actor) {
  const { count } = await db.notification.updateMany({ where: { userId: actor.userId, readAt: null }, data: { readAt: new Date() } });
  return count;
}

/** Where each kind of login reads its notifications. */
export function notificationsPath(actor: Pick<Actor, "accountType">): string {
  if (actor.accountType === "VENDOR") return "/vendor/notifications";
  if (actor.accountType === "LABOUR") return "/crew/notifications";
  return "/notifications";
}
