/**
 * A vendor's job on a booking, from invitation to completion:
 *
 *   INVITED ──quote──▶ QUOTED ──owner approves──▶ APPROVED ──work order──▶ (vendor accepts) ACCEPTED
 *      ▲                  │                                                        │
 *      └──owner asks to revise                                     IN_PROGRESS ──▶ DELIVERED ──▶ COMPLETED
 *
 *  - Managers (quotes.request) invite vendors to bookings they run and cancel jobs that are not yet booked.
 *  - Vendors (quotes.submit, own jobs only) send quotes; a new quote replaces one still waiting.
 *    Staff with quotes.submit (the accountant) can enter a quote received on paper or WhatsApp.
 *  - Every quote goes to the owners' approvals inbox. Owners decide (see approvals/service.ts).
 *  - After approval, a manager issues a numbered work order; the vendor accepts it, then reports progress.
 *  - A manager or supervisor signs the job off once the work is delivered.
 */
import { z } from "zod";
import { inSequence, type Db, type DbTx } from "@/lib/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { formatINR, todayInIndia, toNumber } from "@/lib/format";
import { nextDocumentNumber } from "@/lib/numbering";
import { parseInput } from "@/lib/validate";
import { recordAudit, type RequestMeta } from "@/modules/audit/audit";
import type { Actor } from "@/modules/identity/actor";
import type { PermissionKey } from "@/modules/identity/permissions";
import {
  assertCan,
  assertEventAccess,
  can,
  vendorAssignmentWhere,
} from "@/modules/identity/policy";
import {
  bookingTeamUserIds,
  notify,
  ownerUserIds,
  vendorUserIds,
} from "@/modules/notifications/notify";
import { GST_RATES, priceLines } from "./pricing";

const IST = "+05:30";

// ───────────────────────────── Loading a job with access checks ─────────────────────────────

async function loadJob(
  db: DbTx,
  actor: Actor,
  assignmentId: string,
  permission: PermissionKey,
) {
  const job = await db.vendorAssignment.findFirst({
    where: {
      AND: [{ id: assignmentId }, vendorAssignmentWhere(actor, permission)],
    },
    include: {
      vendor: { select: { id: true, companyName: true } },
      event: { select: { id: true, name: true, status: true } },
    },
  });
  if (!job) throw new NotFoundError("That job");
  return job;
}

/** Staff working on a booking's vendors need the permission, and (unless their scope is ALL) to be on the booking. */
async function assertStaffOnBooking(
  db: DbTx,
  actor: Actor,
  eventId: string,
  permission: PermissionKey,
  message: string,
) {
  if (actor.accountType !== "INTERNAL") throw new ForbiddenError(message);
  assertCan(actor, permission, message);
  await assertEventAccess(db, actor, eventId, permission);
}

// ───────────────────────────── Staff: invite and cancel ─────────────────────────────

export const inviteVendorSchema = z.object({
  eventId: z.string().uuid(),
  vendorId: z.string().uuid("Pick a vendor."),
  categoryId: z.string().uuid().optional(),
  scopeOfWork: z
    .string()
    .trim()
    .min(3, "Describe the work, e.g. Stage and mandap decor.")
    .max(500),
  functionIds: z.array(z.string().uuid()).min(1, "Pick at least one function."),
  reportingDate: z
    .union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)])
    .optional(),
  reportingTime: z
    .union([z.literal(""), z.string().regex(/^\d{2}:\d{2}$/)])
    .optional(),
});
export type InviteVendorInput = z.input<typeof inviteVendorSchema>;

