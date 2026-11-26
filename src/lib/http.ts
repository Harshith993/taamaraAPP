/** Small helpers for the JSON API under /api/v1: who is asking, and errors as JSON. */
import "server-only";
import { AppError, ForbiddenError, UnauthorizedError, ValidationError } from "@/lib/errors";
import { RateLimitError } from "@/lib/rate-limit";
import type { Actor } from "@/modules/identity/actor";
import { getActor } from "@/modules/identity/session";

/** The signed-in person, or a 401. People who still have to set their password get nothing else. */
export async function apiActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new UnauthorizedError();
  if (actor.mustChangePassword) throw new ForbiddenError("Please set your password first.");
  return actor;
}

/** Writes from another site are refused (cookies are SameSite=Lax too; this is a second lock). */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ForbiddenError("Bad origin.");
  }
  if (!host || originHost !== host) throw new ForbiddenError("Requests from other sites are not allowed.");
}

export function apiError(err: unknown, extra: Record<string, unknown> = {}): Response {
  if (err instanceof RateLimitError) return Response.json({ error: err.message, ...extra }, { status: 429, headers: { "Retry-After": String(err.retryAfterSeconds) } });
  if (err instanceof ValidationError) return Response.json({ error: err.message, fieldErrors: err.fieldErrors, ...extra }, { status: 400 });
  if (err instanceof AppError) return Response.json({ error: err.message, ...extra }, { status: err.status });
  console.error(err);
  return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}

export const NO_STORE = { "Cache-Control": "no-store" } as const;
