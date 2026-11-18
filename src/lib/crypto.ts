/**
 * Encryption for bank and ID details at rest (G13). AES-256-GCM with the key in FIELD_ENCRYPTION_KEY
 * (32 random bytes, base64). Stored as "v1:<iv>:<tag>:<ciphertext>" in base64url, so a later key
 * rotation can add "v2". The plain value never goes into the database or the audit log.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  if (!raw) throw new Error("FIELD_ENCRYPTION_KEY is not set (openssl rand -base64 32).");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("FIELD_ENCRYPTION_KEY must be 32 bytes, base64-encoded.");
  return k;
}

export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), data.toString("base64url")].join(":");
}

export function decryptField(stored: string): string {
  const [version, iv, tag, data] = stored.split(":");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unknown encrypted value.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/** "••••4821" style: the last four characters only. */
export function lastFour(value: string): string {
  return value.replace(/\s+/g, "").slice(-4);
}
