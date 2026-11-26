/**
 * The equipment register (D58, D64): decor, furniture, lights and sound the company owns, and booking
 * it out to a booking's dates.
 *
 *   booked for the dates (RESERVED) ──check out, with a note──▶ OUT ──check in──▶ RETURNED
 *          └──cancelled, with a reason──▶ CANCELLED            good + damaged + missing = quantity
 *
 *  - Register: equipment.view (hosts, managers) to see it; equipment.manage to add and edit items
 *    and to settle missing or damaged reports.
 *  - Booking out, checking out and in: equipment.book on bookings the person runs (managers and
 *    supervisors on their bookings; hosts on any).
 *  - Clashes: when the same item is booked on overlapping dates and the total would be more than the
 *    company owns, booking still goes ahead (the team may hire extra) but everyone is warned. Asking
 *    for more than the company owns at all is refused.
 *  - Missing or damaged items on check-in need a note; hosts and the booking's manager are told, and
 *    they stay on the report until someone with equipment.manage settles them.
 *  - Nothing is deleted: items are retired, bookings of equipment are cancelled (database trigger).
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { inSequence, type Db, type DbTx } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatCalendarDate } from "@/lib/format";
import { parseInput } from "@/lib/validate";
import { recordAudit, type RequestMeta } from "@/modules/audit/audit";
import { MEDIA_SELECT, mediaView } from "@/modules/files/media";
import { enqueueProcessing } from "@/modules/files/processing";
import type { Actor } from "@/modules/identity/actor";
import { assertCan, assertEventAccess, can, eventWhere } from "@/modules/identity/policy";
import { bookingTeamUserIds, notify, ownerUserIds } from "@/modules/notifications/notify";

export const EQUIPMENT_CATEGORIES = [
  { key: "DECOR", label: "Decor" },
  { key: "FURNITURE", label: "Furniture" },
  { key: "LIGHTING", label: "Lights" },
  { key: "SOUND", label: "Sound" },
  { key: "OTHER", label: "Other" },
] as const;
export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number]["key"];
const CATEGORY_KEYS = EQUIPMENT_CATEGORIES.map((c) => c.key) as [EquipmentCategory, ...EquipmentCategory[]];
export const categoryLabel = (key: string | null) => EQUIPMENT_CATEGORIES.find((c) => c.key === key)?.label ?? "Other";

/** Bookings of equipment that hold items (booked for the dates, or out at the venue). */
const HOLDING = ["RESERVED", "OUT"] as const;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const shortDate = (d: Date | null) => (d ? formatCalendarDate(d, { day: "numeric", month: "short" }) : "?");

function staffOnly(actor: Actor) {
  if (actor.accountType !== "INTERNAL") throw new ForbiddenError("Equipment is for the team.");
}

/** How many of an item other bookings hold on dates that overlap [from, to]. */
async function heldElsewhere(tx: DbTx, itemId: string, from: Date, to: Date, exceptId?: string) {
  const rows = await tx.inventoryAllocation.findMany({
    where: { itemId, status: { in: [...HOLDING] }, fromDate: { lte: to }, toDate: { gte: from }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { quantity: true, event: { select: { name: true } }, fromDate: true, toDate: true },
  });
  return { total: rows.reduce((s, r) => s + r.quantity, 0), rows };
}

// ───────────────────────────── The register ─────────────────────────────

export const itemSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Name the item, e.g. Gold chiavari chair.").max(100),
  category: z.enum(CATEGORY_KEYS, { message: "Pick a category." }),
  quantity: z.coerce.number({ message: "Enter how many the company owns." }).int("Whole numbers only.").min(0, "Can't be negative.").max(100_000),
  condition: z.enum(["GOOD", "WORN", "NEEDS_REPAIR", "RETIRED"]).default("GOOD"),
  location: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(1000).optional(),
  photoFileId: z.union([z.literal(""), z.string().uuid()]).optional(),
});
export type ItemInput = z.input<typeof itemSchema>;

