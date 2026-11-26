/**
 * Chat (Phase 8): conversations attached to a booking.
 *
 *   BOOKING_TEAM   the booking's managers and supervisors (chat.booking); owners can join any
 *   VENDOR_THREAD  the booking team and one vendor's logins, about that vendor's job
 *   CREW           the booking team and the crew booked on it
 *
 * Who can open a conversation is worked out from the booking, every time (channelWhere), so people
 * removed from a booking lose access at once. ChannelMember rows only remember what each person has
 * read (for unread counts); the people who naturally belong are added when a conversation starts
 * and whenever someone writes in it.
 *
 * Live updates: posting publishes on the in-process bus; /api/v1/channels/[id]/stream relays it to
 * open screens over Server-Sent Events (no third-party realtime service: data stays in India, D5).
 *
 * Notifications: someone gets one notification when a conversation has something new for them,
 * not one per message; the next comes after they have read it.
 */
import { checkRate } from "@/lib/rate-limit";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { publish } from "@/lib/bus";
import type { Db, DbTx } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/validate";
import { MEDIA_SELECT, mediaView } from "@/modules/files/media";
import type { Actor } from "@/modules/identity/actor";
import { can, eventWhere } from "@/modules/identity/policy";
import { notify } from "@/modules/notifications/notify";

export type ChannelKind = "BOOKING_TEAM" | "VENDOR_THREAD" | "CREW";
const NOTHING = { id: { in: [] as string[] } };
const LIVE_JOB = { notIn: ["DECLINED", "CANCELLED"] } as Prisma.EnumVendorAssignmentStatusFilter;
const ON_CREW = { in: ["ASSIGNED", "CONFIRMED", "COMPLETED"] } as Prisma.EnumCrewAssignmentStatusFilter;
/** People can remove their own message for this long after sending it. */
export const DELETE_WINDOW_MS = 15 * 60_000;

/** Conversations this person may open. */
export function channelWhere(actor: Actor): Prisma.ChannelWhereInput {
  const ors: Prisma.ChannelWhereInput[] = [];
  if (actor.status !== "ACTIVE") return NOTHING;
  if (actor.accountType === "INTERNAL") {
    if (can(actor, "chat.booking")) ors.push({ type: "BOOKING_TEAM", event: eventWhere(actor, "chat.booking") });
    if (can(actor, "chat.direct")) ors.push({ type: { in: ["VENDOR_THREAD", "CREW"] }, event: eventWhere(actor, "chat.direct") });
  } else if (actor.accountType === "VENDOR" && can(actor, "chat.direct") && actor.vendorIds.length) {
    ors.push({ type: "VENDOR_THREAD", vendorId: { in: actor.vendorIds }, event: { vendorAssignments: { some: { vendorId: { in: actor.vendorIds }, status: LIVE_JOB } } } });
  } else if (actor.accountType === "LABOUR" && can(actor, "chat.direct") && actor.workerId) {
    ors.push({ type: "CREW", event: { crewAssignments: { some: { workerId: actor.workerId, status: ON_CREW } } } });
  }
  return ors.length ? { OR: ors } : NOTHING;
}

async function assertChannelAccess(tx: DbTx, actor: Actor, channelId: string) {
  const ch = await tx.channel.findFirst({ where: { AND: [{ id: channelId }, channelWhere(actor)] }, include: { event: { select: { id: true, name: true, startDate: true, status: true } } } });
  if (!ch) throw new NotFoundError("That conversation");
  return ch;
}

