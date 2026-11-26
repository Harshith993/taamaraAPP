/**
 * Money in and out (Phase 7).
 *
 *   Out (vendors, crew):  prepared by the accountant (payments.prepare) ──▶ an owner approves in the
 *                         approvals inbox (approvals/service.ts, with the approved-proof rule) ──▶
 *                         marked paid with method, reference and date (payments.markPaid)
 *   In (clients):         recorded as received by the accountant or an owner (payments.recordIn)
 *   Corrections:          payments are never deleted or edited once paid; they are voided with a
 *                         reason (database triggers enforce this) and a new one is recorded (G5).
 *
 * A vendor payment is against a verified invoice and can't exceed what is left on it (counting
 * payments already waiting). A crew payment can't exceed what the crew member is owed for the
 * event: agreed pay + approved extras − approved deductions − what is paid or waiting.
 */
import { z } from "zod";
import { inSequence, type Db, type DbTx } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatINR, todayInIndia, toNumber } from "@/lib/format";
import { parseInput } from "@/lib/validate";
import { recordAudit, type RequestMeta } from "@/modules/audit/audit";
import type { Actor } from "@/modules/identity/actor";
import { assertCan, assertEventAccess } from "@/modules/identity/policy";
import { assertBookingOpen } from "@/modules/events/lock";
import { notify, ownerUserIds, vendorUserIds } from "@/modules/notifications/notify";

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = z.coerce.number({ message: "Enter an amount." }).positive("The amount must be more than ₹0.").max(100_000_000, "That amount is too large.");
const METHODS = ["BANK", "UPI", "CASH", "CHEQUE", "CARD"] as const;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");

function staff(actor: Actor) {
  if (actor.accountType !== "INTERNAL") throw new ForbiddenError("Only the office handles payments.");
}

// ───────────────────────────── What is owed ─────────────────────────────

export async function invoiceBalance(tx: DbTx, invoiceId: string) {
  const [inv, paid, waiting] = await inSequence([
    tx.vendorInvoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { total: true } }),
    tx.payment.aggregate({ where: { vendorInvoiceId: invoiceId, status: "PAID" }, _sum: { amount: true } }),
    tx.payment.aggregate({ where: { vendorInvoiceId: invoiceId, status: { in: ["PENDING_APPROVAL", "APPROVED"] } }, _sum: { amount: true } }),
  ]);
  const total = toNumber(inv.total);
  const p = toNumber(paid._sum.amount);
  const w = toNumber(waiting._sum.amount);
  return { total, paid: p, waiting: w, left: round2(total - p - w) };
}

export async function crewOwed(tx: DbTx, assignmentId: string) {
  const [a, paid, waiting] = await inSequence([
    tx.crewAssignment.findUniqueOrThrow({ where: { id: assignmentId }, select: { agreedPay: true, adjustments: { where: { state: "APPROVED" }, select: { type: true, amount: true } } } }),
    tx.payment.aggregate({ where: { crewAssignmentId: assignmentId, status: "PAID" }, _sum: { amount: true } }),
    tx.payment.aggregate({ where: { crewAssignmentId: assignmentId, status: { in: ["PENDING_APPROVAL", "APPROVED"] } }, _sum: { amount: true } }),
  ]);
  const extras = a.adjustments.filter((x) => x.type === "EXTRA").reduce((s, x) => s + toNumber(x.amount), 0);
  const deductions = a.adjustments.filter((x) => x.type === "DEDUCTION").reduce((s, x) => s + toNumber(x.amount), 0);
  const total = round2(toNumber(a.agreedPay) + extras - deductions);
  const p = toNumber(paid._sum.amount);
  const w = toNumber(waiting._sum.amount);
  return { agreed: toNumber(a.agreedPay), extras, deductions, total, paid: p, waiting: w, left: round2(total - p - w) };
}

// ───────────────────────────── Preparing payments out ─────────────────────────────

export const preparePaymentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("VENDOR_INVOICE"), invoiceId: z.string().uuid(), amount: money, method: z.enum(METHODS).default("BANK"), note: z.string().trim().max(300).optional() }),
  z.object({ kind: z.literal("CREW"), assignmentId: z.string().uuid(), amount: money, method: z.enum(METHODS).default("UPI"), note: z.string().trim().max(300).optional() }),
]);
export type PreparePaymentInput = z.input<typeof preparePaymentSchema>;

