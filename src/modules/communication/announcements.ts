/**
 * Announcements (Phase 8): one message to many people, optionally needing "Got it" from each.
 *
 *   Company-wide (owners: announcements.send with ALL)   ALL_STAFF · ALL_CREW · ALL_VENDORS
 *   One booking (managers and supervisors on it, owners)  BOOKING_TEAM · BOOKING_CREW · BOOKING_VENDORS
 *
 * Who receives one is worked out when it is read, from the audience:
 *   BOOKING_TEAM     the booking's managers and supervisors
 *   BOOKING_CREW     crew booked on it (offered, confirmed or done)
 *   BOOKING_VENDORS  logins of vendors with a live job on it
 * Senders (and owners) see how many confirmed and who hasn't yet. Recipients are notified when it
 * is sent; announcements waiting for their "Got it" show on their home screen.
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { Db, DbTx } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/validate";
import { recordAudit, type RequestMeta } from "@/modules/audit/audit";
import type { Actor } from "@/modules/identity/actor";
import { assertCan, assertEventAccess, scopeOf } from "@/modules/identity/policy";
import { notify } from "@/modules/notifications/notify";

export const AUDIENCES = ["BOOKING_TEAM", "BOOKING_CREW", "BOOKING_VENDORS", "ALL_STAFF", "ALL_CREW", "ALL_VENDORS"] as const;
export type Audience = (typeof AUDIENCES)[number];
export const COMPANY_WIDE: readonly Audience[] = ["ALL_STAFF", "ALL_CREW", "ALL_VENDORS"];
export const AUDIENCE_LABELS: Record<Audience, string> = {
  BOOKING_TEAM: "The booking's team",
  BOOKING_CREW: "The booking's crew",
  BOOKING_VENDORS: "The booking's vendors",
  ALL_STAFF: "All staff",
  ALL_CREW: "All crew",
  ALL_VENDORS: "All vendors",
};

const LIVE_JOB = { notIn: ["DECLINED", "CANCELLED"] } as Prisma.EnumVendorAssignmentStatusFilter;
const ON_CREW = { in: ["ASSIGNED", "CONFIRMED", "COMPLETED"] } as Prisma.EnumCrewAssignmentStatusFilter;

/** The people an announcement is for (active logins only). */
export function recipientsWhere(a: { audience: Audience; eventId: string | null }): Prisma.UserWhereInput {
  const active = { status: "ACTIVE" as const };
  switch (a.audience) {
    case "ALL_STAFF":
      return { ...active, accountType: "INTERNAL" };
    case "ALL_CREW":
      return { ...active, accountType: "LABOUR" };
    case "ALL_VENDORS":
      return { ...active, accountType: "VENDOR" };
    case "BOOKING_TEAM":
      return { ...active, accountType: "INTERNAL", eventMemberships: { some: { eventId: a.eventId ?? "" } } };
    case "BOOKING_CREW":
      return { ...active, accountType: "LABOUR", worker: { assignments: { some: { eventId: a.eventId ?? "", status: ON_CREW } } } };
    case "BOOKING_VENDORS":
      return { ...active, accountType: "VENDOR", vendorLinks: { some: { vendor: { assignments: { some: { eventId: a.eventId ?? "", status: LIVE_JOB } } } } } };
  }
}

/** Announcements addressed to this person. */
function addressedTo(actor: Actor): Prisma.AnnouncementWhereInput {
  switch (actor.accountType) {
    case "INTERNAL":
      return { OR: [{ audience: "ALL_STAFF" }, { audience: "BOOKING_TEAM", event: { members: { some: { userId: actor.userId } } } }] };
    case "VENDOR":
      return { OR: [{ audience: "ALL_VENDORS" }, { audience: "BOOKING_VENDORS", event: { vendorAssignments: { some: { vendorId: { in: actor.vendorIds }, status: LIVE_JOB } } } }] };
    case "LABOUR":
      return actor.workerId ? { OR: [{ audience: "ALL_CREW" }, { audience: "BOOKING_CREW", event: { crewAssignments: { some: { workerId: actor.workerId, status: ON_CREW } } } }] } : { id: { in: [] } };
  }
}

/** What this person may see: addressed to them, sent by them, or (owners) everything. */
export function announcementWhere(actor: Actor): Prisma.AnnouncementWhereInput {
  if (actor.accountType === "INTERNAL" && scopeOf(actor, "announcements.send") === "ALL") return {};
  return { OR: [addressedTo(actor), { createdById: actor.userId }] };
}

export const announcementSchema = z.object({
  audience: z.enum(AUDIENCES),
  eventId: z.union([z.literal(""), z.string().uuid()]).optional(),
  title: z.string().trim().min(3, "Give it a short title, e.g. Sangeet: report at gate 2.").max(120),
  body: z.string().trim().min(3, "Write the message.").max(2000),
  needsAck: z.coerce.boolean().default(false),
});
export type AnnouncementInput = z.input<typeof announcementSchema>;

function linkFor(accountType: string) {
  return accountType === "VENDOR" ? "/vendor/messages" : accountType === "LABOUR" ? "/crew/messages" : "/messages";
}

