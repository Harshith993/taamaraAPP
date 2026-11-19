/**
 * Team management: owners create every account (nobody can sign themselves up).
 * New accounts get a temporary password and must set their own on first login.
 */
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import type { Db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { normalizePhone, placeholderEmailForPhone } from "@/lib/phone";
import { recordAudit, type RequestMeta } from "@/modules/audit/audit";
import type { Actor } from "./actor";
import { ROLES, ROLE_KEYS, type RoleKey } from "./permissions";
import { assertCan } from "./policy";

const password = z.string().min(8, "Use at least 8 characters.").max(128, "Use at most 128 characters.");

export type HostTitle = "Host" | "Co-host";

export const createUserSchema = z
  .object({
    name: z.string().trim().min(2, "Enter the person's name.").max(80),
    phone: z.string().trim().min(1, "Enter a phone number."),
    email: z.union([z.literal(""), z.string().trim().email("Enter a valid email or leave it empty.")]).optional(),
    roleKey: z.enum(ROLE_KEYS),
    temporaryPassword: password,
    vendorId: z.string().uuid().optional(),
    workerId: z.string().uuid().optional(),
    hostTitle: z.enum(["Host", "Co-host"]).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.roleKey === "VENDOR" && !v.vendorId) ctx.addIssue({ code: "custom", path: ["vendorId"], message: "Pick the vendor this login is for." });
  });
export type CreateUserInput = z.input<typeof createUserSchema>;

function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of r.error.issues) fieldErrors[issue.path.join(".") || "_"] ??= issue.message;
    throw new ValidationError(Object.values(fieldErrors)[0] ?? "Please check the form.", fieldErrors);
  }
  return r.data;
}

async function activeOwnerCount(db: Pick<Db, "user">) {
  return db.user.count({ where: { status: "ACTIVE", accountType: "INTERNAL", roles: { some: { role: { isOwner: true } } } } });
}

export async function createUser(db: Db, actor: Actor, input: CreateUserInput, meta: RequestMeta = {}) {
  assertCan(actor, "admin.users", "Only hosts can add people.");
  const v = parse(createUserSchema, input);
  const phone = normalizePhone(v.phone);
  if (!phone) throw new ValidationError("That phone number doesn't look right.", { phone: "Use a 10-digit mobile number or +country code." });
  const role = ROLES[v.roleKey];
  const email = v.email ? v.email.toLowerCase() : placeholderEmailForPhone(phone);

  const clash = await db.user.findFirst({ where: { OR: [{ phoneNumber: phone }, { email }] }, select: { phoneNumber: true } });
  if (clash) throw new ConflictError(clash.phoneNumber === phone ? "Someone already uses this phone number." : "Someone already uses this email.");

  if (v.vendorId && !(await db.vendor.findUnique({ where: { id: v.vendorId }, select: { id: true } }))) throw new NotFoundError("That vendor");
  if (v.workerId) {
    const worker = await db.worker.findUnique({ where: { id: v.workerId }, select: { userId: true } });
    if (!worker) throw new NotFoundError("That crew member");
    if (worker.userId) throw new ConflictError("That crew member already has a login.");
  }

  const passwordHash = await hashPassword(v.temporaryPassword);
  return db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: v.name,
        email,
        hasRealEmail: Boolean(v.email),
        phoneNumber: phone,
        accountType: role.accountType,
        mustChangePassword: true,
        createdById: actor.userId,
        roles: { create: { role: { connect: { key: role.key } } } },
        title: role.key === "OWNER" && v.hostTitle === "Co-host" ? "Co-host" : null,
      },
    });
    await tx.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: passwordHash } });
    if (role.key === "VENDOR" && v.vendorId) await tx.vendorUser.create({ data: { vendorId: v.vendorId, userId: user.id } });
    if (role.key === "LABOUR") {
      if (v.workerId) await tx.worker.update({ where: { id: v.workerId }, data: { userId: user.id } });
      else await tx.worker.create({ data: { name: v.name, phone, userId: user.id, createdById: actor.userId } });
    }
    await recordAudit(tx, actor, { action: "create", entityType: "user", entityId: user.id, summary: `Added ${v.name} as ${role.name}`, after: { name: v.name, phone, role: role.key } }, meta);
    return user;
  });
}

