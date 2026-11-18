/**
 * Uploads in small pieces, so a dropped venue connection resumes instead of starting over.
 *
 *   POST   /api/v1/uploads              start: purpose, file name, size, type  → upload id
 *   PUT    /api/v1/uploads/:id          one piece (at most 4 MB) at the offset the server expects
 *   GET    /api/v1/uploads/:id          how much has arrived (to resume)
 *   POST   /api/v1/uploads/:id/complete check the real file type, store it, start processing
 *   DELETE /api/v1/uploads/:id          throw away an upload that was not used
 *
 * Pieces are written to the server's disk (localRoot()/.incoming), then moved into storage. Only the
 * person who started an upload can add to it, finish it or attach it to something.
 * The file type is read from the first bytes on the first piece, so a wrong file is refused early.
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, open, rm, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { FilePurpose } from "@/generated/prisma/client";
import type { DbTx } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { localRoot, storage } from "@/lib/storage";
import { sniffType, type Sniffed, type SniffedKind } from "@/lib/storage/sniff";
import { parseInput } from "@/lib/validate";
import type { Actor } from "@/modules/identity/actor";
import { can } from "@/modules/identity/policy";

const MB = 1024 * 1024;

/** Each piece is at most this big: well under the 10 MB request buffer of the Next.js proxy. */
export const CHUNK_BYTES = 4 * MB;

/** Unfinished uploads a person may have open at once. */
const MAX_OPEN_UPLOADS = 40;

interface KindRule {
  maxBytes: number;
  label: string;
}

/** What each purpose accepts, by the type read from the file itself. */
export const UPLOAD_RULES: Record<FilePurpose, Partial<Record<SniffedKind, KindRule>>> = {
  PROOF: {
    image: { maxBytes: 25 * MB, label: "photo" },
    video: { maxBytes: 500 * MB, label: "video" },
  },
  DOCUMENT: {
    pdf: { maxBytes: 20 * MB, label: "PDF" },
    image: { maxBytes: 20 * MB, label: "photo" },
  },
};

const WHAT_FITS: Record<FilePurpose, string> = {
  PROOF: "a photo (JPEG, PNG, WebP) or a video (MP4, MOV, WebM)",
  DOCUMENT: "a PDF or a photo of the document",
};

export function maxBytesFor(purpose: FilePurpose, declaredType: string): number {
  const rules = UPLOAD_RULES[purpose];
  const declaredKind: SniffedKind | null = declaredType.startsWith("video/")
    ? "video"
    : declaredType.startsWith("image/")
      ? "image"
      : declaredType === "application/pdf"
        ? "pdf"
        : null;
  const rule = declaredKind ? rules[declaredKind] : undefined;
  return rule?.maxBytes ?? Math.max(...Object.values(rules).map((r) => r!.maxBytes));
}

function mayUpload(actor: Actor, purpose: FilePurpose): boolean {
  if (purpose === "PROOF") return can(actor, "proof.upload");
  return can(actor, "documents.upload") || can(actor, "quotes.submit") || can(actor, "expenses.record");
}

/** A file name safe to store and show: no folders, no control characters, the real extension. */
export function cleanFilename(name: string, sniffed?: Pick<Sniffed, "ext">): string {
  const base = path.basename(name.replace(/\\/g, "/")).replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "").trim() || "file";
  const stem = base.replace(/\.[^.]*$/, "").slice(0, 100) || "file";
  const ext = sniffed?.ext ?? (base.includes(".") ? base.split(".").pop()!.toLowerCase().slice(0, 8) : "");
  return ext ? `${stem}.${ext}` : stem;
}

function incomingPath(fileId: string): string {
  return path.join(localRoot(), ".incoming", `${fileId}.part`);
}

async function receivedBytes(fileId: string): Promise<number> {
  try {
    return (await stat(incomingPath(fileId))).size;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw err;
  }
}

