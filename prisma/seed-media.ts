/**
 * Demo photos and videos for the seed, drawn on the fly (no real photos in the repository):
 * marigold garlands, a fairy-light canopy, and a short "walkthrough" video panning across it.
 * Stored the same way real uploads are, so the proof screens show real thumbnails and playback.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { storage } from "../src/lib/storage";

const run = promisify(execFile);

export type DemoArt = "garlands" | "canopy" | "drapes";

function svgFor(art: DemoArt, w: number, h: number): string {
  const parts: string[] = [];
  if (art === "garlands") {
    parts.push(`<rect width="${w}" height="${h}" fill="#F6F0E3"/>`, `<rect y="${h * 0.82}" width="${w}" height="${h * 0.18}" fill="#E6DCCB"/>`);
    for (let x = 60; x < w; x += 90) {
      const len = h * (0.45 + 0.3 * Math.abs(Math.sin(x)));
      for (let y = 0; y < len; y += 26) parts.push(`<circle cx="${x + Math.sin(y / 40) * 6}" cy="${y}" r="13" fill="${(y / 26) % 3 === 0 ? "#E8963A" : "#F0B13C"}"/>`);
      parts.push(`<circle cx="${x}" cy="${len + 14}" r="9" fill="#DD619A"/>`);
    }
  } else if (art === "canopy") {
    parts.push(`<rect width="${w}" height="${h}" fill="#2B1020"/>`);
    for (let row = 0; row < 7; row++) {
      const sag = 40 + row * 18;
      for (let x = 0; x <= w; x += 22) {
        const y = 60 + row * (h / 9) + sag * Math.sin((Math.PI * (x % (w / 2))) / (w / 2));
        parts.push(`<circle cx="${x}" cy="${y}" r="${4 + ((x + row) % 3)}" fill="#F3C644" opacity="${0.55 + ((x / 22 + row) % 4) * 0.12}"/>`);
      }
    }
    parts.push(`<rect y="${h * 0.86}" width="${w}" height="${h * 0.14}" fill="#4A0F28"/>`);
  } else {
    const colours = ["#DD619A", "#E2A1BB", "#F6F0E3", "#E2A1BB"];
    for (let i = 0; i * 120 < w; i++) parts.push(`<rect x="${i * 120}" width="120" height="${h}" fill="${colours[i % colours.length]}"/>`);
    parts.push(`<rect y="${h * 0.8}" width="${w}" height="${h * 0.2}" fill="#861A41"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join("")}</svg>`;
}

export interface DemoMedia {
  storageKey: string;
  thumbnailKey: string | null;
  playableKey: string | null;
  mimeType: string;
  sizeBytes: bigint;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

/** Makes one demo photo or video in storage. Falls back to an empty record if the tools are missing. */
export async function demoMedia(art: DemoArt, kind: "photo" | "video"): Promise<DemoMedia> {
  const id = randomUUID();
  const prefix = `proof/demo/${id}`;
  const dir = await mkdtemp(path.join(os.tmpdir(), "taamara-seed-"));
  try {
    const w = 1600;
    const h = 1200;
    const jpg = await sharp(Buffer.from(svgFor(art, w, h))).jpeg({ quality: 80 }).toBuffer();
    const thumb = await sharp(jpg).resize({ width: 480 }).jpeg({ quality: 72 }).toBuffer();
    await storage().putBuffer(`${prefix}/thumb.jpg`, thumb, "image/jpeg");
    if (kind === "photo") {
      await storage().putBuffer(`${prefix}/original`, jpg, "image/jpeg");
      await storage().putBuffer(`${prefix}/view.jpg`, jpg, "image/jpeg");
      return { storageKey: `${prefix}/original`, thumbnailKey: `${prefix}/thumb.jpg`, playableKey: `${prefix}/view.jpg`, mimeType: "image/jpeg", sizeBytes: BigInt(jpg.length), width: w, height: h, durationSeconds: null };
    }
    const still = path.join(dir, "still.jpg");
    const video = path.join(dir, "play.mp4");
    await writeFile(still, jpg);
    await run("ffmpeg", ["-y", "-v", "error", "-loop", "1", "-i", still, "-vf", "zoompan=z='min(zoom+0.0012,1.25)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=120:s=1280x720:fps=20", "-t", "6", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", video], { timeout: 120_000 });
    const bytes = await readFile(video);
    // The demo original is already a playable MP4, so the viewing copy is the same bytes.
    await storage().putBuffer(`${prefix}/original`, bytes, "video/mp4");
    await storage().putBuffer(`${prefix}/play.mp4`, bytes, "video/mp4");
    return { storageKey: `${prefix}/original`, thumbnailKey: `${prefix}/thumb.jpg`, playableKey: `${prefix}/play.mp4`, mimeType: "video/mp4", sizeBytes: BigInt(bytes.length), width: 1280, height: 720, durationSeconds: 6 };
  } catch (err) {
    console.warn(`Demo ${kind} could not be drawn (${(err as Error).message}); it will show without a preview.`);
    return { storageKey: `${prefix}/missing`, thumbnailKey: null, playableKey: null, mimeType: kind === "photo" ? "image/jpeg" : "video/mp4", sizeBytes: BigInt(1), width: null, height: null, durationSeconds: null };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