export async function saveEquipmentItem(db: Db, actor: Actor, input: ItemInput, meta: RequestMeta = {}) {
  staffOnly(actor);
  assertCan(actor, "equipment.manage", "You can't change the equipment register.");
  const v = parseInput(itemSchema, input);
  const saved = await db.$transaction(async (tx) => {
    if (v.photoFileId) {
      const f = await tx.file.findFirst({ where: { id: v.photoFileId, status: "READY", mimeType: { startsWith: "image/" }, OR: [{ uploadedById: actor.userId }, { equipmentPhotos: { some: { id: v.id ?? "-" } } }] }, select: { id: true } });
      if (!f) throw new ValidationError("Attach a photo and wait for it to finish uploading.", { photoFileId: "Attach a photo." });
    }
    const data = { name: v.name, category: v.category, quantityOwned: v.quantity, condition: v.condition, location: v.location || null, notes: v.notes || null, photoFileId: v.photoFileId || null };
    if (v.id) {
      const before = await tx.inventoryItem.findUnique({ where: { id: v.id } });
      if (!before) throw new NotFoundError("That item");
      await tx.inventoryItem.update({ where: { id: v.id }, data });
      const changed = (["name", "category", "quantityOwned", "condition", "location", "notes"] as const).filter((k) => before[k] !== data[k]);
      await recordAudit(tx, actor, { action: "update", entityType: "equipment", entityId: v.id, summary: `Updated ${v.name}${changed.length ? ` (${changed.join(", ")})` : ""}`, before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, data[k]])) }, meta);
      return { id: v.id as string };
    }
    const item = await tx.inventoryItem.create({ data: { ...data, createdById: actor.userId } });
    await recordAudit(tx, actor, { action: "create", entityType: "equipment", entityId: item.id, summary: `Added ${v.quantity} × ${v.name} (${categoryLabel(v.category)}) to the register` }, meta);
    return { id: item.id };
  });
  // A new photo gets a thumbnail and a copy without the phone's location, like work proof.
  if (v.photoFileId) {
    const f = await db.file.findUnique({ where: { id: v.photoFileId }, select: { status: true, thumbnailKey: true, mimeType: true } });
    if (f?.status === "READY" && !f.thumbnailKey) {
      await db.file.update({ where: { id: v.photoFileId }, data: { status: "PROCESSING" } });
      await enqueueProcessing(db, v.photoFileId, f.mimeType);
    }
  }
  return saved;
}

/** The register with what is out or booked now and what is missing or damaged. */
export async function listEquipment(db: Db, actor: Actor, filter: { q?: string; category?: string; showRetired?: boolean } = {}) {
  staffOnly(actor);
  assertCan(actor, "equipment.view", "You can't see the equipment register.");
  const today = asDate(new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10));
  const where: Prisma.InventoryItemWhereInput[] = [];
  if (filter.q?.trim()) where.push({ name: { contains: filter.q.trim(), mode: "insensitive" } });
  if (filter.category && filter.category !== "all") where.push({ category: filter.category });
  if (!filter.showRetired) where.push({ condition: { not: "RETIRED" } });
  const items = await db.inventoryItem.findMany({
    where: { AND: where },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    take: 500,
    include: {
      photoFile: { select: MEDIA_SELECT },
      allocations: {
        where: { OR: [{ status: { in: [...HOLDING] }, toDate: { gte: today } }, { status: "OUT" }, { status: "RETURNED", resolvedAt: null, OR: [{ quantityMissing: { gt: 0 } }, { quantityDamaged: { gt: 0 } }] }] },
        orderBy: { fromDate: "asc" },
        select: { id: true, status: true, quantity: true, fromDate: true, toDate: true, quantityMissing: true, quantityDamaged: true, event: { select: { id: true, name: true } } },
      },
    },
  });
  return items.map((i) => {
    const out = i.allocations.filter((a) => a.status === "OUT").reduce((s, a) => s + a.quantity, 0);
    const missing = i.allocations.filter((a) => a.status === "RETURNED").reduce((s, a) => s + (a.quantityMissing ?? 0), 0);
    const damaged = i.allocations.filter((a) => a.status === "RETURNED").reduce((s, a) => s + (a.quantityDamaged ?? 0), 0);
    return {
      id: i.id,
      name: i.name,
      category: i.category,
      quantity: i.quantityOwned,
      condition: i.condition,
      location: i.location,
      notes: i.notes,
      photo: i.photoFile ? mediaView(actor.userId, i.photoFile) : null,
      photoFileId: i.photoFileId,
      out,
      missing,
      damaged,
      inStore: Math.max(0, i.quantityOwned - out - missing),
      upcoming: i.allocations.filter((a) => a.status === "RESERVED").map((a) => ({ id: a.id, quantity: a.quantity, from: a.fromDate, to: a.toDate, event: a.event })),
      outAt: i.allocations.filter((a) => a.status === "OUT").map((a) => ({ id: a.id, quantity: a.quantity, to: a.toDate, event: a.event, overdue: !!a.toDate && a.toDate < today })),
    };
  });
}

