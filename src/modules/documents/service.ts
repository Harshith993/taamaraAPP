/**
 * Booking documents: contracts, plans, designs, menus, layouts (ARCHITECTURE §7 "Documents").
 *
 * Who sees a document (always on top of reaching the booking with documents.view):
 *   OWNER_ONLY    owners (documents.confidential)
 *   BOOKING_TEAM  owners and the booking's managers and supervisors
 *   INTERNAL      every staff member who can reach the booking (adds the accountant)
 *   SHARED        as INTERNAL, plus the vendors it is shared with and, if chosen, the booking's crew
 *
 * Staff with documents.upload add documents; the uploader or an owner removes them. The file goes up
 * through the normal upload pipeline (purpose DOCUMENT: PDF or photo).
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/validate";
import { recordAudit, type RequestMeta } from "@/modules/audit/audit";
import { MEDIA_SELECT, mediaView } from "@/modules/files/media";
import type { Actor } from "@/modules/identity/actor";
import { assertCan, assertEventAccess, can } from "@/modules/identity/policy";
import { notify, vendorUserIds } from "@/modules/notifications/notify";

export const DOCUMENT_KINDS = ["CONTRACT", "PLAN", "DESIGN", "QUOTATION", "INVOICE", "PHOTO", "OTHER"] as const;
export const KIND_WORDS: Record<string, string> = { CONTRACT: "Contract", PLAN: "Plan / layout", DESIGN: "Design", QUOTATION: "Quotation", INVOICE: "Invoice", PHOTO: "Photo", VIDEO: "Video", OTHER: "Other" };
export const VISIBILITY_WORDS: Record<string, string> = { OWNER_ONLY: "Owners only", BOOKING_TEAM: "Booking team", INTERNAL: "All staff", SHARED: "Shared" };

/** The documents filter for one person on one booking. */
function visibleWhere(actor: Actor, eventId: string, onTeam: boolean): Prisma.DocumentWhereInput {
  const base: Prisma.DocumentWhereInput = { eventId };
  if (actor.accountType === "VENDOR") {
    return { ...base, visibility: "SHARED", shares: { some: { target: "VENDOR", vendorId: { in: actor.vendorIds } } } };
  }
  if (actor.accountType === "LABOUR") {
    return { ...base, visibility: "SHARED", shares: { some: { OR: [{ target: "BOOKING_CREW" }, { target: "USER", userId: actor.userId }] } } };
  }
  const levels: ("OWNER_ONLY" | "BOOKING_TEAM" | "INTERNAL" | "SHARED")[] = ["INTERNAL", "SHARED"];
  if (onTeam || actor.isOwner) levels.push("BOOKING_TEAM");
  if (can(actor, "documents.confidential")) levels.push("OWNER_ONLY");
  return { ...base, visibility: { in: levels } };
}

async function onBookingTeam(db: Db, actor: Actor, eventId: string) {
  if (actor.isOwner) return true;
  return (await db.eventMember.count({ where: { eventId, userId: actor.userId } })) > 0;
}

export const addDocumentSchema = z.object({
  eventId: z.string().uuid(),
  title: z.string().trim().min(2, "Give the document a name.").max(120),
  kind: z.enum(DOCUMENT_KINDS),
  visibility: z.enum(["OWNER_ONLY", "BOOKING_TEAM", "INTERNAL", "SHARED"]),
  fileId: z.string().uuid("Attach the file."),
  shareVendorIds: z.array(z.string().uuid()).max(30).default([]),
  shareWithCrew: z.boolean().default(false),
});
export type AddDocumentInput = z.input<typeof addDocumentSchema>;