/** The people who naturally belong in a conversation (besides owners who join by opening it). */
async function naturalMembers(tx: DbTx, ch: { type: string; eventId: string | null; vendorId: string | null }): Promise<string[]> {
  if (!ch.eventId) return [];
  const team = await tx.eventMember.findMany({ where: { eventId: ch.eventId, user: { status: "ACTIVE" } }, select: { userId: true } });
  const ids = team.map((m) => m.userId);
  if (ch.type === "VENDOR_THREAD" && ch.vendorId) {
    ids.push(...(await tx.vendorUser.findMany({ where: { vendorId: ch.vendorId, user: { status: "ACTIVE" } }, select: { userId: true } })).map((u) => u.userId));
  }
  if (ch.type === "CREW") {
    const crew = await tx.crewAssignment.findMany({ where: { eventId: ch.eventId, status: ON_CREW, worker: { userId: { not: null } } }, select: { worker: { select: { userId: true } } } });
    ids.push(...crew.map((c) => c.worker.userId!));
  }
  return [...new Set(ids)];
}

async function syncMembers(tx: DbTx, ch: { id: string; type: string; eventId: string | null; vendorId: string | null }) {
  const ids = await naturalMembers(tx, ch);
  if (ids.length) await tx.channelMember.createMany({ data: ids.map((userId) => ({ channelId: ch.id, userId })), skipDuplicates: true });
}

// ───────────────────────────── Opening a conversation ─────────────────────────────

export const openSchema = z.object({ type: z.enum(["BOOKING_TEAM", "VENDOR_THREAD", "CREW"]), eventId: z.string().uuid(), vendorId: z.string().uuid().optional() });