export type EquipmentItemView = Awaited<ReturnType<typeof listEquipment>>[number];

/** Items with how many are free on the given dates (for the booking form). */
export async function equipmentAvailability(db: Db, actor: Actor, eventId: string, from: string, to: string) {
  staffOnly(actor);
  if (!can(actor, "equipment.book")) return [];
  await assertEventAccess(db, actor, eventId, "equipment.book");
  const f = asDate(from);
  const t = asDate(to);
  const [items, held] = await Promise.all([
    db.inventoryItem.findMany({ where: { condition: { not: "RETIRED" }, quantityOwned: { gt: 0 } }, orderBy: [{ category: "asc" }, { name: "asc" }], select: { id: true, name: true, category: true, quantityOwned: true, condition: true } }),
    db.inventoryAllocation.groupBy({ by: ["itemId"], where: { status: { in: [...HOLDING] }, fromDate: { lte: t }, toDate: { gte: f }, eventId: { not: eventId } }, _sum: { quantity: true } }),
  ]);
  return items.map((i) => {
    const elsewhere = held.find((h) => h.itemId === i.id)?._sum.quantity ?? 0;
    return { id: i.id, name: i.name, category: i.category, owned: i.quantityOwned, condition: i.condition, free: Math.max(0, i.quantityOwned - elsewhere) };
  });
}

// ───────────────────────────── Booking it out ─────────────────────────────

export const bookEquipmentSchema = z.object({
  eventId: z.string().uuid(),
  itemId: z.string().uuid("Pick an item."),
  quantity: z.coerce.number({ message: "Enter how many." }).int("Whole numbers only.").positive("At least one."),
  from: date,
  to: date,
  note: z.string().trim().max(300).optional(),
});
export type BookEquipmentInput = z.input<typeof bookEquipmentSchema>;

export async function bookEquipment(db: Db, actor: Actor, input: BookEquipmentInput, meta: RequestMeta = {}) {
  staffOnly(actor);
  assertCan(actor, "equipment.book", "You can't book equipment.");
  const v = parseInput(bookEquipmentSchema, input);
  if (v.to < v.from) throw new ValidationError("The return date is before the start.", { to: "Pick a date on or after the start." });
  return db.$transaction(async (tx) => {
    await assertEventAccess(tx, actor, v.eventId, "equipment.book");
    // One booking of equipment at a time per item, so two people can't both take the last ones unseen.
    await tx.$queryRaw`SELECT "id" FROM "inventory_items" WHERE "id" = ${v.itemId} FOR UPDATE`;
    const [event, item] = await inSequence([
      tx.event.findUniqueOrThrow({ where: { id: v.eventId }, select: { name: true, status: true } }),
      tx.inventoryItem.findUnique({ where: { id: v.itemId }, select: { id: true, name: true, quantityOwned: true, condition: true } }),
    ]);
    if (["CANCELLED", "SETTLED", "COMPLETED"].includes(event.status)) throw new ConflictError("This booking is closed.");
    if (!item || item.condition === "RETIRED") throw new ValidationError("Pick an item from the register.", { itemId: "Pick an item." });
    if (v.quantity > item.quantityOwned) throw new ValidationError(`The company owns ${item.quantityOwned} ${item.name}.`, { quantity: `At most ${item.quantityOwned}.` });
    const held = await heldElsewhere(tx, item.id, asDate(v.from), asDate(v.to));
    const a = await tx.inventoryAllocation.create({ data: { itemId: item.id, eventId: v.eventId, quantity: v.quantity, fromDate: asDate(v.from), toDate: asDate(v.to), notes: v.note || null, createdById: actor.userId } });
    const short = held.total + v.quantity - item.quantityOwned;
    const warning =
      short > 0
        ? `Clash: ${item.name} is also booked for ${held.rows.map((r) => `${r.event.name} (${r.quantity}, ${shortDate(r.fromDate)}–${shortDate(r.toDate)})`).join(", ")}. You are ${short} short; hire or swap.`
        : item.condition === "NEEDS_REPAIR"
          ? `${item.name} is marked as needing repair.`
          : null;
    await recordAudit(tx, actor, { action: "create", entityType: "equipment_booking", entityId: a.id, summary: `Booked ${v.quantity} × ${item.name} for ${event.name}, ${v.from} to ${v.to}${short > 0 ? ` (clash, ${short} short)` : ""}` }, meta);
    return { id: a.id, warning };
  });
}