export async function sendAnnouncement(db: Db, actor: Actor, input: AnnouncementInput, meta: RequestMeta = {}) {
  const v = parseInput(announcementSchema, input);
  if (actor.accountType !== "INTERNAL") throw new ForbiddenError("Only the team sends announcements.");
  const scope = assertCan(actor, "announcements.send", "You can't send announcements.");
  const companyWide = COMPANY_WIDE.includes(v.audience);
  if (companyWide && scope !== "ALL") throw new ForbiddenError("Only owners send announcements to everyone.");
  if (!companyWide && !v.eventId) throw new ValidationError("Pick the booking.", { eventId: "Pick the booking." });
  return db.$transaction(async (tx) => {
    const eventId = companyWide ? null : v.eventId!;
    let eventName: string | null = null;
    if (eventId) {
      await assertEventAccess(tx, actor, eventId, "announcements.send");
      eventName = (await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { name: true } })).name;
    }
    const recipients = await tx.user.findMany({ where: recipientsWhere({ audience: v.audience, eventId }), select: { id: true, accountType: true } });
    if (recipients.filter((r) => r.id !== actor.userId).length === 0) throw new ConflictError("Nobody would receive this yet. Check the audience.");
    const a = await tx.announcement.create({ data: { audience: v.audience, eventId, title: v.title, body: v.body, needsAck: v.needsAck, createdById: actor.userId } });
    for (const kind of ["INTERNAL", "VENDOR", "LABOUR"] as const) {
      const ids = recipients.filter((r) => r.accountType === kind).map((r) => r.id);
      if (ids.length)
        await notify(tx, ids, { type: "announcement", title: `${v.needsAck ? "Please read: " : ""}${v.title}`, body: eventName ?? AUDIENCE_LABELS[v.audience], link: linkFor(kind), entityType: "announcement", entityId: a.id }, { exceptUserId: actor.userId });
    }
    await recordAudit(tx, actor, { action: "create", entityType: "announcement", entityId: a.id, summary: `Announcement to ${AUDIENCE_LABELS[v.audience].toLowerCase()}${eventName ? ` (${eventName})` : ""}: ${v.title}` }, meta);
    return { id: a.id, recipients: recipients.length };
  });
}

async function isRecipient(tx: DbTx, userId: string, a: { audience: Audience; eventId: string | null }) {
  return (await tx.user.count({ where: { AND: [{ id: userId }, recipientsWhere(a)] } })) > 0;
}

export async function acknowledge(db: Db, actor: Actor, announcementId: string) {
  const a = await db.announcement.findUnique({ where: { id: announcementId }, select: { id: true, audience: true, eventId: true, needsAck: true } });
  if (!a) throw new NotFoundError("That announcement");
  if (!(await isRecipient(db, actor.userId, a))) throw new NotFoundError("That announcement");
  await db.announcementAck.upsert({ where: { announcementId_userId: { announcementId, userId: actor.userId } }, create: { announcementId, userId: actor.userId }, update: {} });
}

export interface AnnouncementItem {
  id: string;
  title: string;
  body: string;
  audience: Audience;
  audienceLabel: string;
  event: { id: string; name: string } | null;
  from: string | null;
  createdAt: Date;
  needsAck: boolean;
  /** True when this person is asked to confirm and hasn't yet. */
  waitingForMe: boolean;
  ackedByMe: boolean;
  /** For the sender and owners: how many of the recipients confirmed, and who hasn't. */
  progress: { recipients: number; acked: number; waiting: string[] } | null;
}

export async function listAnnouncements(db: Db, actor: Actor, opts: { days?: number; onlyWaiting?: boolean } = {}): Promise<AnnouncementItem[]> {
  const since = new Date(Date.now() - (opts.days ?? 60) * 86400_000);
  const rows = await db.announcement.findMany({
    where: { AND: [announcementWhere(actor), { createdAt: { gte: since } }] },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { event: { select: { id: true, name: true } }, acks: { select: { userId: true } } },
  });
  const senders = await db.user.findMany({ where: { id: { in: rows.map((r) => r.createdById).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } });
  const ownerView = actor.accountType === "INTERNAL" && scopeOf(actor, "announcements.send") === "ALL";
  const out: AnnouncementItem[] = [];
  for (const r of rows) {
    const a = { audience: r.audience as Audience, eventId: r.eventId };
    const mine = await isRecipient(db, actor.userId, a);
    const acked = r.acks.some((x) => x.userId === actor.userId);
    const waitingForMe = r.needsAck && mine && !acked;
    if (opts.onlyWaiting && !waitingForMe) continue;
    let progress: AnnouncementItem["progress"] = null;
    if (r.needsAck && (ownerView || r.createdById === actor.userId)) {
      const people = await db.user.findMany({ where: recipientsWhere(a), select: { id: true, name: true }, orderBy: { name: "asc" } });
      const others = people.filter((p) => p.id !== r.createdById);
      const ackSet = new Set(r.acks.map((x) => x.userId));
      progress = { recipients: others.length, acked: others.filter((p) => ackSet.has(p.id)).length, waiting: others.filter((p) => !ackSet.has(p.id)).map((p) => p.name) };
    }
    out.push({
      id: r.id,
      title: r.title,
      body: r.body,
      audience: a.audience,
      audienceLabel: AUDIENCE_LABELS[a.audience],
      event: r.event,
      from: senders.find((s) => s.id === r.createdById)?.name ?? null,
      createdAt: r.createdAt,
      needsAck: r.needsAck,
      waitingForMe,
      ackedByMe: acked,
      progress,
    });
  }
  return out;
}

/** Bookings this person can send booking announcements for (not closed). */
export async function announceableBookings(db: Db, actor: Actor) {
  if (actor.accountType !== "INTERNAL" || !scopeOf(actor, "announcements.send")) return [];
  const scope = scopeOf(actor, "announcements.send");
  return db.event.findMany({
    where: { status: { notIn: ["CANCELLED", "SETTLED"] }, ...(scope === "ALL" ? {} : { members: { some: { userId: actor.userId } } }) },
    orderBy: [{ startDate: "asc" }, { name: "asc" }],
    select: { id: true, name: true, startDate: true },
  });
}
