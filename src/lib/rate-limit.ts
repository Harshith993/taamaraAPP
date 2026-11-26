/**
 * Per-person limits on how often the API and chat can be used (Phase 9). One app server (D5), so
 * the counts live in memory; they reset on restart, which is fine for flood protection. Sign-in has
 * its own, stricter limits in Better Auth (src/lib/auth.ts), stored in the database.
 *
 * The limits are generous for real use: a crew member uploading a 500 MB video sends 125 pieces;
 * a proof grid of 40 photos asks for 40 thumbnails.
 */
import { AppError } from "./errors";

export const LIMITS = {
  "upload.start": { max: 60, windowMs: 60_000 },
  "upload.piece": { max: 900, windowMs: 60_000 },
  "file.get": { max: 1200, windowMs: 60_000 },
  export: { max: 12, windowMs: 60_000 },
  "channel.open": { max: 60, windowMs: 60_000 },
  "channel.stream": { max: 30, windowMs: 60_000 },
  "message.post": { max: 40, windowMs: 60_000 },
  "announcement.send": { max: 10, windowMs: 60_000 },
} as const;
export type LimitKey = keyof typeof LIMITS;

export class RateLimitError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super(`That was a lot in a short time. Please wait ${retryAfterSeconds} seconds and try again.`, 429, "RATE_LIMITED");
  }
}

const g = globalThis as unknown as { taamaraHits?: Map<string, number[]> };
const hits = g.taamaraHits ?? new Map<string, number[]>();
g.taamaraHits = hits;

/** Counts one use; throws RateLimitError when the person is over the limit for this kind of request. */
export function checkRate(userId: string, key: LimitKey, now = Date.now()) {
  const { max, windowMs } = LIMITS[key];
  const id = `${key}:${userId}`;
  const since = now - windowMs;
  const list = (hits.get(id) ?? []).filter((t) => t > since);
  if (list.length >= max) {
    hits.set(id, list);
    throw new RateLimitError(Math.max(1, Math.ceil((list[0] + windowMs - now) / 1000)));
  }
  list.push(now);
  hits.set(id, list);
  // Keep the map small: forget people who have gone quiet.
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || v[v.length - 1] < since) hits.delete(k);
}

/** For tests. */
export function resetRates() {
  hits.clear();
}