async function loadAllocation(tx: DbTx, actor: Actor, id: string) {
  const a = await tx.inventoryAllocation.findUnique({ where: { id }, include: { item: { select: { name: true } }, event: { select: { name: true } } } });
  if (!a) throw new NotFoundError("That equipment booking");
  await assertEventAccess(tx, actor, a.eventId, "equipment.book");
  return a;
}

export async function cancelEquipmentBooking(db: Db, actor: Actor, allocationId: string, reason: string, meta: RequestMeta = {}) {
  staffOnly(actor);
  assertCan(actor, "equipment.book", "You can't change equipment bookings.");
  const why = reason.trim();
  if (!why) throw new ValidationError("Write a short reason.", { reason: "A reason is needed." });
  return db.$transaction(async (tx) => {
    const a = await loadAllocation(tx, actor, allocationId);
    if (a.status !== "RESERVED") throw new ConflictError(a.status === "OUT" ? "It is out at the venue. Check it back in instead." : "This is already closed.");
    await tx.inventoryAllocation.update({ where: { id: a.id }, data: { status: "CANCELLED", cancelReason: why } });
    await recordAudit(tx, actor, { action: "cancel", entityType: "equipment_booking", entityId: a.id, summary: `Cancelled ${a.quantity} × ${a.item.name} for ${a.event.name} · ${why}` }, meta);
  });
}

export const checkOutSchema = z.object({ note: z.string().trim().max(300).optional() });

/** The items leave the store for the venue; a note records their condition going out. */
export async function checkOutEquipment(db: Db, actor: Actor, allocationId: string, input: z.input<typeof checkOutSchema> = {}, meta: RequestMeta = {}) {
  staffOnly(actor);
  assertCan(actor, "equipment.book", "You can't check equipment out.");
  const v = parseInput(checkOutSchema, input);
  return db.$transaction(async (tx) => {
    const a = await loadAllocation(tx, actor, allocationId);
    if (a.status !== "RESERVED") throw new ConflictError(a.status === "OUT" ? "Already checked out." : "This is closed.");
    await tx.inventoryAllocation.update({ where: { id: a.id }, data: { status: "OUT", outAt: new Date(), outById: actor.userId, outNote: v.note || null } });
    await recordAudit(tx, actor, { action: "check-out", entityType: "equipment_booking", entityId: a.id, summary: `Checked out ${a.quantity} × ${a.item.name} for ${a.event.name}${v.note ? ` · ${v.note}` : ""}` }, meta);
  });
}

export const checkInSchema = z.object({
  good: z.coerce.number({ message: "Enter how many came back fine." }).int().min(0),
  damaged: z.coerce.number().int().min(0).default(0),
  missing: z.coerce.number().int().min(0).default(0),
  note: z.string().trim().max(500).optional(),
});