export async function preparePayment(db: Db, actor: Actor, input: PreparePaymentInput, meta: RequestMeta = {}) {
  const v = parseInput(preparePaymentSchema, input);
  staff(actor);
  assertCan(actor, "payments.prepare", "You can't prepare payments.");
  return db.$transaction(async (tx) => {
    let data: { eventId: string | null; partyType: "VENDOR" | "WORKER"; vendorId?: string; workerId?: string; vendorInvoiceId?: string; crewAssignmentId?: string };
    let party: string;
    let left: number;
    let summary: string;
    if (v.kind === "VENDOR_INVOICE") {
      const inv = await tx.vendorInvoice.findUnique({ where: { id: v.invoiceId }, include: { vendor: { select: { id: true, companyName: true } }, workOrder: { select: { number: true, assignment: { select: { eventId: true, event: { select: { name: true } } } } } } } });
      if (!inv) throw new NotFoundError("That invoice");
      if (!["VERIFIED", "APPROVED", "PART_PAID"].includes(inv.status)) throw new ConflictError(inv.status === "SUBMITTED" ? "Check the invoice first (mark it verified)." : "This invoice can't be paid.");
      const bank = await tx.vendorBankDetail.findUnique({ where: { vendorId: inv.vendor.id }, select: { needsCheck: true } });
      if (bank?.needsCheck) throw new ConflictError(`${inv.vendor.companyName} changed their bank details. Call them to confirm, then mark the details as checked on their profile before paying.`);
      left = (await invoiceBalance(tx, inv.id)).left;
      party = inv.vendor.companyName;
      data = { eventId: inv.workOrder?.assignment.eventId ?? null, partyType: "VENDOR", vendorId: inv.vendor.id, vendorInvoiceId: inv.id };
      summary = `${party} · invoice ${inv.invoiceNumber}${inv.workOrder ? ` · ${inv.workOrder.assignment.event.name}` : ""}`;
    } else {
      const a = await tx.crewAssignment.findUnique({ where: { id: v.assignmentId }, include: { worker: { select: { id: true, name: true } }, event: { select: { name: true } } } });
      if (!a) throw new NotFoundError("That crew booking");
      if (!["CONFIRMED", "COMPLETED"].includes(a.status)) throw new ConflictError("Only crew who were on the booking can be paid.");
      left = (await crewOwed(tx, a.id)).left;
      party = a.worker.name;
      data = { eventId: a.eventId, partyType: "WORKER", workerId: a.worker.id, crewAssignmentId: a.id };
      summary = `${party} · ${a.duty} · ${a.event.name}`;
    }
    await assertBookingOpen(tx, data.eventId);
    if (left <= 0) throw new ConflictError(`Nothing is left to pay to ${party} here.`);
    if (v.amount > left + 0.005) throw new ConflictError(`That is more than is left to pay (${formatINR(left, { decimals: true })}).`);

    const payment = await tx.payment.create({ data: { ...data, direction: "OUT", amount: v.amount, method: v.method, note: v.note || null, status: "PENDING_APPROVAL", requestedById: actor.userId } });
    await tx.approvalRequest.create({ data: { type: "PAYMENT", entityId: payment.id, eventId: data.eventId, amount: v.amount, summary, requestedById: actor.userId } });
    await notify(tx, await ownerUserIds(tx), { type: "approval.requested", title: `Payment to approve: ${party} ${formatINR(v.amount)}`, body: summary, link: "/approvals", entityType: "payment", entityId: payment.id }, { exceptUserId: actor.userId });
    await recordAudit(tx, actor, { action: "create", entityType: "payment", entityId: payment.id, summary: `Prepared payment ${formatINR(v.amount)} to ${summary}`, financial: true }, meta);
    return { id: payment.id };
  });
}

// ───────────────────────────── Paying and voiding ─────────────────────────────

