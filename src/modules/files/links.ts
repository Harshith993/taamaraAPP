/**
 * Links to stored files. A page that is allowed to show a file (after its own permission check)
 * asks for a link here. The link:
 *   - works only for the person it was made for (the file route checks the signed-in user)
 *   - expires 20–30 minutes after it was made (rounded, so the browser can cache repeat views)
 *   - is signed with a key derived from the server secret, so it cannot be forged or edited
 * Nothing in storage is ever public. With S3 (Phase 10) the same function returns a pre-signed URL.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const FILE_VARIANTS = ["original", "view", "thumb"] as const;
export type FileVariant = (typeof FILE_VARIANTS)[number];

const LIFETIME_MS = 20 * 60_000;
const BUCKET_MS = 10 * 60_000;

function key(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set.");
  return createHash("sha256").update(`taamara-file-links:${secret}`).digest();
}

function signature(userId: string, fileId: string, variant: FileVariant, expires: number): string {
  return createHmac("sha256", key()).update(`${userId}\n${fileId}\n${variant}\n${expires}`).digest("base64url");
}

export function fileLink(userId: string, fileId: string, variant: FileVariant, now = Date.now()): string {
  const expires = Math.ceil((now + LIFETIME_MS) / BUCKET_MS) * BUCKET_MS;
  return `/api/v1/files/${fileId}/${variant}?e=${expires}&s=${signature(userId, fileId, variant, expires)}`;
}

export type LinkCheck = "ok" | "expired" | "invalid";

export function checkFileLink(userId: string, fileId: string, variant: string, expires: string | null, sig: string | null, now = Date.now()): LinkCheck {
  if (!(FILE_VARIANTS as readonly string[]).includes(variant) || !expires || !sig || !/^\d{10,16}$/.test(expires)) return "invalid";
  const want = Buffer.from(signature(userId, fileId, variant as FileVariant, Number(expires)));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return "invalid";
  return Number(expires) < now ? "expired" : "ok";
}