export async function inviteVendor(
  db: Db,
  actor: Actor,
  input: InviteVendorInput,
  meta: RequestMeta = {},
) {
  const v = parseInput(inviteVendorSchema, input);
  return db.$transaction(async (tx) => {
    await assertStaffOnBooking(
      tx,
      actor,
      v.eventId,
      "quotes.request",
      "You can't ask vendors for quotes on this booking.",
    );
    const [event, vendor, fns] = await inSequence([
      tx.event.findUniqueOrThrow({
        where: { id: v.eventId },
        select: { name: true, status: true },
      }),
      tx.vendor.findFirst({
        where: { id: v.vendorId, deletedAt: null },
        select: { id: true, companyName: true, status: true },
      }),
      tx.eventFunction.findMany({
        where: { eventId: v.eventId, id: { in: v.functionIds } },
        select: { id: true, startsAt: true },
      }),
    ]);
    if (["COMPLETED", "SETTLED", "CANCELLED"].includes(event.status))
      throw new ConflictError("This booking is closed.");
    if (!vendor)
      throw new ValidationError("Pick a vendor.", {
        vendorId: "Pick a vendor.",
      });
    if (vendor.status !== "ACTIVE")
      throw new ValidationError(
        `${vendor.companyName} is not an active vendor.`,
        { vendorId: "This vendor is not active." },
      );
    if (fns.length !== new Set(v.functionIds).size)
      throw new ValidationError("Pick functions from this booking.", {
        functionIds: "Pick functions from this booking.",
      });
    const categoryId =
      v.categoryId ??
      (
        await tx.vendorCategoryLink.findFirst({
          where: { vendorId: vendor.id },
          select: { categoryId: true },
        })
      )?.categoryId ??
      null;

    const duplicate = await tx.vendorAssignment.count({
      where: {
        eventId: v.eventId,
        vendorId: vendor.id,
        categoryId,
        status: { notIn: ["DECLINED", "CANCELLED", "COMPLETED"] },
      },
    });
    if (duplicate)
      throw new ConflictError(
        `${vendor.companyName} is already on this booking for that work.`,
      );

    const reportingAt = v.reportingDate
      ? new Date(`${v.reportingDate}T${v.reportingTime || "09:00"}:00${IST}`)
      : null;
    const job = await tx.vendorAssignment.create({
      data: {
        eventId: v.eventId,
        vendorId: vendor.id,
        categoryId,
        scopeOfWork: v.scopeOfWork,
        reportingAt,
        createdById: actor.userId,
        functions: { create: fns.map((f) => ({ functionId: f.id })) },
      },
    });
    await notify(tx, await vendorUserIds(tx, vendor.id), {
      type: "job.invited",
      title: `New job: ${v.scopeOfWork}`,
      body: `${event.name}. Please send your quote.`,
      link: `/vendor/jobs/${job.id}`,
      entityType: "vendor_assignment",
      entityId: job.id,
    });
    await recordAudit(
      tx,
      actor,
      {
        action: "create",
        entityType: "vendor_assignment",
        entityId: job.id,
        summary: `Asked ${vendor.companyName} to quote for ${v.scopeOfWork} (${event.name})`,
      },
      meta,
    );
    return { id: job.id };
  });
}

/** Withdraws a job that is not yet booked (no accepted work order). Any quote waiting for approval is withdrawn too. */
export async function cancelJob(
  db: Db,
  actor: Actor,
  assignmentId: string,
  reason: string,
  meta: RequestMeta = {},
) {
  const why = reason.trim();
  if (!why)
    throw new ValidationError("Write a short reason for the vendor.", {
      reason: "A reason is needed.",
    });
  return db.$transaction(async (tx) => {
    const job = await loadJob(tx, actor, assignmentId, "quotes.request");
    await assertStaffOnBooking(
      tx,
      actor,
      job.eventId,
      "quotes.request",
      "You can't change vendors on this booking.",
    );
    if (!["INVITED", "QUOTED", "APPROVED"].includes(job.status))
      throw new ConflictError(
        "This job is already booked or closed. Talk to the owners to cancel it.",
      );
    await withdrawWaitingQuotes(tx, job.id);
    await tx.vendorAssignment.update({
      where: { id: job.id },
      data: { status: "CANCELLED", declineReason: why },
    });
    await notify(tx, await vendorUserIds(tx, job.vendorId), {
      type: "job.cancelled",
      title: `Job withdrawn: ${job.scopeOfWork}`,
      body: why,
      link: `/vendor/jobs/${job.id}`,
      entityType: "vendor_assignment",
      entityId: job.id,
    });
    await recordAudit(
      tx,
      actor,
      {
        action: "cancel",
        entityType: "vendor_assignment",
        entityId: job.id,
        summary: `Withdrew ${job.vendor.companyName} from ${job.event.name} · ${why}`,
      },
      meta,
    );
  });
}

