/**
 * Work proof: photos and videos of completed work (ARCHITECTURE.md §4 "Work proof").
 *
 *   add:    the vendor (their own job, once the work order is accepted), the crew member (their own
 *           booking) or the assignee of a task uploads files, then attaches them here with an
 *           optional caption and the phone's location. Staff with proof.upload may add proof on
 *           bookings they reach.
 *   review: the booking's manager or supervisor (or an owner) approves each item, or asks for it
 *           to be redone with a note. Nobody but an owner approves their own upload.
 *
 * Each person sees only the proof the policy layer allows (proofWhere).
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { Db, DbTx } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { toNumber } from "@/lib/format";
import { parseInput } from "@/lib/validate";
import { recordAudit, type RequestMeta } from "@/modules/audit/audit";
import { MEDIA_SELECT, mediaView, type MediaView } from "@/modules/files/media";
import type { Actor } from "@/modules/identity/actor";
import { assertCan, assertEventAccess, can, proofWhere } from "@/modules/identity/policy";
import { bookingTeamUserIds, notify } from "@/modules/notifications/notify";

export const PROOF_TARGETS = ["vendorJob", "crewAssignment", "task"] as const;
export type ProofTargetKind = (typeof PROOF_TARGETS)[number];

/** Vendor job stages where proof makes sense: after the work order is accepted. */
const JOB_STAGES_FOR_PROOF = ["ACCEPTED", "IN_PROGRESS", "DELIVERED", "COMPLETED"];
const CREW_STAGES_FOR_PROOF = ["ASSIGNED", "CONFIRMED", "COMPLETED"];

export const addProofSchema = z.object({
  target: z.object({ kind: z.enum(PROOF_TARGETS), id: z.string().uuid() }),
  fileIds: z.array(z.string().uuid()).min(1, "Add a photo or video first.").max(12, "Up to 12 at a time."),
  caption: z.string().trim().max(300, "Keep the note under 300 characters.").optional(),
  functionId: z.string().uuid().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});
export type AddProofInput = z.input<typeof addProofSchema>;

interface ResolvedTarget {
  eventId: string;
  eventName: string;
  functionId: string | null;
  label: string;
  link: { taskId?: string; vendorAssignmentId?: string; crewAssignmentId?: string };
}

function nearestBy<T>(items: T[], when: (t: T) => Date, now = Date.now()): T | undefined {
  return [...items].sort((x, y) => Math.abs(when(x).getTime() - now) - Math.abs(when(y).getTime() - now))[0];
}

/** Finds the thing the proof is about and checks this person may add proof to it. */
async function resolveTarget(tx: DbTx, actor: Actor, kind: ProofTargetKind, id: string): Promise<ResolvedTarget> {
  const scope = assertCan(actor, "proof.upload", "You can't add proof.");
  const staff = actor.accountType === "INTERNAL";

  if (kind === "vendorJob") {
    const job = await tx.vendorAssignment.findUnique({
      where: { id },
      include: { vendor: { select: { companyName: true } }, event: { select: { name: true } }, functions: { select: { functionId: true, function: { select: { startsAt: true } } } } },
    });
    if (!job) throw new NotFoundError("That job");
    if (actor.accountType === "VENDOR") {
      if (!actor.vendorIds.includes(job.vendorId)) throw new NotFoundError("That job");
    } else if (staff) {
      if (scope !== "ALL") await assertEventAccess(tx, actor, job.eventId, "proof.upload");
    } else throw new NotFoundError("That job");
    if (!JOB_STAGES_FOR_PROOF.includes(job.status)) throw new ConflictError("Proof can be added once the work order is accepted.");
    return {
      eventId: job.eventId,
      eventName: job.event.name,
      // The function happening nearest to now (today's, on a multi-day job).
      functionId: nearestBy(job.functions, (f) => f.function.startsAt)?.functionId ?? null,
      label: `${job.vendor.companyName} · ${job.scopeOfWork}`,
      link: { vendorAssignmentId: job.id },
    };
  }

  if (kind === "crewAssignment") {
    const a = await tx.crewAssignment.findUnique({
      where: { id },
      include: { worker: { select: { name: true } }, event: { select: { name: true } }, shifts: { select: { functionId: true, date: true, reportAt: true }, orderBy: { reportAt: "asc" } } },
    });
    if (!a) throw new NotFoundError("That booking");
    if (actor.accountType === "LABOUR") {
      if (actor.workerId !== a.workerId) throw new NotFoundError("That booking");
    } else if (staff) {
      if (scope !== "ALL") await assertEventAccess(tx, actor, a.eventId, "proof.upload");
    } else throw new NotFoundError("That booking");
    if (!CREW_STAGES_FOR_PROOF.includes(a.status)) throw new ConflictError("This booking is closed for proof.");
    // The function of today's shift (or the nearest one), so the proof lands on the right function.
    const nearest = nearestBy(a.shifts, (s) => s.reportAt);
    return {
      eventId: a.eventId,
      eventName: a.event.name,
      functionId: nearest?.functionId ?? null,
      label: `${a.worker.name} · ${a.duty}`,
      link: { crewAssignmentId: a.id },
    };
  }

  const task = await tx.task.findUnique({ where: { id }, include: { event: { select: { name: true } } } });
  if (!task) throw new NotFoundError("That task");
  if (task.assigneeId !== actor.userId) {
    if (!staff) throw new NotFoundError("That task");
    if (scope !== "ALL") {
      if (!task.eventId) throw new NotFoundError("That task");
      await assertEventAccess(tx, actor, task.eventId, "proof.upload");
    }
  }
  if (!task.eventId || !task.event) throw new ConflictError("Proof can only be added to tasks on a booking.");
  if (task.status === "CANCELLED") throw new ConflictError("This task was cancelled.");
  return { eventId: task.eventId, eventName: task.event.name, functionId: task.functionId, label: task.title, link: { taskId: task.id } };
}

