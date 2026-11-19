/**
 * Owners can change what Event Managers, the Accountant and Supervisors may do.
 * The Owner, Vendor and Crew roles are fixed (crew and vendor switches live in company settings).
 */
import type { Db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit, type RequestMeta } from "@/modules/audit/audit";
import type { Actor } from "./actor";
import { PERMISSION_LIST, ROLES, getPermission, validateGrant, type RoleKey, type Scope } from "./permissions";
import { assertCan } from "./policy";

export async function listRoles(db: Db, actor: Actor) {
  assertCan(actor, "admin.users", "Only hosts can see roles.");
  const roles = await db.role.findMany({ include: { permissions: true, _count: { select: { users: true } } }, orderBy: { createdAt: "asc" } });
  return roles.map((r) => ({
    key: r.key as RoleKey,
    name: r.name,
    description: r.description,
    accountType: r.accountType,
    isOwner: r.isOwner,
    editable: ROLES[r.key as RoleKey]?.editable ?? false,
    userCount: r._count.users,
    grants: r.isOwner
      ? Object.fromEntries(PERMISSION_LIST.filter((p) => p.accountTypes.includes("INTERNAL") && p.scopes.includes("ALL")).map((p) => [p.key, "ALL" as Scope]))
      : Object.fromEntries(r.permissions.map((p) => [p.permission, p.scope])),
  }));
}

/** Replaces a role's grants. `grants` maps permission keys to a scope; keys left out are removed. */
export async function updateRoleGrants(db: Db, actor: Actor, roleKey: RoleKey, grants: Record<string, Scope>, meta: RequestMeta = {}) {
  assertCan(actor, "admin.users", "Only hosts can change permissions.");
  if (!actor.isOwner) throw new ConflictError("Only hosts can change permissions.");
  const def = ROLES[roleKey];
  if (!def) throw new NotFoundError("That role");
  if (!def.editable) throw new ConflictError(`The ${def.name} role is fixed and cannot be changed here.`);

  const errors: Record<string, string> = {};
  for (const [key, scope] of Object.entries(grants)) {
    const problem = validateGrant(key, scope, def.accountType);
    if (problem) errors[key] = problem;
    if (key === "admin.users" || key === "approvals.decide" || key === "quotes.approve") errors[key] = "Only hosts can hold this permission.";
  }
  if (Object.keys(errors).length) throw new ValidationError(Object.values(errors)[0], errors);

  const role = await db.role.findUnique({ where: { key: roleKey }, include: { permissions: true } });
  if (!role) throw new NotFoundError("That role");
  const before = Object.fromEntries(role.permissions.map((p) => [p.permission, p.scope]));

  const added = Object.keys(grants).filter((k) => !(k in before));
  const removed = Object.keys(before).filter((k) => !(k in grants));
  const changed = Object.keys(grants).filter((k) => k in before && before[k] !== grants[k]);
  const label = (k: string) => getPermission(k)?.label ?? k;
  const parts = [
    added.length && `allowed ${added.map(label).join("; ")}`,
    removed.length && `removed ${removed.map(label).join("; ")}`,
    changed.length && `changed scope of ${changed.map(label).join("; ")}`,
  ].filter(Boolean);

  await db.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
    await tx.rolePermission.createMany({ data: Object.entries(grants).map(([permission, scope]) => ({ roleId: role.id, permission, scope })) });
    await recordAudit(tx, actor, {
      action: "permission_change",
      entityType: "role",
      entityId: role.id,
      summary: parts.length ? `${def.name}: ${parts.join(" | ")}` : `${def.name}: no changes`,
      before,
      after: grants,
    }, meta);
  });
}
