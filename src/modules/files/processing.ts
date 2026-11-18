/**
 * Turns an uploaded photo or video into what people actually look at:
 *
 *   photo → a thumbnail (480 px) and a viewing copy (1600 px JPEG), turned the right way up,
 *           with all metadata (including the phone's location) removed
 *   video → length checked against the owners' limit (2 minutes by default), a thumbnail, and an
 *           H.264 MP4 (long side 1280 px) that plays on any phone or browser, without metadata
 *
 * The original is kept untouched. Work runs on this server after the upload finishes (one video at
 * a time, so a busy event day cannot starve the app); anything left half-done when the server
 * restarts is picked up again by resumeProcessing().
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import type { DbTx } from "@/lib/db";
import { storage } from "@/lib/storage";
import { readSwitches } from "@/modules/identity/actor";
import { notify } from "@/modules/notifications/notify";

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

/** A reason shown to the uploader. */
class ProcessingRefused extends Error {}

export function describeLength(seconds: number): string {
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  return m ? `${m} min${s % 60 ? ` ${s % 60} s` : ""}` : `${s} s`;
}

async function processPhoto(input: string, dir: string) {
  let meta;
  try {
    meta = await sharp(input).metadata();
  } catch {
    throw new ProcessingRefused(
      "This photo could not be opened. Please take it again, or send it as a JPEG (on iPhone: Settings → Camera → Formats → Most Compatible).",
    );
  }
  if (!meta.width || !meta.height) throw new ProcessingRefused("This photo could not be opened. Please take it again.");
  const base = sharp(input, { failOn: "error" }).rotate();
  const view = path.join(dir, "view.jpg");
  const thumb = path.join(dir, "thumb.jpg");
  const info = await base.clone().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toFile(view);
  await base.clone().resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 72, mozjpeg: true }).toFile(thumb);
  return { view, thumb, width: info.width, height: info.height, duration: null as number | null };
}

interface Probe {
  duration: number;
  width: number;
  height: number;
}

export async function probeVideo(input: string): Promise<Probe | null> {
  try {
    const { stdout } = await run(FFPROBE, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", input], { timeout: 60_000 });
    const data = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_type?: string; width?: number; height?: number; duration?: string }[] };
    const video = data.streams?.find((s) => s.codec_type === "video");
    if (!video) return null;
    const duration = Number(data.format?.duration ?? video.duration ?? NaN);
    return { duration: Number.isFinite(duration) ? duration : 0, width: video.width ?? 0, height: video.height ?? 0 };
  } catch {
    return null;
  }
}

async function processVideo(input: string, dir: string, maxSeconds: number) {
  const probe = await probeVideo(input);
  if (!probe) throw new ProcessingRefused("This file has no video we can play. Please record it again.");
  if (probe.duration > maxSeconds + 1) {
    throw new ProcessingRefused(`This video is ${describeLength(probe.duration)} long. Videos can be up to ${describeLength(maxSeconds)}; please trim it or record a shorter one.`);
  }
  const thumb = path.join(dir, "thumb.jpg");
  const view = path.join(dir, "play.mp4");
  const at = Math.min(1, probe.duration / 2).toFixed(2);
  await run(FFMPEG, ["-y", "-v", "error", "-ss", at, "-i", input, "-frames:v", "1", "-vf", "scale='if(gt(iw,ih),min(640,iw),-2)':'if(gt(iw,ih),-2,min(640,ih))'", "-q:v", "4", thumb], {
    timeout: 120_000,
  });
  await run(
    FFMPEG,
    [
      "-y", "-v", "error", "-i", input,
      "-map", "0:v:0", "-map", "0:a:0?",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "27", "-pix_fmt", "yuv420p", "-profile:v", "high",
      "-vf", "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))'",
      "-c:a", "aac", "-b:a", "96k", "-ac", "2",
      // No location or other metadata in the copy people watch.
      "-map_metadata", "-1", "-map_chapters", "-1",
      "-movflags", "+faststart", "-threads", "2",
      view,
    ],
    { timeout: 15 * 60_000 },
  );
  const out = await probeVideo(view);
  return { view, thumb, width: out?.width ?? probe.width, height: out?.height ?? probe.height, duration: Math.round(probe.duration) };
}