async function withdrawWaitingQuotes(tx: DbTx, assignmentId: string) {
  const waiting = await tx.quotation.findMany({
    where: { assignmentId, status: "SUBMITTED" },
    select: { id: true },
  });
  if (waiting.length === 0) return;
  const ids = waiting.map((q) => q.id);
  await tx.quotation.updateMany({
    where: { id: { in: ids } },
    data: { status: "WITHDRAWN" },
  });
  await tx.approvalRequest.updateMany({
    where: { type: "QUOTATION", entityId: { in: ids }, state: "PENDING" },
    data: {
      state: "CANCELLED",
      decidedAt: new Date(),
      comment: "Replaced or withdrawn",
    },
  });
}

// ───────────────────────────── Quotes ─────────────────────────────

const money = z.coerce
  .number({ message: "Enter an amount." })
  .min(0, "Can't be negative.")
  .max(100_000_000, "That amount is too large.");

export const quoteItemSchema = z.object({
  description: z.string().trim().min(1, "Describe the item.").max(200),
  quantity: z.coerce
    .number({ message: "Enter a quantity." })
    .positive("Quantity must be more than 0.")
    .max(100000),
  unit: z.string().trim().max(20).optional(),
  rate: money,
  gstRate: z.coerce
    .number()
    .refine(
      (n) => (GST_RATES as readonly number[]).includes(n),
      "Pick a GST rate.",
    ),
});

export const submitQuoteSchema = z.object({
  items: z
    .array(quoteItemSchema)
    .min(1, "Add at least one line.")
    .max(60, "Up to 60 lines."),
  validUntil: z
    .union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)])
    .optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type SubmitQuoteInput = z.input<typeof submitQuoteSchema>;

/** Prices the lines; refuses a quote worth nothing. */
export function priceQuote(
  items: { quantity: number; rate: number; gstRate: number }[],
) {
  const priced = priceLines(items);
  if (priced.subtotal <= 0)
    throw new ValidationError("The quote total must be more than ₹0.", {
      items: "The quote total must be more than ₹0.",
    });
  return priced;
}