/** Finds or starts the conversation, if this person may take part in it. Returns its id. */
export async function openChannel(db: Db, actor: Actor, input: z.input<typeof openSchema>): Promise<string> {
  const v = parseInput(openSchema, input);
  if (v.type === "VENDOR_THREAD" && !v.vendorId) throw new ValidationError("Pick the vendor.");
  if (actor.accountType === "VENDOR" && v.vendorId && !actor.vendorIds.includes(v.vendorId)) throw new NotFoundError("That conversation");
  return db.$transaction(async (tx) => {
    const event = await tx.event.findUnique({ where: { id: v.eventId }, select: { name: true } });
    if (!event) throw new NotFoundError("That booking");
    let name: string;
    if (v.type === "VENDOR_THREAD") {
      const job = await tx.vendorAssignment.findFirst({ where: { eventId: v.eventId, vendorId: v.vendorId, status: LIVE_JOB }, select: { vendor: { select: { companyName: true } } } });
      if (!job) throw new ConflictError("This vendor has no job on the booking.");
      name = `${job.vendor.companyName} · ${event.name}`;
    } else name = `${v.type === "CREW" ? "Crew" : "Team"} · ${event.name}`;
    // One conversation of each kind per booking (and vendor): serialise concurrent starts.
    const key = `channel:${v.type}:${v.eventId}:${v.vendorId ?? ""}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    let ch = await tx.channel.findFirst({ where: { type: v.type, eventId: v.eventId, vendorId: v.vendorId ?? null } });
    if (!ch) {
      // Check access before creating, against what the channel would be.
      const allowed = await tx.event.count({ where: { AND: [{ id: v.eventId }, accessForNew(actor, v.type, v.vendorId)] } });
      if (!allowed) throw new ForbiddenError("You can't start this conversation.");
      ch = await tx.channel.create({ data: { type: v.type, eventId: v.eventId, vendorId: v.vendorId ?? null, name } });
      await syncMembers(tx, ch);
    }
    await assertChannelAccess(tx, actor, ch.id);
    return ch.id;
  });
}

/** Bookings on which this person may start a conversation of this kind (mirrors channelWhere). */
function accessForNew(actor: Actor, type: ChannelKind, vendorId?: string): Prisma.EventWhereInput {
  if (actor.status !== "ACTIVE") return NOTHING;
  switch (actor.accountType) {
    case "INTERNAL":
      if (type === "BOOKING_TEAM") return can(actor, "chat.booking") ? eventWhere(actor, "chat.booking") : NOTHING;
      return can(actor, "chat.direct") ? eventWhere(actor, "chat.direct") : NOTHING;
    case "VENDOR":
      return type === "VENDOR_THREAD" && can(actor, "chat.direct") && vendorId && actor.vendorIds.includes(vendorId) ? { vendorAssignments: { some: { vendorId, status: LIVE_JOB } } } : NOTHING;
    case "LABOUR":
      return type === "CREW" && can(actor, "chat.direct") && actor.workerId ? { crewAssignments: { some: { workerId: actor.workerId, status: ON_CREW } } } : NOTHING;
  }
}

// ───────────────────────────── Listing and reading ─────────────────────────────

export interface ChannelSummary {
  id: string;
  type: ChannelKind;
  name: string;
  event: { id: string; name: string; startDate: Date | null } | null;
  last: { body: string; from: string | null; at: Date; mine: boolean } | null;
  unread: number;
}

async function unreadIn(tx: DbTx, channelId: string, userId: string, since: Date | null) {
  return tx.message.count({ where: { channelId, deletedAt: null, senderId: { not: userId }, ...(since ? { createdAt: { gt: since } } : {}) } });
}

export async function listChannels(db: Db, actor: Actor): Promise<ChannelSummary[]> {
  const channels = await db.channel.findMany({
    where: channelWhere(actor),
    include: {
      event: { select: { id: true, name: true, startDate: true } },
      members: { where: { userId: actor.userId }, select: { lastReadAt: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, include: { sender: { select: { name: true } } } },
    },
    take: 200,
  });
  const out: ChannelSummary[] = [];
  for (const c of channels) {
    const m = c.messages[0];
    const member = c.members[0];
    out.push({
      id: c.id,
      type: c.type as ChannelKind,
      name: c.name,
      event: c.event,
      last: m ? { body: m.deletedAt ? "Message removed" : m.body || "Attachment", from: m.sender?.name ?? null, at: m.createdAt, mine: m.senderId === actor.userId } : null,
      unread: member ? await unreadIn(db, c.id, actor.userId, member.lastReadAt) : 0,
    });
  }
  return out.sort((a, b) => (b.last?.at.getTime() ?? 0) - (a.last?.at.getTime() ?? 0));
}

/** Unread messages across the conversations this person belongs to (for the menu badge). */
export async function unreadTotal(db: Db, actor: Actor): Promise<number> {
  const memberships = await db.channelMember.findMany({ where: { userId: actor.userId, channel: channelWhere(actor) }, select: { channelId: true, lastReadAt: true }, take: 100 });
  let n = 0;
  for (const m of memberships) n += await unreadIn(db, m.channelId, actor.userId, m.lastReadAt);
  return n;
}

export async function readThread(db: Db, actor: Actor, channelId: string, opts: { limit?: number } = {}) {
  const ch = await assertChannelAccess(db, actor, channelId);
  const rows = await db.message.findMany({
    where: { channelId },
    orderBy: { createdAt: "desc" },
    take: opts.limit ?? 100,
    include: { sender: { select: { id: true, name: true, accountType: true } }, attachments: { include: { file: { select: MEDIA_SELECT } } } },
  });
  // Reading marks it read (and joins owners and others who open it from outside the team).
  await db.channelMember.upsert({ where: { channelId_userId: { channelId, userId: actor.userId } }, create: { channelId, userId: actor.userId, lastReadAt: new Date() }, update: { lastReadAt: new Date() } });
  const now = Date.now();
  return {
    id: ch.id,
    type: ch.type as ChannelKind,
    name: ch.name,
    event: ch.event,
    vendorId: ch.vendorId,
    messages: rows.reverse().map((m) => ({
      id: m.id,
      body: m.deletedAt ? "" : m.body,
      deleted: Boolean(m.deletedAt),
      at: m.createdAt,
      mine: m.senderId === actor.userId,
      canDelete: m.senderId === actor.userId && !m.deletedAt && now - m.createdAt.getTime() < DELETE_WINDOW_MS,
      from: m.sender ? { name: m.sender.name, kind: m.sender.accountType } : null,
      attachments: m.deletedAt ? [] : m.attachments.map((a) => mediaView(actor.userId, a.file, { original: true })),
    })),
  };
}

export type Thread = Awaited<ReturnType<typeof readThread>>;

// ───────────────────────────── Writing ─────────────────────────────

export const messageSchema = z.object({
  body: z.string().trim().max(2000, "Keep it under 2,000 characters.").default(""),
  fileId: z.union([z.literal(""), z.string().uuid()]).optional(),
});

export async function postMessage(db: Db, actor: Actor, channelId: string, input: z.input<typeof messageSchema>) {
  const v = parseInput(messageSchema, input);
  if (!v.body && !v.fileId) throw new ValidationError("Write a message or attach a file.", { body: "Write a message." });
  checkRate(actor.userId, "message.post");
  const result = await db.$transaction(async (tx) => {
    const ch = await assertChannelAccess(tx, actor, channelId);
    if (v.fileId) {
      const f = await tx.file.findFirst({ where: { id: v.fileId, uploadedById: actor.userId, purpose: "DOCUMENT", status: "READY" }, select: { _count: { select: { messageAttachments: true, documents: true, expenseReceipts: true } } } });
      if (!f || f._count.messageAttachments || f._count.documents || f._count.expenseReceipts) throw new ValidationError("Attach the file and wait for it to finish uploading.", { fileId: "Attach the file again." });
    }
    await syncMembers(tx, ch);
    // Who should hear about it: members whose last read is after the previous message.
    const previous = await tx.message.findFirst({ where: { channelId, deletedAt: null }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    const msg = await tx.message.create({ data: { channelId, senderId: actor.userId, body: v.body, attachments: v.fileId ? { create: { fileId: v.fileId } } : undefined } });
    await tx.channelMember.upsert({ where: { channelId_userId: { channelId, userId: actor.userId } }, create: { channelId, userId: actor.userId, lastReadAt: msg.createdAt }, update: { lastReadAt: msg.createdAt } });
    const members = await tx.channelMember.findMany({ where: { channelId, userId: { not: actor.userId }, user: { status: "ACTIVE" } }, select: { userId: true, lastReadAt: true, user: { select: { accountType: true } } } });
    const caughtUp = members.filter((m) => !previous || (m.lastReadAt && m.lastReadAt >= previous.createdAt));
    for (const kind of ["INTERNAL", "VENDOR", "LABOUR"] as const) {
      const ids = caughtUp.filter((m) => m.user.accountType === kind).map((m) => m.userId);
      if (ids.length) await notify(tx, ids, { type: "chat.message", title: `${actor.name} in ${ch.name}`, body: v.body ? v.body.slice(0, 140) : "Sent a file", link: `${messagesBase(kind)}/${channelId}`, entityType: "channel", entityId: channelId });
    }
    return { id: msg.id };
  });
  publish(`channel:${channelId}`, { messageId: result.id });
  return result;
}

export async function deleteMessage(db: Db, actor: Actor, messageId: string) {
  const m = await db.message.findUnique({ where: { id: messageId }, select: { channelId: true, senderId: true, createdAt: true, deletedAt: true } });
  if (!m || m.senderId !== actor.userId) throw new NotFoundError("That message");
  await assertChannelAccess(db, actor, m.channelId);
  if (m.deletedAt) return;
  if (Date.now() - m.createdAt.getTime() > DELETE_WINDOW_MS) throw new ConflictError("Messages can only be removed in the first 15 minutes.");
  await db.message.update({ where: { id: messageId }, data: { deletedAt: new Date(), body: "" } });
  publish(`channel:${m.channelId}`, { messageId });
}

export function messagesBase(accountType: string) {
  return accountType === "VENDOR" ? "/vendor/messages" : accountType === "LABOUR" ? "/crew/messages" : "/messages";
}

/** For the stream route: may this person listen to this conversation? */
export async function canListen(db: Db, actor: Actor, channelId: string) {
  return (await db.channel.count({ where: { AND: [{ id: channelId }, channelWhere(actor)] } })) > 0;
}