/** The items come back: how many are fine, damaged or missing. Damage and losses need a note and are reported. */
export async function checkInEquipment(db: Db, actor: Actor, allocationId: string, input: z.input<typeof checkInSchema>, meta: RequestMeta = {}) {
  staffOnly(actor);
  assertCan(actor, "equipment.book", "You can't check equipment in.");
  const v = parseInput(checkInSchema, input);
  return db.$transaction(async (tx) => {
    const a = await loadAllocation(tx, actor, allocationId);
    if (a.status !== "OUT") throw new ConflictError(a.status === "RESERVED" ? "Check it out first." : "This is already checked in.");
    if (v.good + v.damaged + v.missing !== a.quantity) throw new ValidationError(`${a.quantity} went out: fine, damaged and missing must add up to ${a.quantity}.`, { good: `Must add up to ${a.quantity}.` });
    const problem = v.damaged + v.missing > 0;
    if (problem && !v.note) throw new ValidationError("Say what was damaged or missing, and how.", { note: "A note is needed." });
    await tx.inventoryAllocation.update({ where: { id: a.id }, data: { status: "RETURNED", returnedAt: new Date(), returnedById: actor.userId, quantityReturned: v.good, quantityDamaged: v.damaged, quantityMissing: v.missing, returnNote: v.note || null } });
    if (problem) {
      const words = [v.missing ? `${v.missing} missing` : "", v.damaged ? `${v.damaged} damaged` : ""].filter(Boolean).join(", ");
      await notify(tx, [...(await ownerUserIds(tx)), ...(await bookingTeamUserIds(tx, a.eventId))], { type: "equipment.problem", title: `${a.item.name}: ${words}`, body: `${a.event.name} · ${v.note}`, link: "/equipment", entityType: "equipment_booking", entityId: a.id }, { exceptUserId: actor.userId });
    }
    await recordAudit(tx, actor, { action: "check-in", entityType: "equipment_booking", entityId: a.id, summary: `Checked in ${a.item.name} from ${a.event.name}: ${v.good} fine${v.damaged ? `, ${v.damaged} damaged` : ""}${v.missing ? `, ${v.missing} missing` : ""}${v.note ? ` · ${v.note}` : ""}` }, meta);
    return { problem };
  });
}

/** Someone with equipment.manage settles a missing or damaged report (found, repaired, written off…). */
export async function resolveEquipmentIssue(db: Db, actor: Actor, allocationId: string, note: string, meta: RequestMeta = {}) {
  staffOnly(actor);
  assertCan(actor, "equipment.manage", "Only hosts and managers settle missing or damaged equipment.");
  const what = note.trim();
  if (!what) throw new ValidationError("Say how it was settled, e.g. Found in the van, or Written off.", { note: "A note is needed." });
  return db.$transaction(async (tx) => {
    const a = await tx.inventoryAllocation.findUnique({ where: { id: allocationId }, include: { item: { select: { name: true } }, event: { select: { name: true } } } });
    if (!a) throw new NotFoundError("That equipment booking");
    if (a.status !== "RETURNED" || !((a.quantityMissing ?? 0) + (a.quantityDamaged ?? 0)) || a.resolvedAt) throw new ConflictError("Nothing to settle here.");
    await tx.inventoryAllocation.update({ where: { id: a.id }, data: { resolvedAt: new Date(), resolvedById: actor.userId, resolution: what } });
    await recordAudit(tx, actor, { action: "resolve", entityType: "equipment_booking", entityId: a.id, summary: `Settled ${a.item.name} from ${a.event.name} (${a.quantityMissing ?? 0} missing, ${a.quantityDamaged ?? 0} damaged) · ${what}` }, meta);
  });
}

// ───────────────────────────── Views ─────────────────────────────

/** A booking's equipment for its workspace tab. */
export async function bookingEquipment(db: Db, actor: Actor, eventId: string) {
  staffOnly(actor);
  if (!can(actor, "equipment.book") && !can(actor, "equipment.view")) return [];
  await assertEventAccess(db, actor, eventId, can(actor, "equipment.book") ? "equipment.book" : "bookings.view");
  const rows = await db.inventoryAllocation.findMany({
    where: { eventId, status: { not: "CANCELLED" } },
    orderBy: [{ fromDate: "asc" }, { createdAt: "asc" }],
    include: { item: { select: { id: true, name: true, category: true, quantityOwned: true, condition: true, photoFile: { select: MEDIA_SELECT } } } },
  });
  const clashes = new Map<string, number>();
  for (const r of rows.filter((x) => (HOLDING as readonly string[]).includes(x.status) && x.fromDate && x.toDate)) {
    const held = await heldElsewhere(db, r.itemId, r.fromDate!, r.toDate!, r.id);
    const short = held.total + r.quantity - r.item.quantityOwned;
    if (short > 0) clashes.set(r.id, short);
  }
  return rows.map((r) => ({
    id: r.id,
    item: { id: r.item.id, name: r.item.name, category: r.item.category, condition: r.item.condition, photo: r.item.photoFile ? mediaView(actor.userId, r.item.photoFile) : null },
    quantity: r.quantity,
    from: r.fromDate,
    to: r.toDate,
    status: r.status,
    notes: r.notes,
    outAt: r.outAt,
    outNote: r.outNote,
    returnedAt: r.returnedAt,
    good: r.quantityReturned,
    damaged: r.quantityDamaged ?? 0,
    missing: r.quantityMissing ?? 0,
    returnNote: r.returnNote,
    resolution: r.resolution,
    short: clashes.get(r.id) ?? 0,
  }));
}

