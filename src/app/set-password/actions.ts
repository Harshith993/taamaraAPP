"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { ActionResult } from "@/lib/errors";
import { recordAudit } from "@/modules/audit/audit";
import { homePathFor, requestMeta, requireActor } from "@/modules/identity/session";

const schema = z
  .object({
    current: z.string().min(1, "Enter the password you signed in with."),
    next: z.string().min(8, "Use at least 8 characters.").max(128),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, { path: ["confirm"], message: "The two new passwords don't match." })
  .refine((v) => v.next !== v.current, { path: ["next"], message: "Pick a password different from the old one." });

export async function setPasswordAction(_prev: ActionResult<{ home: string }> | null, form: FormData): Promise<ActionResult<{ home: string }>> {
  const actor = await requireActor({ allowPasswordChange: true });
  const parsed = schema.safeParse({ current: form.get("current"), next: form.get("next"), confirm: form.get("confirm") });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { ok: false, error: Object.values(fieldErrors)[0], fieldErrors };
  }
  try {
    await auth.api.changePassword({
      body: { currentPassword: parsed.data.current, newPassword: parsed.data.next, revokeOtherSessions: true },
      headers: await headers(),
    });
  } catch {
    return { ok: false, error: "Your current password is not right.", fieldErrors: { current: "This is not your current password." } };
  }
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: actor.userId }, data: { mustChangePassword: false } });
    await recordAudit(tx, actor, { action: "password_change", entityType: "user", entityId: actor.userId, summary: `${actor.name} set a new password` }, await requestMeta());
  });
  return { ok: true, data: { home: homePathFor(actor) } };
}
