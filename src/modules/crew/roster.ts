/**
 * The crew roster: everyone the company hires per event.
 *
 *  - Staff with crew.view see the roster; the usual per-event rate only with crew.pay.view.
 *  - Registering needs crew.create (owners, managers, supervisors ⚙); editing needs crew.edit ALL.
 *  - Days a crew member can't work are refused when hiring (crew/service.ts).
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { todayAsDate, toNumber } from "@/lib/format";
import { normalizePhone } from "@/lib/phone";
import { parseInput } from "@/lib/validate";
import { recordAudit, type RequestMeta } from "@/modules/audit/audit";
import type { Actor } from "@/modules/identity/actor";
import { assertCan, can, eventWhere } from "@/modules/identity/policy";

function staffOnly(actor: Actor) {
  if (actor.accountType !== "INTERNAL") throw new ForbiddenError("The crew roster is for the team.");
}

export async function listWorkers(db: Db, actor: Actor, filter: { q?: string; skillId?: string; status?: string } = {}) {
  staffOnly(actor);
  assertCan(actor, "crew.view");
  const today = todayAsDate();
  const where: Prisma.WorkerWhereInput[] = [{ deletedAt: null }];
  const q = filter.q?.trim();
  if (q) where.push({ OR: [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q.replace(/\D/g, "") || q } }, { city: { contains: q, mode: "insensitive" } }] });
  if (filter.skillId) where.push({ skills: { some: { skillId: filter.skillId } } });
  if (filter.status !== "all") where.push({ status: (filter.status as "ACTIVE" | "INACTIVE") || "ACTIVE" });
  const rows = await db.worker.findMany({
    where: { AND: where },
    orderBy: { name: "asc" },
    take: 500,
    select: {
      id: true,
      name: true,
      phone: true,
      city: true,
      status: true,
      usualEventRate: true,
      userId: true,
      skills: { select: { skill: { select: { id: true, name: true } } } },
      assignments: { where: { status: { in: ["ASSIGNED", "CONFIRMED", "COMPLETED"] } }, orderBy: { createdAt: "desc" }, take: 30, select: { status: true, event: { select: { startDate: true } } } },
      unavailability: { where: { date: { gte: today } }, orderBy: { date: "asc" }, take: 3, select: { date: true } },
    },
  });
  const seesPay = can(actor, "crew.pay.view");
  return rows.map((w) => {
    const past = w.assignments.map((a) => a.event.startDate).filter((d): d is Date => Boolean(d) && d! < today).sort((a, b) => b.getTime() - a.getTime());
    return {
      id: w.id,
      name: w.name,
      phone: w.phone,
      city: w.city,
      status: w.status,
      skills: w.skills.map((s) => s.skill),
      usualRate: seesPay && w.usualEventRate ? toNumber(w.usualEventRate) : null,
      hasLogin: Boolean(w.userId),
      upcoming: w.assignments.filter((a) => a.event.startDate && a.event.startDate >= today && a.status !== "COMPLETED").length,
      lastWorked: past[0] ?? null,
      nextOff: w.unavailability[0]?.date ?? null,
    };
  });
}

export async function getWorker(db: Db, actor: Actor, workerId: string) {
  staffOnly(actor);
  assertCan(actor, "crew.view");
  const w = await db.worker.findFirst({
    where: { id: workerId, deletedAt: null },
    include: {
      skills: { select: { skill: { select: { id: true, name: true } } } },
      unavailability: { where: { date: { gte: todayAsDate() } }, orderBy: { date: "asc" } },
      user: { select: { status: true, lastLoginAt: true } },
    },
  });
  if (!w) throw new NotFoundError("That crew member");
  const seesPay = can(actor, "crew.pay.view");
  const assignments = await db.crewAssignment.findMany({
    where: { workerId, event: eventWhere(actor) },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, duty: true, status: true, agreedPay: true, declineReason: true, event: { select: { id: true, name: true, startDate: true } }, shifts: { select: { attendance: true } } },
  });
  return {
    id: w.id,
    name: w.name,
    phone: w.phone,
    city: w.city,
    experienceYears: w.experienceYears,
    status: w.status,
    notes: w.notes,
    emergencyContact: w.emergencyContact,
    skills: w.skills.map((s) => s.skill),
    usualRate: seesPay && w.usualEventRate ? toNumber(w.usualEventRate) : null,
    login: w.user ? { status: w.user.status, lastLoginAt: w.user.lastLoginAt } : null,
    unavailable: w.unavailability.map((u) => ({ id: u.id, date: u.date, reason: u.reason })),
    assignments: assignments.map((a) => ({
      id: a.id,
      duty: a.duty,
      status: a.status,
      pay: seesPay ? toNumber(a.agreedPay) : null,
      declineReason: a.declineReason,
      event: a.event,
      present: a.shifts.filter((s) => s.attendance === "PRESENT" || s.attendance === "LATE").length,
      absent: a.shifts.filter((s) => s.attendance === "ABSENT").length,
    })),
  };
}

export const workerSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Enter their name.").max(80),
  phone: z.string().trim().min(1, "Enter a phone number.").max(30),
  city: z.string().trim().max(60).optional(),
  experienceYears: z.union([z.literal(""), z.coerce.number().int().min(0).max(60)]).optional(),
  skillIds: z.array(z.string().uuid()).min(1, "Pick at least one skill."),
  usualEventRate: z.union([z.literal(""), z.coerce.number().min(0).max(1_000_000)]).optional(),
  emergencyContact: z.string().trim().max(120).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
  notes: z.string().trim().max(2000).optional(),
});
export type WorkerInput = z.input<typeof workerSchema>;

export async function saveWorker(db: Db, actor: Actor, input: WorkerInput, meta: RequestMeta = {}) {
  staffOnly(actor);
  const v = parseInput(workerSchema, input);
  if (v.id) {
    assertCan(actor, "crew.edit", "You can't edit crew details.");
    if (actor.grants.get("crew.edit") !== "ALL") throw new ForbiddenError("You can't edit crew details.");
  } else assertCan(actor, "crew.create", "You can't register crew.");
  const phone = normalizePhone(v.phone);
  if (!phone) throw new ValidationError("That phone number doesn't look right.", { phone: "Use a 10-digit mobile number." });
  const seesPay = can(actor, "crew.pay.view");
  return db.$transaction(async (tx) => {
    if ((await tx.skill.count({ where: { id: { in: v.skillIds } } })) !== new Set(v.skillIds).size) throw new ValidationError("Pick skills from the list.", { skillIds: "Pick skills from the list." });
    const same = await tx.worker.findFirst({ where: { phone, deletedAt: null, ...(v.id ? { id: { not: v.id } } : {}) }, select: { name: true } });
    if (same) throw new ConflictError(`${same.name} already has this phone number.`);
    const data = {
      name: v.name,
      phone,
      city: v.city || null,
      experienceYears: v.experienceYears === "" || v.experienceYears === undefined ? null : v.experienceYears,
      emergencyContact: v.emergencyContact || null,
      status: v.status,
      notes: v.notes || null,
      // Only people who see pay set the usual rate.
      ...(seesPay ? { usualEventRate: v.usualEventRate === "" || v.usualEventRate === undefined ? null : v.usualEventRate } : {}),
    };
    let id = v.id;
    if (id) {
      if (!(await tx.worker.count({ where: { id, deletedAt: null } }))) throw new NotFoundError("That crew member");
      await tx.worker.update({ where: { id }, data });
      await tx.workerSkill.deleteMany({ where: { workerId: id } });
      await recordAudit(tx, actor, { action: "update", entityType: "worker", entityId: id, summary: `Edited crew member ${v.name}` }, meta);
    } else {
      id = (await tx.worker.create({ data: { ...data, createdById: actor.userId } })).id;
      await recordAudit(tx, actor, { action: "create", entityType: "worker", entityId: id, summary: `Registered crew member ${v.name}` }, meta);
    }
    await tx.workerSkill.createMany({ data: [...new Set(v.skillIds)].map((skillId) => ({ workerId: id!, skillId })) });
    return { id };
  });
}

export const unavailableSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a day."), reason: z.string().trim().max(120).optional() });

export async function addUnavailable(db: Db, actor: Actor, workerId: string, input: z.input<typeof unavailableSchema>, meta: RequestMeta = {}) {
  const v = parseInput(unavailableSchema, input);
  const own = actor.accountType === "LABOUR" && actor.workerId === workerId;
  if (!own) {
    staffOnly(actor);
    assertCan(actor, "crew.edit", "You can't change crew details.");
    if (actor.grants.get("crew.edit") !== "ALL") throw new ForbiddenError("You can't change crew details.");
  }
  const date = new Date(`${v.date}T00:00:00Z`);
  if (date < todayAsDate()) throw new ValidationError("Pick today or a later day.", { date: "Pick today or a later day." });
  return db.$transaction(async (tx) => {
    const w = await tx.worker.findFirst({ where: { id: workerId, deletedAt: null }, select: { name: true } });
    if (!w) throw new NotFoundError("That crew member");
    const booked = await tx.crewShift.count({ where: { date, assignment: { workerId, status: { in: ["ASSIGNED", "CONFIRMED"] } } } });
    if (booked) throw new ConflictError(`${own ? "You are" : `${w.name} is`} already booked that day. ${own ? "Please call the manager." : "Take them off that booking first."}`);
    await tx.workerUnavailability.upsert({ where: { workerId_date: { workerId, date } }, create: { workerId, date, reason: v.reason || null }, update: { reason: v.reason || null } });
    await recordAudit(tx, actor, { action: "update", entityType: "worker", entityId: workerId, summary: `${w.name} not available on ${v.date}${v.reason ? ` (${v.reason})` : ""}` }, meta);
  });
}

export async function removeUnavailable(db: Db, actor: Actor, workerId: string, id: string) {
  const own = actor.accountType === "LABOUR" && actor.workerId === workerId;
  if (!own) {
    staffOnly(actor);
    if (actor.grants.get("crew.edit") !== "ALL") throw new ForbiddenError("You can't change crew details.");
  }
  const row = await db.workerUnavailability.findFirst({ where: { id, workerId } });
  if (!row) throw new NotFoundError("That day");
  await db.workerUnavailability.delete({ where: { id } });
}
