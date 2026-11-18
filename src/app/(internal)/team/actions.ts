"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { toActionError, type ActionResult } from "@/lib/errors";
import { ROLES, ROLE_KEYS, type RoleKey, type Scope } from "@/modules/identity/permissions";
import { updateRoleGrants } from "@/modules/identity/roles";
import { requestMeta, requirePermission } from "@/modules/identity/session";
import { createUser, resetPassword, setUserRoles, setUserStatus } from "@/modules/identity/users";

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");

export async function addPersonAction(_prev: ActionResult<{ name: string; login: string; password: string }> | null, form: FormData) {
  const actor = await requirePermission("admin.users");
  const input = {
    name: str(form.get("name")),
    phone: str(form.get("phone")),
    email: str(form.get("email")),
    roleKey: str(form.get("roleKey")) as RoleKey,
    temporaryPassword: str(form.get("temporaryPassword")),
    vendorId: str(form.get("vendorId")) || undefined,
    workerId: str(form.get("workerId")) || undefined,
  };
  try {
    const user = await createUser(db, actor, input, await requestMeta());
    revalidatePath("/team");
    return { ok: true as const, data: { name: user.name, login: user.phoneNumber ?? user.email, password: input.temporaryPassword } };
  } catch (err) {
    return toActionError(err);
  }
}

export async function resetPasswordAction(userId: string, temporaryPassword: string): Promise<ActionResult> {
  const actor = await requirePermission("admin.users");
  try {
    await resetPassword(db, actor, userId, temporaryPassword, await requestMeta());
    revalidatePath("/team");
    return { ok: true, message: "Password reset. They will choose a new one when they sign in." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function setStatusAction(userId: string, status: "ACTIVE" | "DISABLED"): Promise<ActionResult> {
  const actor = await requirePermission("admin.users");
  try {
    await setUserStatus(db, actor, userId, status, await requestMeta());
    revalidatePath("/team");
    return { ok: true, message: status === "DISABLED" ? "Switched off and signed out everywhere." : "Switched back on." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function setRoleAction(userId: string, roleKey: string): Promise<ActionResult> {
  const actor = await requirePermission("admin.users");
  if (!(ROLE_KEYS as readonly string[]).includes(roleKey)) return { ok: false, error: "Unknown role." };
  try {
    await setUserRoles(db, actor, userId, [roleKey as RoleKey], await requestMeta());
    revalidatePath("/team");
    return { ok: true, message: `Role changed to ${ROLES[roleKey as RoleKey].name}.` };
  } catch (err) {
    return toActionError(err);
  }
}

export async function updateRoleGrantsAction(roleKey: string, grants: Record<string, Scope>): Promise<ActionResult> {
  const actor = await requirePermission("admin.users");
  if (!(ROLE_KEYS as readonly string[]).includes(roleKey)) return { ok: false, error: "Unknown role." };
  try {
    await updateRoleGrants(db, actor, roleKey as RoleKey, grants, await requestMeta());
    revalidatePath("/team/roles");
    return { ok: true, message: `Saved. ${ROLES[roleKey as RoleKey].name} permissions apply from their next page load.` };
  } catch (err) {
    return toActionError(err);
  }
}