export async function submitQuote(
  db: Db,
  actor: Actor,
  assignmentId: string,
  input: SubmitQuoteInput,
  meta: RequestMeta = {},
) {
  const v = parseInput(submitQuoteSchema, input);
  if (v.validUntil && v.validUntil < todayInIndia())
    throw new ValidationError("'Valid until' is in the past.", {
      validUntil: "Pick today or a later date.",
    });
  const priced = priceQuote(v.items);

  return db.$transaction(async (tx) => {
    assertCan(actor, "quotes.submit", "You can't send quotes.");
    const job = await loadJob(
      tx,
      actor,
      assignmentId,
      actor.accountType === "VENDOR" ? "quotes.submit" : "bookings.view",
    );
    if (actor.accountType === "INTERNAL")
      await assertEventAccess(tx, actor, job.eventId, "quotes.submit");
    if (!["INVITED", "QUOTED"].includes(job.status))
      throw new ConflictError(
        job.status === "APPROVED" || job.status === "ACCEPTED"
          ? "This quote is already approved."
          : "This job is not open for quotes.",
      );
    if (["COMPLETED", "SETTLED", "CANCELLED"].includes(job.event.status))
      throw new ConflictError("This booking is closed.");

    await withdrawWaitingQuotes(tx, job.id);
    const last = await tx.quotation.aggregate({
      where: { assignmentId: job.id },
      _max: { version: true },
    });
    const version = (last._max.version ?? 0) + 1;
    const quote = await tx.quotation.create({
      data: {
        assignmentId: job.id,
        vendorId: job.vendorId,
        version,
        subtotal: priced.subtotal,
        taxAmount: priced.tax,
        total: priced.total,
        validUntil: v.validUntil ? new Date(`${v.validUntil}T00:00:00Z`) : null,
        notes: v.notes || null,
        submittedById: actor.userId,
        items: {
          create: v.items.map((i, n) => ({
            description: i.description,
            quantity: i.quantity,
            unit: i.unit || null,
            rate: i.rate,
            amount: priced.lines[n].amount,
            gstRate: i.gstRate,
            sortOrder: n,
          })),
        },
      },
    });
    await tx.vendorAssignment.update({
      where: { id: job.id },
      data: { status: "QUOTED" },
    });
    const summary = `${job.vendor.companyName} · ${job.scopeOfWork} · ${job.event.name}${version > 1 ? ` (v${version})` : ""}`;
    await tx.approvalRequest.create({
      data: {
        type: "QUOTATION",
        entityId: quote.id,
        eventId: job.eventId,
        amount: priced.total,
        summary,
        requestedById: actor.userId,
      },
    });

    const owners = await ownerUserIds(tx);
    await notify(
      tx,
      owners,
      {
        type: "approval.requested",
        title: `Quote to approve: ${formatINR(priced.total)}`,
        body: summary,
        link: "/approvals",
        entityType: "quotation",
        entityId: quote.id,
      },
      { exceptUserId: actor.userId },
    );
    const managers = (await bookingTeamUserIds(tx, job.eventId)).filter(
      (id) => !owners.includes(id),
    );
    await notify(
      tx,
      managers,
      {
        type: "quote.received",
        title: `Quote received from ${job.vendor.companyName}`,
        body: `${job.scopeOfWork} · waiting for the owners`,
        link: `/bookings/${job.eventId}?tab=vendors`,
        entityType: "quotation",
        entityId: quote.id,
      },
      { exceptUserId: actor.userId },
    );
    await recordAudit(
      tx,
      actor,
      {
        action: "submit",
        entityType: "quotation",
        entityId: quote.id,
        summary: `Quote v${version} ${formatINR(priced.total)} from ${job.vendor.companyName} for ${job.event.name}`,
        financial: true,
      },
      meta,
    );
    return { id: quote.id, version, total: priced.total };
  });
}

// ───────────────────────────── Vendor: decline, accept, progress ─────────────────────────────

export async function declineJob(
  db: Db,
  actor: Actor,
  assignmentId: string,
  reason: string,
  meta: RequestMeta = {},
) {
  const why = reason.trim();
  if (!why)
    throw new ValidationError(
      "Tell us why, so the manager can plan around it.",
      { reason: "A reason is needed." },
    );
  return db.$transaction(async (tx) => {
    assertCan(actor, "jobs.respond", "Only the vendor can decline a job.");
    const job = await loadJob(tx, actor, assignmentId, "jobs.respond");
    if (!["INVITED", "QUOTED"].includes(job.status))
      throw new ConflictError(
        "This job can no longer be declined here. Please call the manager.",
      );
    await withdrawWaitingQuotes(tx, job.id);
    await tx.vendorAssignment.update({
      where: { id: job.id },
      data: { status: "DECLINED", declineReason: why },
    });
    await notify(tx, await bookingTeamUserIds(tx, job.eventId), {
      type: "job.declined",
      title: `${job.vendor.companyName} declined`,
      body: `${job.scopeOfWork} · ${why}`,
      link: `/bookings/${job.eventId}?tab=vendors`,
      entityType: "vendor_assignment",
      entityId: job.id,
    });
    await recordAudit(
      tx,
      actor,
      {
        action: "decline",
        entityType: "vendor_assignment",
        entityId: job.id,
        summary: `${job.vendor.companyName} declined ${job.scopeOfWork} (${job.event.name}) · ${why}`,
      },
      meta,
    );
  });
}