export async function addProof(db: Db, actor: Actor, input: AddProofInput, meta: RequestMeta = {}) {
  const v = parseInput(addProofSchema, input);
  if ((v.latitude === undefined) !== (v.longitude === undefined)) throw new ValidationError("Location needs both latitude and longitude.");
  return db.$transaction(async (tx) => {
    const target = await resolveTarget(tx, actor, v.target.kind, v.target.id);
    const ids = [...new Set(v.fileIds)];
    const files = await tx.file.findMany({
      where: { id: { in: ids }, uploadedById: actor.userId, purpose: "PROOF", status: { in: ["PROCESSING", "READY"] } },
      select: { id: true, mimeType: true, _count: { select: { proofs: true } } },
    });
    if (files.length !== ids.length) throw new ValidationError("Some files are still uploading or could not be used. Remove them and try again.");
    if (files.some((f) => f._count.proofs > 0)) throw new ConflictError("A file was already sent as proof.");

    let functionId = target.functionId;
    if (v.functionId) {
      const fn = await tx.eventFunction.count({ where: { id: v.functionId, eventId: target.eventId } });
      if (!fn) throw new ValidationError("Pick a function from this booking.");
      functionId = v.functionId;
    }

    await tx.workProof.createMany({
      data: files.map((f) => ({
        eventId: target.eventId,
        functionId,
        ...target.link,
        kind: f.mimeType.startsWith("video/") ? ("VIDEO" as const) : ("PHOTO" as const),
        fileId: f.id,
        caption: v.caption || null,
        latitude: v.latitude ?? null,
        longitude: v.longitude ?? null,
        uploadedById: actor.userId,
      })),
    });

    const videos = files.filter((f) => f.mimeType.startsWith("video/")).length;
    const what = [files.length - videos ? `${files.length - videos} photo${files.length - videos === 1 ? "" : "s"}` : "", videos ? `${videos} video${videos === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ");
    await notify(
      tx,
      await bookingTeamUserIds(tx, target.eventId, ["MANAGER", "SUPERVISOR"]),
      {
        type: "proof.submitted",
        title: `New proof: ${target.label}`,
        body: `${what} from ${actor.name}${v.caption ? ` · ${v.caption}` : ""}`,
        link: `/proof?booking=${target.eventId}`,
        entityType: "event",
        entityId: target.eventId,
      },
      { exceptUserId: actor.userId },
    );
    await recordAudit(tx, actor, { action: "create", entityType: "work_proof", entityId: target.eventId, summary: `${actor.name} added ${what} as proof: ${target.label} (${target.eventName})` }, meta);
    return { count: files.length, eventId: target.eventId };
  });
}

// ───────────────────────────── Review ─────────────────────────────

export const reviewProofSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  note: z.string().trim().max(500).optional(),
});

function uploaderLink(p: { vendorAssignmentId: string | null; crewAssignmentId: string | null; taskId: string | null; eventId: string }, accountType: string): string {
  if (accountType === "VENDOR" && p.vendorAssignmentId) return `/vendor/jobs/${p.vendorAssignmentId}`;
  if (accountType === "LABOUR") return "/crew";
  return `/proof?booking=${p.eventId}`;
}

export async function reviewProof(db: Db, actor: Actor, proofId: string, input: z.input<typeof reviewProofSchema>, meta: RequestMeta = {}) {
  const v = parseInput(reviewProofSchema, input);
  if (v.decision === "REJECT" && !v.note) throw new ValidationError("Say what needs to be redone.", { note: "A note is needed." });
  return db.$transaction(async (tx) => {
    if (actor.accountType !== "INTERNAL") throw new ForbiddenError("Only the team can check proof.");
    assertCan(actor, "proof.review", "You can't check proof.");
    const proof = await tx.workProof.findFirst({
      where: { AND: [{ id: proofId }, proofWhere(actor, "proof.review")] },
      include: {
        file: { select: { status: true } },
        uploadedBy: { select: { id: true, name: true, accountType: true } },
        event: { select: { name: true } },
        task: { select: { title: true } },
        vendorAssignment: { select: { scopeOfWork: true, vendor: { select: { companyName: true } } } },
        crewAssignment: { select: { duty: true } },
      },
    });
    if (!proof) throw new NotFoundError("That proof");
    if (proof.status !== "PENDING_REVIEW") throw new ConflictError("This proof has already been checked.");
    if (v.decision === "APPROVE" && proof.file.status !== "READY") throw new ConflictError("This file isn't ready to view yet, so it can't be approved.");
    if (v.decision === "APPROVE" && proof.uploadedById === actor.userId && !actor.isOwner) throw new ForbiddenError("Someone else on the team should approve your own proof.");

    await tx.workProof.update({
      where: { id: proof.id },
      data: { status: v.decision === "APPROVE" ? "APPROVED" : "REJECTED", reviewedById: actor.userId, reviewedAt: new Date(), reviewNote: v.note || null },
    });
    const about = proof.task?.title ?? proof.vendorAssignment?.scopeOfWork ?? proof.crewAssignment?.duty ?? proof.event.name;
    await notify(
      tx,
      [proof.uploadedById],
      v.decision === "APPROVE"
        ? { type: "proof.approved", title: `Proof approved: ${about}`, body: proof.caption ?? proof.event.name, link: uploaderLink(proof, proof.uploadedBy.accountType), entityType: "work_proof", entityId: proof.id }
        : { type: "proof.rejected", title: `Please redo: ${about}`, body: v.note!, link: uploaderLink(proof, proof.uploadedBy.accountType), entityType: "work_proof", entityId: proof.id },
      { exceptUserId: actor.userId },
    );
    await recordAudit(
      tx,
      actor,
      {
        action: v.decision === "APPROVE" ? "approve" : "reject",
        entityType: "work_proof",
        entityId: proof.id,
        summary: `${v.decision === "APPROVE" ? "Approved" : "Asked to redo"} proof from ${proof.uploadedBy.name}: ${about} (${proof.event.name})${v.note ? ` · ${v.note}` : ""}`,
      },
      meta,
    );
  });
}

// ───────────────────────────── Reading ─────────────────────────────

export interface ProofItem {
  id: string;
  kind: "PHOTO" | "VIDEO";
  status: "PENDING_REVIEW" | "APPROVED" | "REJECTED";
  caption: string | null;
  createdAt: Date;
  uploadedBy: string;
  uploadedByMe: boolean;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  event: { id: string; name: string; code: string };
  functionName: string | null;
  about: string;
  aboutKind: ProofTargetKind;
  /** Metres from the venue, when both the phone and the venue have a location. */
  distanceFromVenue: number | null;
  location: { latitude: number; longitude: number } | null;
  media: MediaView;
  canReview: boolean;
}

const PROOF_INCLUDE = {
  file: { select: MEDIA_SELECT },
  uploadedBy: { select: { id: true, name: true } },
  reviewedBy: { select: { name: true } },
  event: { select: { id: true, name: true, code: true } },
  function: { select: { name: true, venue: { select: { latitude: true, longitude: true } } } },
  task: { select: { title: true } },
  vendorAssignment: { select: { scopeOfWork: true, vendor: { select: { companyName: true } } } },
  crewAssignment: { select: { duty: true, worker: { select: { name: true } } } },
} satisfies Prisma.WorkProofInclude;

type ProofRow = Prisma.WorkProofGetPayload<{ include: typeof PROOF_INCLUDE }>;

/** Great-circle distance in metres. */
export function metresBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const R = 6371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

function toItem(actor: Actor, p: ProofRow, reviewer: boolean): ProofItem {
  const location = p.latitude !== null && p.longitude !== null ? { latitude: toNumber(p.latitude), longitude: toNumber(p.longitude) } : null;
  const venue = p.function?.venue;
  const venueLoc = venue?.latitude != null && venue?.longitude != null ? { latitude: toNumber(venue.latitude), longitude: toNumber(venue.longitude) } : null;
  const about = p.task
    ? { about: p.task.title, aboutKind: "task" as const }
    : p.vendorAssignment
      ? { about: `${p.vendorAssignment.vendor.companyName} · ${p.vendorAssignment.scopeOfWork}`, aboutKind: "vendorJob" as const }
      : { about: p.crewAssignment ? `${p.crewAssignment.worker.name} · ${p.crewAssignment.duty}` : "Proof", aboutKind: "crewAssignment" as const };
  return {
    id: p.id,
    kind: p.kind,
    status: p.status,
    caption: p.caption,
    createdAt: p.createdAt,
    uploadedBy: p.uploadedBy.name,
    uploadedByMe: p.uploadedById === actor.userId,
    reviewedBy: p.reviewedBy?.name ?? null,
    reviewedAt: p.reviewedAt,
    reviewNote: p.reviewNote,
    event: p.event,
    functionName: p.function?.name ?? null,
    ...about,
    distanceFromVenue: location && venueLoc ? metresBetween(location, venueLoc) : null,
    // The exact spot is for the people who check proof; everyone else sees only their own.
    location: reviewer || p.uploadedById === actor.userId ? location : null,
    media: mediaView(actor.userId, p.file, { original: reviewer }),
    canReview: reviewer && p.status === "PENDING_REVIEW" && (actor.isOwner || p.uploadedById !== actor.userId),
  };
}

export interface ProofFilter {
  eventId?: string;
  status?: "PENDING_REVIEW" | "APPROVED" | "REJECTED";
  target?: { kind: ProofTargetKind; id: string };
  take?: number;
}

/** Proof this person may see, newest first, with links made for them. */
export async function listProof(db: DbTx, actor: Actor, filter: ProofFilter = {}): Promise<ProofItem[]> {
  if (!can(actor, "proof.view") && !can(actor, "proof.upload")) return [];
  const reviewerWhere = can(actor, "proof.review") ? proofWhere(actor, "proof.review") : null;
  const visible: Prisma.WorkProofWhereInput = can(actor, "proof.view") ? proofWhere(actor, "proof.view") : { uploadedById: actor.userId };
  const targetWhere: Prisma.WorkProofWhereInput = filter.target
    ? filter.target.kind === "task"
      ? { taskId: filter.target.id }
      : filter.target.kind === "vendorJob"
        ? { vendorAssignmentId: filter.target.id }
        : { crewAssignmentId: filter.target.id }
    : {};
  const rows = await db.workProof.findMany({
    where: { AND: [visible, targetWhere, filter.eventId ? { eventId: filter.eventId } : {}, filter.status ? { status: filter.status } : {}] },
    orderBy: { createdAt: "desc" },
    take: filter.take ?? 120,
    include: PROOF_INCLUDE,
  });
  // Which of these rows may this person review? (Their review scope can be narrower than their view scope.)
  const reviewable = reviewerWhere
    ? new Set((await db.workProof.findMany({ where: { AND: [{ id: { in: rows.map((r) => r.id) } }, reviewerWhere] }, select: { id: true } })).map((r) => r.id))
    : new Set<string>();
  return rows.map((r) => toItem(actor, r, reviewable.has(r.id)));
}

/** Redo requests the uploader has not answered yet: asked after their latest upload here. */
export function openRedoRequests(items: ProofItem[]): ProofItem[] {
  const mine = items.filter((p) => p.uploadedByMe);
  const lastSent = Math.max(0, ...mine.map((p) => p.createdAt.getTime()));
  return mine.filter((p) => p.status === "REJECTED" && p.reviewedAt && p.reviewedAt.getTime() >= lastSent);
}

/** How many items wait for this person to check. */
export async function proofToCheckCount(db: DbTx, actor: Actor): Promise<number> {
  if (actor.accountType !== "INTERNAL" || !can(actor, "proof.review")) return 0;
  return db.workProof.count({ where: { AND: [proofWhere(actor, "proof.review"), { status: "PENDING_REVIEW" }, actor.isOwner ? {} : { uploadedById: { not: actor.userId } }] } });
}