export async function addDocument(db: Db, actor: Actor, input: AddDocumentInput, meta: RequestMeta = {}) {
  const v = parseInput(addDocumentSchema, input);
  if (actor.accountType !== "INTERNAL") throw new ForbiddenError("Only the team adds booking documents.");
  assertCan(actor, "documents.upload", "You can't add documents.");
  if (v.visibility === "OWNER_ONLY" && !can(actor, "documents.confidential")) throw new ForbiddenError("Only owners keep owner-only documents.");
  if (v.visibility === "SHARED" && !v.shareVendorIds.length && !v.shareWithCrew) throw new ValidationError("Pick who to share it with.", { share: "Pick vendors or the crew." });
  return db.$transaction(async (tx) => {
    await assertEventAccess(tx, actor, v.eventId, "documents.upload");
    const file = await tx.file.findFirst({ where: { id: v.fileId, uploadedById: actor.userId, purpose: "DOCUMENT", status: "READY" }, select: { id: true, _count: { select: { documents: true } } } });
    if (!file || file._count.documents) throw new ValidationError("Attach the file and wait for it to finish uploading.", { fileId: "Attach the file." });
    const vendorIds = v.visibility === "SHARED" ? [...new Set(v.shareVendorIds)] : [];
    if (vendorIds.length) {
      const onBooking = await tx.vendorAssignment.findMany({ where: { eventId: v.eventId, vendorId: { in: vendorIds }, status: { notIn: ["DECLINED", "CANCELLED"] } }, select: { vendorId: true } });
      if (new Set(onBooking.map((o) => o.vendorId)).size !== vendorIds.length) throw new ValidationError("Share only with vendors on this booking.", { share: "Share only with vendors on this booking." });
    }
    const event = await tx.event.findUniqueOrThrow({ where: { id: v.eventId }, select: { name: true } });
    const doc = await tx.document.create({
      data: {
        eventId: v.eventId,
        kind: v.kind,
        title: v.title,
        fileId: file.id,
        visibility: v.visibility,
        uploadedById: actor.userId,
        shares: {
          create: [...vendorIds.map((vendorId) => ({ target: "VENDOR" as const, vendorId })), ...(v.visibility === "SHARED" && v.shareWithCrew ? [{ target: "BOOKING_CREW" as const }] : [])],
        },
      },
    });
    for (const vendorId of vendorIds) {
      const job = await tx.vendorAssignment.findFirst({ where: { eventId: v.eventId, vendorId, status: { notIn: ["DECLINED", "CANCELLED"] } }, select: { id: true } });
      await notify(tx, await vendorUserIds(tx, vendorId), { type: "document.shared", title: `New document: ${v.title}`, body: event.name, link: job ? `/vendor/jobs/${job.id}` : "/vendor", entityType: "document", entityId: doc.id });
    }
    if (v.visibility === "SHARED" && v.shareWithCrew) {
      const crew = await tx.crewAssignment.findMany({ where: { eventId: v.eventId, status: { in: ["ASSIGNED", "CONFIRMED"] } }, select: { worker: { select: { userId: true } } } });
      await notify(tx, crew.map((c) => c.worker.userId), { type: "document.shared", title: `New document: ${v.title}`, body: event.name, link: "/crew", entityType: "document", entityId: doc.id });
    }
    await recordAudit(tx, actor, { action: "create", entityType: "document", entityId: doc.id, summary: `Added ${KIND_WORDS[v.kind].toLowerCase()} "${v.title}" to ${event.name} (${VISIBILITY_WORDS[v.visibility].toLowerCase()})` }, meta);
    return { id: doc.id };
  });
}

export async function removeDocument(db: Db, actor: Actor, documentId: string, meta: RequestMeta = {}) {
  return db.$transaction(async (tx) => {
    const doc = await tx.document.findUnique({ where: { id: documentId }, select: { id: true, title: true, eventId: true, uploadedById: true, kind: true } });
    if (!doc || !doc.eventId) throw new NotFoundError("That document");
    if (actor.accountType !== "INTERNAL" || (!actor.isOwner && doc.uploadedById !== actor.userId)) throw new ForbiddenError("Only the person who added it, or an owner, can remove it.");
    if (doc.kind === "INVOICE" && !actor.isOwner) throw new ForbiddenError("Only owners remove invoices.");
    await tx.document.delete({ where: { id: doc.id } });
    await recordAudit(tx, actor, { action: "delete", entityType: "document", entityId: doc.id, summary: `Removed "${doc.title}"` }, meta);
  });
}

/** Documents on a booking this person may see, with signed links. */
export async function listDocuments(db: Db, actor: Actor, eventId: string) {
  if (!can(actor, "documents.view")) return [];
  if (actor.accountType === "INTERNAL") await assertEventAccess(db, actor, eventId, "documents.view");
  const onTeam = actor.accountType === "INTERNAL" ? await onBookingTeam(db, actor, eventId) : false;
  const rows = await db.document.findMany({
    where: visibleWhere(actor, eventId, onTeam),
    orderBy: { createdAt: "desc" },
    include: {
      file: { select: MEDIA_SELECT },
      shares: { select: { target: true, vendor: { select: { companyName: true } } } },
    },
  });
  const uploaders = await db.user.findMany({ where: { id: { in: rows.map((r) => r.uploadedById).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } });
  return rows.map((d) => ({
    id: d.id,
    title: d.title,
    kind: d.kind,
    visibility: d.visibility,
    createdAt: d.createdAt,
    uploadedBy: uploaders.find((u) => u.id === d.uploadedById)?.name ?? null,
    canRemove: actor.accountType === "INTERNAL" && (actor.isOwner || d.uploadedById === actor.userId),
    // Staff see who it is shared with; vendors and crew only see the document.
    sharedWith: actor.accountType === "INTERNAL" ? d.shares.map((s) => (s.target === "BOOKING_CREW" ? "Crew" : (s.vendor?.companyName ?? "Someone"))) : [],
    file: mediaView(actor.userId, d.file, { original: true }),
  }));
}

/** For crew: documents shared with the crew of their upcoming bookings. */
export async function crewDocuments(db: Db, actor: Actor) {
  if (actor.accountType !== "LABOUR" || !actor.workerId || !can(actor, "documents.view")) return [];
  const events = await db.crewAssignment.findMany({ where: { workerId: actor.workerId, status: { in: ["ASSIGNED", "CONFIRMED"] } }, select: { eventId: true, event: { select: { name: true } } } });
  const out: (Awaited<ReturnType<typeof listDocuments>>[number] & { eventName: string })[] = [];
  for (const e of events) for (const d of await listDocuments(db, actor, e.eventId)) out.push({ ...d, eventName: e.event.name });
  return out;
}