/** Issues the numbered work order for an approved quote. */
export async function issueWorkOrder(
  db: Db,
  actor: Actor,
  assignmentId: string,
  terms: string | undefined,
  meta: RequestMeta = {},
) {
  return db.$transaction(async (tx) => {
    const job = await loadJob(tx, actor, assignmentId, "bookings.view");
    await assertStaffOnBooking(
      tx,
      actor,
      job.eventId,
      "workOrders.issue",
      "You can't issue work orders on this booking.",
    );
    if (job.status !== "APPROVED")
      throw new ConflictError("A work order needs an approved quote first.");
    const quote = await tx.quotation.findFirst({
      where: { assignmentId: job.id, status: "APPROVED" },
      orderBy: { version: "desc" },
      include: { workOrder: { select: { id: true } } },
    });
    if (!quote)
      throw new ConflictError("A work order needs an approved quote first.");
    if (quote.workOrder)
      throw new ConflictError(
        "A work order was already issued for this quote.",
      );
    const number = await nextDocumentNumber(
      tx,
      "WO",
      todayInIndia().slice(0, 4),
      "WO",
    );
    const wo = await tx.workOrder.create({
      data: {
        number,
        assignmentId: job.id,
        quotationId: quote.id,
        amount: quote.total,
        terms: terms?.trim() || null,
        issuedById: actor.userId,
      },
    });
    await notify(tx, await vendorUserIds(tx, job.vendorId), {
      type: "workorder.issued",
      title: `Work order ${number}: please accept`,
      body: `${job.scopeOfWork} · ${job.event.name} · ${formatINR(quote.total)}`,
      link: `/vendor/jobs/${job.id}`,
      entityType: "work_order",
      entityId: wo.id,
    });
    await recordAudit(
      tx,
      actor,
      {
        action: "issue",
        entityType: "work_order",
        entityId: wo.id,
        summary: `Issued ${number} to ${job.vendor.companyName} for ${formatINR(quote.total)}`,
        financial: true,
      },
      meta,
    );
    return { id: wo.id, number };
  });
}

export async function acceptWorkOrder(
  db: Db,
  actor: Actor,
  assignmentId: string,
  meta: RequestMeta = {},
) {
  return db.$transaction(async (tx) => {
    assertCan(
      actor,
      "jobs.respond",
      "Only the vendor can accept a work order.",
    );
    const job = await loadJob(tx, actor, assignmentId, "jobs.respond");
    const wo = await tx.workOrder.findFirst({
      where: { assignmentId: job.id, status: "ISSUED" },
      orderBy: { issuedAt: "desc" },
    });
    if (job.status !== "APPROVED" || !wo)
      throw new ConflictError(
        "There is no work order waiting for you on this job.",
      );
    await tx.workOrder.update({
      where: { id: wo.id },
      data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date() },
    });
    await tx.vendorAssignment.update({
      where: { id: job.id },
      data: { status: "ACCEPTED" },
    });
    await notify(tx, await bookingTeamUserIds(tx, job.eventId), {
      type: "workorder.accepted",
      title: `${job.vendor.companyName} accepted ${wo.number}`,
      body: job.scopeOfWork,
      link: `/bookings/${job.eventId}?tab=vendors`,
      entityType: "work_order",
      entityId: wo.id,
    });
    await recordAudit(
      tx,
      actor,
      {
        action: "accept",
        entityType: "work_order",
        entityId: wo.id,
        summary: `${job.vendor.companyName} accepted ${wo.number}`,
      },
      meta,
    );
  });
}

export const progressSchema = z.object({
  stage: z.enum(["IN_PROGRESS", "DELIVERED"]),
  note: z.string().trim().max(500).optional(),
});