async function syncInvoiceStatus(tx: DbTx, invoiceId: string | null) {
  if (!invoiceId) return;
  const inv = await tx.vendorInvoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { status: true } });
  if (["DISPUTED", "VOID", "SUBMITTED"].includes(inv.status)) return;
  const b = await invoiceBalance(tx, invoiceId);
  const status = b.paid >= b.total - 0.005 ? "PAID" : b.paid > 0 ? "PART_PAID" : "VERIFIED";
  if (status !== inv.status) await tx.vendorInvoice.update({ where: { id: invoiceId }, data: { status } });
}

export const markPaidSchema = z.object({ method: z.enum(METHODS), reference: z.string().trim().max(80).optional(), paidOn: date });

export async function markPaid(db: Db, actor: Actor, paymentId: string, input: z.input<typeof markPaidSchema>, meta: RequestMeta = {}) {
  const v = parseInput(markPaidSchema, input);
  if (v.paidOn > todayInIndia()) throw new ValidationError("The payment date is in the future.", { paidOn: "Pick today or earlier." });
  if (v.method !== "CASH" && !v.reference) throw new ValidationError("Enter the UTR, UPI or cheque reference.", { reference: "A reference is needed (not for cash)." });
  staff(actor);
  assertCan(actor, "payments.markPaid", "You can't mark payments as paid.");
  return db.$transaction(async (tx) => {
    const p = await tx.payment.findUnique({ where: { id: paymentId }, include: { vendor: { select: { companyName: true } }, worker: { select: { name: true, userId: true } }, event: { select: { name: true } } } });
    if (!p || p.direction !== "OUT") throw new NotFoundError("That payment");
    if (p.status !== "APPROVED") throw new ConflictError(p.status === "PENDING_APPROVAL" ? "A host has to approve this payment first." : "This payment is not waiting to be paid.");
    await assertBookingOpen(tx, p.eventId);
    await tx.payment.update({ where: { id: p.id }, data: { status: "PAID", method: v.method, reference: v.reference || null, paidOn: new Date(`${v.paidOn}T00:00:00Z`), paidById: actor.userId } });
    await syncInvoiceStatus(tx, p.vendorInvoiceId);
    const party = p.vendor?.companyName ?? p.worker?.name ?? p.partyName ?? "payee";
    const body = `${p.event?.name ?? ""}${v.reference ? ` · ref ${v.reference}` : ""}`;
    if (p.vendorId) await notify(tx, await vendorUserIds(tx, p.vendorId), { type: "payment.paid", title: `Payment sent: ${formatINR(p.amount)}`, body, link: "/vendor", entityType: "payment", entityId: p.id });
    if (p.worker?.userId) await notify(tx, [p.worker.userId], { type: "payment.paid", title: `Paid: ${formatINR(p.amount)}`, body, link: "/crew", entityType: "payment", entityId: p.id });
    await recordAudit(tx, actor, { action: "pay", entityType: "payment", entityId: p.id, summary: `Paid ${formatINR(p.amount)} to ${party} by ${v.method.toLowerCase()}${v.reference ? ` (${v.reference})` : ""}`, financial: true }, meta);
  });
}

export async function voidPayment(db: Db, actor: Actor, paymentId: string, reason: string, meta: RequestMeta = {}) {
  const why = reason.trim();
  if (!why) throw new ValidationError("Write why the payment is void.", { reason: "A reason is needed." });
  staff(actor);
  if (!actor.isOwner) assertCan(actor, "payments.markPaid", "You can't void payments.");
  return db.$transaction(async (tx) => {
    const p = await tx.payment.findUnique({ where: { id: paymentId }, include: { vendor: { select: { companyName: true } }, worker: { select: { name: true } }, client: { select: { name: true } } } });
    if (!p) throw new NotFoundError("That payment");
    if (p.status === "VOIDED" || p.status === "REJECTED") throw new ConflictError("This payment is already closed.");
    await assertBookingOpen(tx, p.eventId);
    await tx.payment.update({ where: { id: p.id }, data: { status: "VOIDED", voidReason: why, voidedById: actor.userId, voidedAt: new Date() } });
    await tx.approvalRequest.updateMany({ where: { type: "PAYMENT", entityId: p.id, state: "PENDING" }, data: { state: "CANCELLED", decidedAt: new Date(), comment: `Voided: ${why}` } });
    await syncInvoiceStatus(tx, p.vendorInvoiceId);
    const party = p.vendor?.companyName ?? p.worker?.name ?? p.client?.name ?? p.partyName ?? "payee";
    await recordAudit(tx, actor, { action: "void", entityType: "payment", entityId: p.id, summary: `Voided ${p.direction === "IN" ? "receipt" : "payment"} ${formatINR(p.amount)} (${party}) · ${why}`, financial: true }, meta);
  });
}

