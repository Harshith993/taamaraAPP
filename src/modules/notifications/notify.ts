/**
 * In-app notifications. Phase 8 adds push and email delivery on top of these rows;
 * until then they show in the app (bell and home screens).
 */
import type { DbTx } from "@/lib/db";

export interface NewNotification {
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}

/** Notifies each person once. Skips the person who caused it, and anyone switched off. */
export async function notify(
  tx: DbTx,
  userIds: Iterable<string | null | undefined>,
  n: NewNotification,
  opts: { exceptUserId?: string } = {},
) {
  const ids = [
    ...new Set(
      [...userIds].filter(
        (id): id is string => Boolean(id) && id !== opts.exceptUserId,
      ),
    ),
  ];
  if (ids.length === 0) return 0;
  const active = await tx.user.findMany({
    where: { id: { in: ids }, status: "ACTIVE" },
    select: { id: true },
  });
  if (active.length === 0) return 0;
  const { count } = await tx.notification.createMany({
    data: active.map((u) => ({
      userId: u.id,
      type: n.type,
      title: n.title,
      body: n.body ?? null,
      link: n.link ?? null,
      entityType: n.entityType ?? null,
      entityId: n.entityId ?? null,
    })),
  });
  return count;
}

/** Both owners (every active owner login). */
export async function ownerUserIds(tx: DbTx): Promise<string[]> {
  const rows = await tx.user.findMany({
    where: {
      status: "ACTIVE",
      accountType: "INTERNAL",
      roles: { some: { role: { isOwner: true } } },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Every login of a vendor company. */
export async function vendorUserIds(
  tx: DbTx,
  vendorId: string,
): Promise<string[]> {
  const rows = await tx.vendorUser.findMany({
    where: { vendorId },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

/** The managers (and optionally supervisors) on a booking. */
export async function bookingTeamUserIds(
  tx: DbTx,
  eventId: string,
  roles: ("MANAGER" | "SUPERVISOR")[] = ["MANAGER"],
): Promise<string[]> {
  const rows = await tx.eventMember.findMany({
    where: { eventId, role: { in: roles } },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}