/** The vendor reports that work has started, or is done. */
export async function reportProgress(
  db: Db,
  actor: Actor,
  assignmentId: string,
  input: z.input<typeof progressSchema>,
  meta: RequestMeta = {},
) {
  const v = parseInput(progressSchema, input);
  return db.$transaction(async (tx) => {
    assertCan(actor, "jobs.respond", "Only the vendor can report progress.");
    const job = await loadJob(tx, actor, assignmentId, "jobs.respond");
    const allowedFrom =
      v.stage === "IN_PROGRESS" ? ["ACCEPTED"] : ["ACCEPTED", "IN_PROGRESS"];
    if (!allowedFrom.includes(job.status))
      throw new ConflictError(
        v.stage === "IN_PROGRESS"
          ? "Accept the work order first."
          : "This job can't be marked done right now.",
      );
    await tx.vendorAssignment.update({
      where: { id: job.id },
      data: { status: v.stage },
    });
    const note =
      v.note || (v.stage === "IN_PROGRESS" ? "Work started" : "Work done");
    await tx.progressUpdate.create({
      data: {
        assignmentId: job.id,
        note,
        percent: v.stage === "DELIVERED" ? 100 : null,
        createdById: actor.userId,
      },
    });
    if (v.stage === "DELIVERED") {
      await notify(
        tx,
        await bookingTeamUserIds(tx, job.eventId, ["MANAGER", "SUPERVISOR"]),
        {
          type: "job.delivered",
          title: `${job.vendor.companyName}: work done`,
          body: `${job.scopeOfWork} · please check and sign off`,
          link: `/bookings/${job.eventId}?tab=vendors`,
          entityType: "vendor_assignment",
          entityId: job.id,
        },
      );
    }
    await recordAudit(
      tx,
      actor,
      {
        action: "progress",
        entityType: "vendor_assignment",
        entityId: job.id,
        summary: `${job.vendor.companyName}: ${note} (${job.event.name})`,
      },
      meta,
    );
  });
}

/** A manager or supervisor signs off delivered work (needs proof review rights on the booking). */
export async function signOffJob(
  db: Db,
  actor: Actor,
  assignmentId: string,
  meta: RequestMeta = {},
) {
  return db.$transaction(async (tx) => {
    const job = await loadJob(tx, actor, assignmentId, "bookings.view");
    await assertStaffOnBooking(
      tx,
      actor,
      job.eventId,
      "proof.review",
      "You can't sign off vendor work on this booking.",
    );
    if (job.status !== "DELIVERED")
      throw new ConflictError(
        "The vendor hasn't marked this work as done yet.",
      );
    await tx.vendorAssignment.update({
      where: { id: job.id },
      data: { status: "COMPLETED" },
    });
    await notify(tx, await vendorUserIds(tx, job.vendorId), {
      type: "job.completed",
      title: `Signed off: ${job.scopeOfWork}`,
      body: `${job.event.name}. Thank you!`,
      link: `/vendor/jobs/${job.id}`,
      entityType: "vendor_assignment",
      entityId: job.id,
    });
    await recordAudit(
      tx,
      actor,
      {
        action: "complete",
        entityType: "vendor_assignment",
        entityId: job.id,
        summary: `Signed off ${job.vendor.companyName} · ${job.scopeOfWork} (${job.event.name})`,
      },
      meta,
    );
  });
}

// ───────────────────────────── Reading a job ─────────────────────────────