// ───────────────────────────── Client money ─────────────────────────────

export const receiptSchema = z.object({
  eventId: z.string().uuid(),
  amount: money,
  /** Income tax the client deducted at source (corporate clients often deduct 1–2%). */
  tdsAmount: z.union([z.literal(""), z.coerce.number().min(0, "TDS can't be negative.").max(10_000_000)]).optional(),
  method: z.enum(METHODS),
  reference: z.string().trim().max(80).optional(),
  paidOn: date,
  note: z.string().trim().max(300).optional(),
});

export async function recordReceipt(db: Db, actor: Actor, input: z.input<typeof receiptSchema>, meta: RequestMeta = {}) {
  const v = parseInput(receiptSchema, input);
  if (v.paidOn > todayInIndia()) throw new ValidationError("The date is in the future.", { paidOn: "Pick today or earlier." });
  const tds = v.tdsAmount === "" || v.tdsAmount === undefined ? 0 : round2(v.tdsAmount);
  if (tds > v.amount * 0.25) throw new ValidationError("TDS looks too high for this payment.", { tdsAmount: "Check the TDS amount." });
  staff(actor);
  assertCan(actor, "payments.recordIn", "You can't record client payments.");
  return db.$transaction(async (tx) => {
    const ev = await tx.event.findUnique({ where: { id: v.eventId }, select: { name: true, clientId: true, client: { select: { name: true } } } });
    if (!ev) throw new NotFoundError("That booking");
    await assertBookingOpen(tx, v.eventId);
    const p = await tx.payment.create({
      data: { direction: "IN", eventId: v.eventId, partyType: "CLIENT", clientId: ev.clientId, amount: v.amount, tdsAmount: tds, method: v.method, reference: v.reference || null, paidOn: new Date(`${v.paidOn}T00:00:00Z`), note: v.note || null, status: "PAID", requestedById: actor.userId, paidById: actor.userId },
    });
    await notify(tx, await ownerUserIds(tx), { type: "payment.received", title: `Received ${formatINR(v.amount)} from ${ev.client.name}`, body: ev.name, link: `/bookings/${v.eventId}?tab=money`, entityType: "payment", entityId: p.id }, { exceptUserId: actor.userId });
    await recordAudit(tx, actor, { action: "receive", entityType: "payment", entityId: p.id, summary: `Received ${formatINR(v.amount)}${tds ? ` (+ TDS ${formatINR(tds, { decimals: true })})` : ""} from ${ev.client.name} for ${ev.name} by ${v.method.toLowerCase()}`, financial: true }, meta);
    return { id: p.id };
  });
}

export const chargeSchema = z.object({
  eventId: z.string().uuid(),
  description: z.string().trim().min(2, "Describe the charge, e.g. Wedding package.").max(160),
  amount: money,
  gstRate: z.coerce.number().refine((n) => [0, 5, 12, 18, 28].includes(n), "Pick a GST rate."),
  sacCode: z.string().trim().max(10).optional(),
});

export async function addCharge(db: Db, actor: Actor, input: z.input<typeof chargeSchema>, meta: RequestMeta = {}) {
  const v = parseInput(chargeSchema, input);
  staff(actor);
  assertCan(actor, "finance.billing", "Only hosts and the accountant set what the client is charged.");
  return db.$transaction(async (tx) => {
    const ev = await tx.event.findUnique({ where: { id: v.eventId }, select: { name: true, clientId: true, status: true } });
    if (!ev) throw new NotFoundError("That booking");
    await assertBookingOpen(tx, v.eventId);
    const c = await tx.clientCharge.create({ data: { eventId: v.eventId, clientId: ev.clientId, description: v.description, amount: v.amount, gstRate: v.gstRate, sacCode: v.sacCode || "998596", createdById: actor.userId } });
    await recordAudit(tx, actor, { action: "create", entityType: "client_charge", entityId: c.id, summary: `Charge on ${ev.name}: ${v.description} ${formatINR(v.amount)} + GST ${v.gstRate}%`, financial: true }, meta);
    return { id: c.id };
  });
}