/** Missing or damaged items not yet settled, items overdue back, and clashes ahead: the Equipment page report. */
export async function equipmentReport(db: Db, actor: Actor) {
  staffOnly(actor);
  assertCan(actor, "equipment.view", "You can't see the equipment register.");
  const today = asDate(new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10));
  const [issues, overdue, ahead] = await inSequence([
    db.inventoryAllocation.findMany({
      where: { status: "RETURNED", resolvedAt: null, OR: [{ quantityMissing: { gt: 0 } }, { quantityDamaged: { gt: 0 } }] },
      orderBy: { returnedAt: "desc" },
      include: { item: { select: { name: true } }, event: { select: { id: true, name: true } } },
    }),
    db.inventoryAllocation.findMany({ where: { status: "OUT", toDate: { lt: today } }, orderBy: { toDate: "asc" }, include: { item: { select: { name: true } }, event: { select: { id: true, name: true } } } }),
    db.inventoryAllocation.findMany({ where: { status: { in: [...HOLDING] }, toDate: { gte: today } }, include: { item: { select: { id: true, name: true, quantityOwned: true } }, event: { select: { id: true, name: true } } } }),
  ]);
  // Clashes: for each upcoming booking of an item, the most held on any overlapping dates.
  const clashes: { itemName: string; short: number; bookings: { id: string; name: string; quantity: number; from: Date | null; to: Date | null }[] }[] = [];
  const byItem = new Map<string, typeof ahead>();
  for (const a of ahead) byItem.set(a.itemId, [...(byItem.get(a.itemId) ?? []), a]);
  for (const list of byItem.values()) {
    const owned = list[0].item.quantityOwned;
    const seen = new Set<string>();
    for (const a of list) {
      const overlap = list.filter((b) => b.fromDate! <= a.toDate! && b.toDate! >= a.fromDate!);
      const total = overlap.reduce((s, b) => s + b.quantity, 0);
      const key = overlap.map((b) => b.id).sort().join(",");
      if (total > owned && overlap.length > 1 && !seen.has(key)) {
        seen.add(key);
        clashes.push({ itemName: a.item.name, short: total - owned, bookings: overlap.map((b) => ({ id: b.event.id, name: b.event.name, quantity: b.quantity, from: b.fromDate, to: b.toDate })) });
      }
    }
  }
  return {
    issues: issues.map((a) => ({ id: a.id, item: a.item.name, event: a.event, missing: a.quantityMissing ?? 0, damaged: a.quantityDamaged ?? 0, note: a.returnNote, returnedAt: a.returnedAt })),
    overdue: overdue.map((a) => ({ id: a.id, item: a.item.name, event: a.event, quantity: a.quantity, due: a.toDate })),
    clashes,
  };
}

/** Bookings the actor can book equipment out to (for the Equipment page's quick links). */
export async function equipmentBookings(db: Db, actor: Actor) {
  staffOnly(actor);
  if (!can(actor, "equipment.book")) return [];
  return db.event.findMany({ where: { AND: [eventWhere(actor, "equipment.book"), { status: { notIn: ["CANCELLED", "SETTLED", "COMPLETED"] } }] }, orderBy: { startDate: "asc" }, take: 50, select: { id: true, name: true, startDate: true, endDate: true } });
}