/** One job as the vendor (or staff) sees it. Amounts only with quotes.view; the host's contact only when the booking shares it. */
export async function getJob(db: Db, actor: Actor, assignmentId: string) {
  const job = await db.vendorAssignment.findFirst({
    where: { AND: [{ id: assignmentId }, vendorAssignmentWhere(actor)] },
    include: {
      vendor: { select: { companyName: true } },
      category: { select: { name: true, color: true } },
      event: {
        select: {
          id: true,
          name: true,
          status: true,
          shareHostContactWithVendors: true,
          clientId: true,
          members: {
            where: { role: { in: ["MANAGER", "SUPERVISOR"] } },
            select: {
              role: true,
              user: { select: { name: true, phoneNumber: true } },
            },
          },
        },
      },
      functions: {
        include: {
          function: {
            include: {
              venue: { select: { name: true, address: true, mapUrl: true } },
            },
          },
        },
      },
      requirements: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          title: true,
          description: true,
          quantity: true,
          unit: true,
        },
      },
      scheduleItems: {
        orderBy: { startsAt: "asc" },
        select: {
          id: true,
          title: true,
          startsAt: true,
          location: true,
          type: true,
        },
      },
      workOrders: {
        orderBy: { issuedAt: "desc" },
        select: {
          id: true,
          number: true,
          amount: true,
          status: true,
          terms: true,
          issuedAt: true,
          acknowledgedAt: true,
        },
      },
      progress: {
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { note: true, createdAt: true },
      },
    },
  });
  if (!job) throw new NotFoundError("That job");
  const seesAmounts = can(actor, "quotes.view");
  const quotes = seesAmounts
    ? await db.quotation.findMany({
        where: { assignmentId: job.id },
        orderBy: { version: "desc" },
        include: { items: { orderBy: { sortOrder: "asc" } } },
      })
    : [];
  const host =
    job.event.shareHostContactWithVendors || can(actor, "clients.view")
      ? await db.client.findUnique({
          where: { id: job.event.clientId },
          select: { name: true, phone: true },
        })
      : null;
  const fns = job.functions
    .map((f) => f.function)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return {
    id: job.id,
    vendorId: job.vendorId,
    status: job.status,
    vendor: job.vendor.companyName,
    department: job.category,
    scope: job.scopeOfWork,
    reportingAt: job.reportingAt,
    declineReason: job.declineReason,
    event: { id: job.event.id, name: job.event.name, status: job.event.status },
    host,
    team: job.event.members.map((m) => ({
      role: m.role,
      name: m.user.name,
      phone: m.user.phoneNumber,
    })),
    functions: fns.map((f) => ({
      id: f.id,
      name: f.name,
      startsAt: f.startsAt,
      endsAt: f.endsAt,
      venue: f.venue?.name ?? f.venueText,
      address: f.venue?.address ?? null,
      mapUrl: f.venue?.mapUrl ?? null,
      guests: f.expectedGuests,
    })),
    requirements: job.requirements.map((r) => ({
      ...r,
      quantity: r.quantity ? toNumber(r.quantity) : null,
    })),
    schedule: job.scheduleItems,
    agreed: seesAmounts && job.agreedAmount ? toNumber(job.agreedAmount) : null,
    workOrders: job.workOrders.map((w) => ({
      ...w,
      amount: seesAmounts ? toNumber(w.amount) : null,
    })),
    progress: job.progress,
    quotes: quotes.map((q) => ({
      id: q.id,
      version: q.version,
      status: q.status,
      subtotal: toNumber(q.subtotal),
      tax: toNumber(q.taxAmount),
      total: toNumber(q.total),
      validUntil: q.validUntil,
      notes: q.notes,
      reviewNote: q.reviewNote,
      createdAt: q.createdAt,
      items: q.items.map((i) => ({
        description: i.description,
        quantity: toNumber(i.quantity),
        unit: i.unit,
        rate: toNumber(i.rate),
        amount: toNumber(i.amount),
        gstRate: toNumber(i.gstRate),
      })),
    })),
  };
}

export type VendorJob = Awaited<ReturnType<typeof getJob>>;

/** Vendors that a manager can invite to a booking, with their departments. */
export async function invitableVendors(db: Db, actor: Actor) {
  if (!can(actor, "quotes.request")) return [];
  const rows = await db.vendor.findMany({
    where: { status: "ACTIVE", deletedAt: null },
    orderBy: { companyName: "asc" },
    select: {
      id: true,
      companyName: true,
      city: true,
      categories: {
        select: { category: { select: { id: true, name: true } } },
      },
    },
    take: 500,
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.companyName,
    city: r.city,
    categories: r.categories.map((c) => c.category),
  }));
}
