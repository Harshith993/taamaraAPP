/**
 * Bookings (events) and their functions.
 *
 * Creating a booking: one or more functions, a client (existing or new), a readable code (EVT-2026-0042),
 * the creator assigned as manager if they are a manager, and the booking type's checklist turned into tasks.
 */
import { z } from "zod";
import type { Db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { todayAsDate, todayInIndia } from "@/lib/format";
import { nextDocumentNumber } from "@/lib/numbering";
import { normalizePhone } from "@/lib/phone";
import { parseInput } from "@/lib/validate";
import { recordAudit, type RequestMeta } from "@/modules/audit/audit";
import type { Actor } from "@/modules/identity/actor";
import { assertCan, can, eventWhere } from "@/modules/identity/policy";

const IST = "+05:30";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
const time = z.string().regex(/^\d{2}:\d{2}$/, "Pick a time.");

export const functionInputSchema = z.object({
  name: z.string().trim().min(1, "Name the function, e.g. Sangeet.").max(60),
  date,
  startTime: time,
  endTime: z.union([z.literal(""), time]).optional(),
  venueText: z.string().trim().max(120).optional(),
  guests: z.coerce.number().int().min(0).max(100000).optional(),
});

export const createBookingSchema = z
  .object({
    name: z.string().trim().min(2, "Name the booking, e.g. Aditi & Karan.").max(120),
    categoryId: z.string().uuid("Pick the type of event."),
    status: z.enum(["TENTATIVE", "CONFIRMED"]).default("TENTATIVE"),
    clientId: z.string().uuid().optional(),
    clientName: z.string().trim().max(120).optional(),
    clientPhone: z.string().trim().max(30).optional(),
    expectedGuests: z.coerce.number().int().min(0).max(100000).optional(),
    description: z.string().trim().max(2000).optional(),
    functions: z.array(functionInputSchema).min(1, "Add at least one function.").max(20),
  })
  .superRefine((v, ctx) => {
    if (!v.clientId && !v.clientName) ctx.addIssue({ code: "custom", path: ["clientName"], message: "Pick a client or enter a new client's name." });
  });
export type CreateBookingInput = z.input<typeof createBookingSchema>;

export function toInstant(day: string, hhmm: string): Date {
  return new Date(`${day}T${hhmm}:00${IST}`);
}

/** Clients this person may pick when creating a booking. */
export async function pickableClients(db: Db, actor: Actor) {
  if (!can(actor, "clients.view")) return [];
  const where: Prisma.ClientWhereInput = { deletedAt: null };
  if (actor.grants.get("clients.view") === "ASSIGNED") where.events = { some: eventWhere(actor, "clients.view") };
  return db.client.findMany({ where, orderBy: { name: "asc" }, select: { id: true, name: true, phone: true }, take: 500 });
}

export async function createBooking(db: Db, actor: Actor, input: CreateBookingInput, meta: RequestMeta = {}) {
  assertCan(actor, "bookings.create", "You can't create bookings.");
  const v = parseInput(createBookingSchema, input);

  const category = await db.eventCategory.findUnique({ where: { id: v.categoryId }, include: { defaultTemplate: { include: { items: { orderBy: { sortOrder: "asc" } } } } } });
  if (!category || !category.active) throw new ValidationError("Pick the type of event.", { categoryId: "Pick the type of event." });

  if (v.clientId) {
    const allowed = await pickableClients(db, actor);
    if (!allowed.some((c) => c.id === v.clientId)) throw new NotFoundError("That client");
  }
  const clientPhone = v.clientPhone ? normalizePhone(v.clientPhone) : null;
  if (v.clientPhone && !clientPhone) throw new ValidationError("That phone number doesn't look right.", { clientPhone: "Use a 10-digit mobile number." });

  const fns = v.functions
    .map((f) => {
      const startsAt = toInstant(f.date, f.startTime);
      let endsAt = f.endTime ? toInstant(f.date, f.endTime) : null;
      if (endsAt && endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + 24 * 3600 * 1000); // ends after midnight
      return { ...f, startsAt, endsAt };
    })
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .map((f, i) => ({ ...f, sortOrder: i }));
  const firstDay = fns[0].date;
  const lastDay = fns[fns.length - 1].date;

  return db.$transaction(async (tx) => {
    const clientId =
      v.clientId ??
      (await tx.client.create({ data: { name: v.clientName!, phone: clientPhone, createdById: actor.userId } })).id;
    const code = await nextDocumentNumber(tx, "EVT", todayInIndia().slice(0, 4), "EVT");
    const event = await tx.event.create({
      data: {
        code,
        name: v.name,
        categoryId: category.id,
        clientId,
        status: v.status,
        startDate: new Date(`${firstDay}T00:00:00Z`),
        endDate: new Date(`${lastDay}T00:00:00Z`),
        expectedGuests: v.expectedGuests,
        description: v.description || null,
        createdById: actor.userId,
        functions: {
          create: fns.map((f) => ({
            name: f.name,
            date: new Date(`${f.date}T00:00:00Z`),
            startsAt: f.startsAt,
            endsAt: f.endsAt,
            venueText: f.venueText || null,
            expectedGuests: f.guests,
            sortOrder: f.sortOrder,
          })),
        },
        // A manager who creates a booking runs it (otherwise they could not see it).
        members: !actor.isOwner && actor.roles.includes("EVENT_MANAGER") ? { create: { userId: actor.userId, role: "MANAGER" } } : undefined,
      },
    });

    let taskCount = 0;
    if (category.defaultTemplate) {
      const first = new Date(`${firstDay}T10:00:00${IST}`);
      const today = todayAsDate();
      const assignee = !actor.isOwner && actor.roles.includes("EVENT_MANAGER") ? actor.userId : null;
      const data = category.defaultTemplate.items.map((item) => {
        const due = new Date(first.getTime() + item.dueOffsetDays * 24 * 3600 * 1000);
        return {
          eventId: event.id,
          title: item.title,
          description: item.description,
          priority: item.priority,
          status: assignee ? ("ASSIGNED" as const) : ("PENDING" as const),
          // Steps whose date has already passed for a short-notice booking are due today instead.
          dueAt: due < today ? new Date(`${todayInIndia()}T18:00:00${IST}`) : due,
          assigneeId: assignee,
          needsProof: item.needsProof,
          createdById: actor.userId,
        };
      });
      taskCount = (await tx.task.createMany({ data })).count;
    }

    await recordAudit(tx, actor, {
      action: "create",
      entityType: "event",
      entityId: event.id,
      summary: `Created booking ${v.name} (${category.name}, ${code}) with ${fns.length} function${fns.length === 1 ? "" : "s"}${taskCount ? ` and ${taskCount} checklist tasks` : ""}`,
      after: { code, name: v.name, functions: fns.map((f) => ({ name: f.name, startsAt: f.startsAt.toISOString() })) },
    }, meta);
    return { ...event, taskCount };
  });
}

export type BookingRange = "upcoming" | "tentative" | "past" | "all";

export async function listBookings(db: Db, actor: Actor, opts: { range?: BookingRange; q?: string } = {}) {
  assertCan(actor, "bookings.view");
  const today = todayAsDate();
  const range = opts.range ?? "upcoming";
  const where: Prisma.EventWhereInput[] = [eventWhere(actor)];
  if (range === "upcoming") where.push({ status: { notIn: ["CANCELLED"] }, OR: [{ endDate: { gte: today } }, { endDate: null }] });
  if (range === "tentative") where.push({ status: "TENTATIVE" });
  if (range === "past") where.push({ endDate: { lt: today } });
  const q = opts.q?.trim();
  if (q) where.push({ OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }, { functions: { some: { name: { contains: q, mode: "insensitive" } } } }] });

  return db.event.findMany({
    where: { AND: where },
    orderBy: range === "past" ? [{ startDate: "desc" }] : [{ startDate: "asc" }],
    take: 200,
    include: {
      category: { select: { name: true, color: true } },
      functions: { orderBy: { startsAt: "asc" }, select: { name: true, startsAt: true } },
      members: { include: { user: { select: { name: true } } } },
      _count: { select: { vendorAssignments: true, crewAssignments: true, tasks: true } },
    },
  });
}