async function readHead(filePath: string, bytes = 64): Promise<Uint8Array> {
  const fh = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

function checkKind(purpose: FilePurpose, sniffed: Sniffed | null, size: number): KindRule {
  const rule = sniffed ? UPLOAD_RULES[purpose][sniffed.kind] : undefined;
  if (!sniffed || !rule) throw new ValidationError(`This kind of file can't be used here. Please choose ${WHAT_FITS[purpose]}.`);
  if (size > rule.maxBytes) throw new ValidationError(`This ${rule.label} is too big. The limit is ${Math.round(rule.maxBytes / MB)} MB.`);
  return rule;
}

/** One upload at a time per file, so two pieces sent at once can never both be written. */
const locks = new Map<string, Promise<unknown>>();
async function withLock<T>(fileId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(fileId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  locks.set(fileId, next);
  try {
    return await next;
  } finally {
    if (locks.get(fileId) === next) locks.delete(fileId);
  }
}

async function loadOwnUpload(db: DbTx, actor: Actor, fileId: string) {
  const file = await db.file.findFirst({ where: { id: fileId, uploadedById: actor.userId } });
  if (!file) throw new NotFoundError("That upload");
  return file;
}

// ───────────────────────────── Start ─────────────────────────────

export const startUploadSchema = z.object({
  purpose: z.enum(["PROOF", "DOCUMENT"]),
  filename: z.string().trim().min(1, "The file has no name.").max(255),
  size: z.coerce.number().int().positive("The file is empty."),
  type: z.string().max(100).default(""),
});

export async function startUpload(db: DbTx, actor: Actor, input: z.input<typeof startUploadSchema>) {
  const v = parseInput(startUploadSchema, input);
  if (!mayUpload(actor, v.purpose)) throw new ForbiddenError("You can't upload files here.");
  const max = maxBytesFor(v.purpose, v.type);
  if (v.size > max) throw new ValidationError(`This file is too big. The limit is ${Math.round(max / MB)} MB.`);
  const open = await db.file.count({ where: { uploadedById: actor.userId, status: "UPLOADING" } });
  if (open >= MAX_OPEN_UPLOADS) throw new ConflictError("Too many uploads are unfinished. Please wait for them, or refresh the page.");

  const id = randomUUID();
  const month = new Date().toISOString().slice(0, 7);
  const file = await db.file.create({
    data: {
      id,
      storageKey: `${v.purpose.toLowerCase()}/${month}/${id}/original`,
      filename: cleanFilename(v.filename),
      mimeType: v.type || "application/octet-stream",
      sizeBytes: BigInt(v.size),
      purpose: v.purpose,
      status: "UPLOADING",
      uploadedById: actor.userId,
    },
  });
  await mkdir(path.dirname(incomingPath(id)), { recursive: true });
  return { id: file.id, chunkBytes: CHUNK_BYTES, received: 0, size: v.size };
}

// ───────────────────────────── Pieces ─────────────────────────────

export async function uploadStatus(db: DbTx, actor: Actor, fileId: string) {
  const file = await loadOwnUpload(db, actor, fileId);
  const received = file.status === "UPLOADING" ? await receivedBytes(file.id) : Number(file.sizeBytes);
  return { id: file.id, status: file.status, received, size: Number(file.sizeBytes), error: file.processingError };
}

/** Thrown when a piece arrives for the wrong offset; the client resumes from `received`. */
export class OffsetMismatchError extends ConflictError {
  constructor(readonly received: number) {
    super("That piece was out of order.");
  }
}

export async function appendChunk(db: DbTx, actor: Actor, fileId: string, offset: number, data: Uint8Array) {
  const file = await loadOwnUpload(db, actor, fileId);
  if (file.status !== "UPLOADING") throw new ConflictError("This upload is already finished.");
  if (!Number.isSafeInteger(offset) || offset < 0) throw new ValidationError("Bad upload offset.");
  if (data.byteLength === 0) throw new ValidationError("That piece was empty.");
  if (data.byteLength > CHUNK_BYTES) throw new ValidationError("That piece is too big.");
  const size = Number(file.sizeBytes);

  return withLock(file.id, async () => {
    const received = await receivedBytes(file.id);
    if (offset !== received) throw new OffsetMismatchError(received);
    if (received + data.byteLength > size) throw new ValidationError("More data arrived than the file's size.");
    if (offset === 0) {
      // Refuse the wrong kind of file before the rest of it is sent.
      try {
        checkKind(file.purpose, sniffType(data.subarray(0, 64)), size);
      } catch (err) {
        await db.file.update({ where: { id: file.id }, data: { status: "FAILED", processingError: (err as Error).message } });
        throw err;
      }
    }
    await appendFile(incomingPath(file.id), data);
    return { received: received + data.byteLength, size };
  });
}

// ───────────────────────────── Finish ─────────────────────────────

async function sha256Of(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** Checks the whole file arrived and what it really is, then stores it. Proof goes on to processing. */
export async function completeUpload(db: DbTx, actor: Actor, fileId: string) {
  const file = await loadOwnUpload(db, actor, fileId);
  if (file.status !== "UPLOADING") {
    return { id: file.id, status: file.status, mime: file.mimeType, needsProcessing: false };
  }
  return withLock(file.id, async () => {
    const temp = incomingPath(file.id);
    const size = Number(file.sizeBytes);
    const received = await receivedBytes(file.id);
    if (received !== size) throw new OffsetMismatchError(received);
    const sniffed = sniffType(await readHead(temp));
    try {
      checkKind(file.purpose, sniffed, size);
    } catch (err) {
      await rm(temp, { force: true });
      await db.file.update({ where: { id: file.id }, data: { status: "FAILED", processingError: (err as Error).message } });
      throw err;
    }
    const sha256 = await sha256Of(temp);
    await storage().putFromPath(file.storageKey, temp, sniffed!.mime);
    const needsProcessing = file.purpose === "PROOF";
    const updated = await db.file.update({
      where: { id: file.id },
      data: {
        mimeType: sniffed!.mime,
        filename: cleanFilename(file.filename, sniffed!),
        sha256,
        status: needsProcessing ? "PROCESSING" : "READY",
        processedAt: needsProcessing ? null : new Date(),
      },
    });
    return { id: updated.id, status: updated.status, mime: updated.mimeType, needsProcessing };
  });
}

// ───────────────────────────── Throwing away ─────────────────────────────

/** True when nothing in the system points at this file yet. */
async function isUnused(db: DbTx, fileId: string): Promise<boolean> {
  const f = await db.file.findUnique({
    where: { id: fileId },
    select: {
      _count: { select: { documents: true, proofs: true, taskAttachments: true, quotations: true, vendorInvoices: true, messageAttachments: true, expenseReceipts: true } },
    },
  });
  return !!f && Object.values(f._count).every((n) => n === 0);
}

async function removeFile(db: DbTx, file: { id: string; storageKey: string; thumbnailKey: string | null; playableKey: string | null }) {
  await rm(incomingPath(file.id), { force: true });
  for (const key of [file.storageKey, file.thumbnailKey, file.playableKey]) if (key) await storage().remove(key);
  await db.file.delete({ where: { id: file.id } });
}

/** The uploader throws away an upload they have not attached to anything. */
export async function discardUpload(db: DbTx, actor: Actor, fileId: string) {
  const file = await loadOwnUpload(db, actor, fileId);
  if (!(await isUnused(db, file.id))) throw new ConflictError("This file is already in use and can't be removed here.");
  await withLock(file.id, () => removeFile(db, file));
}

/**
 * Housekeeping: unfinished uploads older than a day, and finished ones nobody attached within two
 * days, are deleted. Files that are in use are never touched.
 */
export async function cleanupAbandonedUploads(db: DbTx, now = new Date()) {
  const dayAgo = new Date(now.getTime() - 24 * 3600_000);
  const twoDaysAgo = new Date(now.getTime() - 48 * 3600_000);
  const candidates = await db.file.findMany({
    where: {
      OR: [
        { status: { in: ["UPLOADING", "FAILED"] }, createdAt: { lt: dayAgo } },
        { status: { in: ["READY", "PROCESSING"] }, createdAt: { lt: twoDaysAgo } },
      ],
      documents: { none: {} },
      proofs: { none: {} },
      taskAttachments: { none: {} },
      quotations: { none: {} },
      vendorInvoices: { none: {} },
      messageAttachments: { none: {} },
      expenseReceipts: { none: {} },
    },
    select: { id: true, storageKey: true, thumbnailKey: true, playableKey: true },
    take: 200,
  });
  for (const f of candidates) {
    // Seeded demo files have no stored bytes; removing a missing object is harmless.
    await withLock(f.id, () => removeFile(db, f)).catch((err) => console.error("cleanup failed", f.id, err));
  }
  return candidates.length;
}