/** hostTitle: for the host role, whether this person is the Host or the Co-host (both have full access). */
export async function setUserRoles(db: Db, actor: Actor, userId: string, roleKeys: RoleKey[], meta: RequestMeta = {}, hostTitle?: HostTitle) {
  assertCan(actor, "admin.users", "Only hosts can change roles.");
  if (!roleKeys.length) throw new ValidationError("Pick at least one role.");
  const user = await db.user.findUnique({ where: { id: userId }, include: { roles: { include: { role: true } } } });
  if (!user) throw new NotFoundError("That person");
  for (const key of roleKeys) {
    if (ROLES[key].accountType !== user.accountType) throw new ValidationError(`${ROLES[key].name} cannot be given to this kind of account.`);
  }
  const wasOwner = user.roles.some((r) => r.role.isOwner);
  const willBeOwner = roleKeys.includes("OWNER");

  return db.$transaction(async (tx) => {
    const roles = await tx.role.findMany({ where: { key: { in: roleKeys } } });
    await tx.userRole.deleteMany({ where: { userId } });
    await tx.userRole.createMany({ data: roles.map((r) => ({ userId, roleId: r.id })) });
    const title = willBeOwner ? (hostTitle ?? (wasOwner && user.title === "Co-host" ? "Co-host" : "Host")) : null;
    await tx.user.update({ where: { id: userId }, data: { title: title === "Co-host" ? "Co-host" : null } });
    if (wasOwner && !willBeOwner && (await activeOwnerCount(tx)) === 0) {
      throw new ConflictError("There must always be at least one active host.");
    }
    await recordAudit(tx, actor, {
      action: "permission_change",
      entityType: "user",
      entityId: userId,
      summary: `Changed ${user.name}'s role to ${title ?? roleKeys.map((k) => ROLES[k].name).join(", ")}`,
      before: { roles: user.roles.map((r) => r.role.key) },
      after: { roles: roleKeys },
    }, meta);
  });
}

export async function setUserStatus(db: Db, actor: Actor, userId: string, status: "ACTIVE" | "DISABLED", meta: RequestMeta = {}) {
  assertCan(actor, "admin.users", "Only hosts can switch accounts on or off.");
  if (userId === actor.userId && status === "DISABLED") throw new ConflictError("You can't switch off your own account.");
  const user = await db.user.findUnique({ where: { id: userId }, select: { name: true, status: true } });
  if (!user) throw new NotFoundError("That person");

  return db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { status } });
    if (status === "DISABLED") {
      if ((await activeOwnerCount(tx)) === 0) throw new ConflictError("There must always be at least one active host.");
      await tx.session.deleteMany({ where: { userId } }); // signed out everywhere, immediately
    }
    await recordAudit(tx, actor, {
      action: status === "DISABLED" ? "disable" : "enable",
      entityType: "user",
      entityId: userId,
      summary: `${status === "DISABLED" ? "Switched off" : "Switched on"} ${user.name}'s account`,
    }, meta);
  });
}

export async function resetPassword(db: Db, actor: Actor, userId: string, temporaryPassword: string, meta: RequestMeta = {}) {
  assertCan(actor, "admin.users", "Only hosts can reset passwords.");
  const pw = parse(password, temporaryPassword);
  const user = await db.user.findUnique({ where: { id: userId }, select: { name: true } });
  if (!user) throw new NotFoundError("That person");
  const hash = await hashPassword(pw);

  return db.$transaction(async (tx) => {
    const updated = await tx.account.updateMany({ where: { userId, providerId: "credential" }, data: { password: hash } });
    if (updated.count === 0) await tx.account.create({ data: { userId, accountId: userId, providerId: "credential", password: hash } });
    await tx.user.update({ where: { id: userId }, data: { mustChangePassword: true } });
    await tx.session.deleteMany({ where: { userId } });
    await recordAudit(tx, actor, { action: "password_reset", entityType: "user", entityId: userId, summary: `Reset ${user.name}'s password` }, meta);
  });
}

export async function listTeam(db: Db, actor: Actor) {
  assertCan(actor, "admin.users", "Only hosts can see the team list.");
  return db.user.findMany({
    orderBy: [{ status: "asc" }, { accountType: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, email: true, hasRealEmail: true, phoneNumber: true, accountType: true, status: true,
      mustChangePassword: true, lastLoginAt: true, createdAt: true, title: true,
      roles: { select: { role: { select: { key: true, name: true } } } },
      vendorLinks: { select: { vendor: { select: { id: true, companyName: true } } } },
      worker: { select: { id: true } },
    },
  });
}