export async function removeCharge(db: Db, actor: Actor, chargeId: string, meta: RequestMeta = {}) {
  staff(actor);
  assertCan(actor, "finance.billing", "Only hosts and the accountant change client charges.");
  return db.$transaction(async (tx) => {
    const c = await tx.clientCharge.findUnique({ where: { id: chargeId }, include: { event: { select: { name: true, status: true } } } });
    if (!c) throw new NotFoundError("That charge");
    await assertBookingOpen(tx, c.eventId);
    if (await tx.clientInvoiceItem.count({ where: { chargeId: c.id } })) throw new ConflictError("This charge is on a client invoice, so it stays. Add a new charge for any change.");
    await tx.clientCharge.delete({ where: { id: c.id } });
    await recordAudit(tx, actor, { action: "delete", entityType: "client_charge", entityId: c.id, summary: `Removed charge on ${c.event.name}: ${c.description} ${formatINR(c.amount)}`, financial: true }, meta);
  });
}

// ───────────────────────────── Crew extras and deductions ─────────────────────────────

export const adjustmentSchema = z.object({ assignmentId: z.string().uuid(), type: z.enum(["EXTRA", "DEDUCTION"]), amount: money.refine((n) => n <= 100_000, "That is too large for one extra."), reason: z.string().trim().min(3, "Say why, e.g. Late night after the Sangeet.").max(200) });

/** The supervisor or manager asks for an extra (or a deduction) on a crew member's pay; an owner decides. */
export async function requestAdjustment(db: Db, actor: Actor, input: z.input<typeof adjustmentSchema>, meta: RequestMeta = {}) {
  const v = parseInput(adjustmentSchema, input);
  staff(actor);
  return db.$transaction(async (tx) => {
    const a = await tx.crewAssignment.findUnique({ where: { id: v.assignmentId }, include: { worker: { select: { name: true } }, event: { select: { name: true } } } });
    if (!a) throw new NotFoundError("That crew booking");
    // The people running the booking: anyone who hires crew on it or runs its event day.
    const permission = actor.grants.has("crew.assign") ? "crew.assign" : "eventDay.run";
    assertCan(actor, permission, "You can't ask for crew extras.");
    await assertEventAccess(tx, actor, a.eventId, permission);
    if (!["CONFIRMED", "COMPLETED"].includes(a.status)) throw new ConflictError("Extras are for crew who are on the booking.");
    await assertBookingOpen(tx, a.eventId);
    const adj = await tx.crewPayAdjustment.create({ data: { assignmentId: a.id, type: v.type, amount: v.amount, reason: v.reason, requestedById: actor.userId } });
    const summary = `${a.worker.name} · ${v.type === "EXTRA" ? "extra" : "deduction"} · ${v.reason}`;
    await tx.approvalRequest.create({ data: { type: "CREW_ADJUSTMENT", entityId: adj.id, eventId: a.eventId, amount: v.amount, summary, requestedById: actor.userId } });
    await notify(tx, await ownerUserIds(tx), { type: "approval.requested", title: `Crew ${v.type === "EXTRA" ? "extra" : "deduction"} to approve: ${formatINR(v.amount)}`, body: `${summary} (${a.event.name})`, link: "/approvals", entityType: "crew_adjustment", entityId: adj.id }, { exceptUserId: actor.userId });
    await recordAudit(tx, actor, { action: "create", entityType: "crew_adjustment", entityId: adj.id, summary: `Asked for ${v.type === "EXTRA" ? "an extra" : "a deduction"} of ${formatINR(v.amount)} for ${a.worker.name} (${a.event.name}) · ${v.reason}`, financial: true }, meta);
    return { id: adj.id };
  });
}
