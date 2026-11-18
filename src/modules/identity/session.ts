/**
 * Reading the signed-in person inside Next.js pages, layouts and server actions.
 * Every page calls requireActor(); the proxy only redirects obviously signed-out visitors.
 */
import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { RequestMeta } from "@/modules/audit/audit";
import { loadActor, type Actor } from "./actor";
import type { PermissionKey } from "./permissions";
import { can } from "./policy";

/** The signed-in person for this request, or null. Cached for the duration of one request. */
export const getActor = cache(async (): Promise<Actor | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const actor = await loadActor(db, session.user.id);
  if (!actor || actor.status !== "ACTIVE") return null;
  return actor;
});

export async function requireActor(opts: { allowPasswordChange?: boolean } = {}): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword && !opts.allowPasswordChange) redirect("/set-password");
  return actor;
}

/** Signed in and holding the permission; otherwise sent to their own home. */
export async function requirePermission(permission: PermissionKey): Promise<Actor> {
  const actor = await requireActor();
  if (!can(actor, permission)) redirect(`${homePathFor(actor)}?denied=1`);
  return actor;
}

export function homePathFor(actor: Pick<Actor, "accountType">): string {
  if (actor.accountType === "VENDOR") return "/vendor";
  if (actor.accountType === "LABOUR") return "/crew";
  return "/home";
}

export async function requestMeta(): Promise<RequestMeta> {
  const h = await headers();
  return { ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip"), userAgent: h.get("user-agent") };
}