async function tellUploader(db: DbTx, fileId: string, reason: string) {
  const proof = await db.workProof.findFirst({ where: { fileId }, select: { uploadedById: true, kind: true, eventId: true } });
  if (!proof) return;
  await notify(db, [proof.uploadedById], {
    type: "proof.failed",
    title: proof.kind === "VIDEO" ? "Your video couldn't be used" : "Your photo couldn't be used",
    body: reason,
    entityType: "file",
    entityId: fileId,
  });
}

/** Processes one file if it is waiting. Safe to call twice. */
export async function processFile(db: DbTx, fileId: string): Promise<void> {
  const file = await db.file.findUnique({ where: { id: fileId } });
  if (!file || file.status !== "PROCESSING") return;
  const dir = await mkdtemp(path.join(os.tmpdir(), "taamara-media-"));
  try {
    const input = path.join(dir, `original.${file.mimeType.split("/")[1]?.replace(/[^a-z0-9]/g, "") || "bin"}`);
    await storage().copyToPath(file.storageKey, input);
    let result;
    if (file.mimeType.startsWith("image/")) {
      result = await processPhoto(input, dir);
    } else if (file.mimeType.startsWith("video/")) {
      const company = await db.companyProfile.findUnique({ where: { id: 1 }, select: { settings: true } });
      result = await processVideo(input, dir, readSwitches(company?.settings).maxVideoSeconds);
    } else {
      await db.file.update({ where: { id: file.id }, data: { status: "READY", processedAt: new Date() } });
      return;
    }
    const prefix = file.storageKey.replace(/\/original$/, "");
    const thumbKey = `${prefix}/thumb.jpg`;
    const viewKey = `${prefix}/${path.basename(result.view)}`;
    await storage().putFromPath(thumbKey, result.thumb, "image/jpeg");
    await storage().putFromPath(viewKey, result.view, file.mimeType.startsWith("video/") ? "video/mp4" : "image/jpeg");
    await db.file.update({
      where: { id: file.id },
      data: {
        status: "READY",
        thumbnailKey: thumbKey,
        playableKey: viewKey,
        width: result.width,
        height: result.height,
        durationSeconds: result.duration,
        processedAt: new Date(),
        processingError: null,
      },
    });
  } catch (err) {
    const reason = err instanceof ProcessingRefused ? err.message : "We couldn't process this file. Please try uploading it again.";
    if (!(err instanceof ProcessingRefused)) console.error("Media processing failed", file.id, err);
    await db.file.update({ where: { id: file.id }, data: { status: "FAILED", processingError: reason, processedAt: new Date() } });
    await tellUploader(db, file.id, reason);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ───────────────────────────── Queue ─────────────────────────────

let videoChain: Promise<unknown> = Promise.resolve();
let photoChain: Promise<unknown> = Promise.resolve();
const queued = new Set<string>();

/** Queues a file for processing and resolves when it is done. Videos go one at a time. */
export function enqueueProcessing(db: DbTx, fileId: string, mimeType: string): Promise<void> {
  if (queued.has(fileId)) return Promise.resolve();
  queued.add(fileId);
  const job = () => processFile(db, fileId).finally(() => queued.delete(fileId));
  if (mimeType.startsWith("video/")) {
    const next = videoChain.catch(() => undefined).then(job);
    videoChain = next;
    return next;
  }
  const next = photoChain.catch(() => undefined).then(job);
  photoChain = next;
  return next;
}

/** After a restart: process whatever was left waiting. */
export async function resumeProcessing(db: DbTx): Promise<number> {
  const waiting = await db.file.findMany({ where: { status: "PROCESSING" }, select: { id: true, mimeType: true }, orderBy: { createdAt: "asc" }, take: 500 });
  for (const f of waiting) void enqueueProcessing(db, f.id, f.mimeType);
  return waiting.length;
}
