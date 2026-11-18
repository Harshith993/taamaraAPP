/**
 * Vendor invoices against a work order.
 *
 *   vendor sends (number, date, taxable + GST, the invoice file) ──▶ SUBMITTED
 *   accountant checks it against the work order and the approved proof ──▶ VERIFIED  (ready to pay, Phase 7)
 *                                                       or asks the vendor to correct it ──▶ DISPUTED
 *   an invoice entered by mistake is voided with a reason ──▶ VOID (never deleted, G5)
 *
 *  - Vendors send invoices only for their own jobs, once the work order is accepted.
 *  - Staff with quotes.submit (the accountant) can enter a paper invoice on the vendor's behalf.
 *  - Invoices on a work order can't add up to more than its amount; disputed and void ones don't count.
 *  - Checking needs payments.prepare (accountant, owners).
 */
import { z } from "zod";
import type { Db, DbTx } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatINR, todayInIndia, toNumber } from "@/lib/format";
import { parseInput } from "@/lib/validate";
import { recordAudit, type RequestMeta } from "@/modules/audit/audit";
import { MEDIA_SELECT, mediaView } from "@/modules/files/media";
import type { Actor } from "@/modules/identity/actor";
import { assertCan, assertEventAccess, can } from "@/modules/identity/policy";
import { notify, ownerUserIds, vendorUserIds } from "@/modules/notifications/notify";

/** Invoices that count against the work order's amount. */
const LIVE = ["SUBMITTED", "VERIFIED", "APPROVED", "PART_PAID", "PAID"] as const;

const money = z.coerce.number({ message: "Enter an amount." }).min(0, "Can't be negative.").max(100_000_000, "That amount is too large.");

export const submitInvoiceSchema = z.object({
  invoiceNumber: z.string().trim().min(1, "Enter your invoice number.").max(40),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the invoice date."),
  taxableAmount: money.refine((n) => n > 0, "Enter the amount before GST."),
  gstAmount: money,
  fileId: z.string().uuid("Attach the invoice (PDF or a photo)."),
});
export type SubmitInvoiceInput = z.input<typeof submitInvoiceSchema>;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Who in the office hears about a new invoice: the accountant(s) and the owners. */
async function financeUserIds(tx: DbTx): Promise<string[]> {
  const rows = await tx.user.findMany({
    where: { status: "ACTIVE", accountType: "INTERNAL", roles: { some: { role: { OR: [{ isOwner: true }, { key: "ACCOUNTANT" }] } } } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function workOrderBalance(tx: DbTx, workOrderId: string, exceptInvoiceId?: string) {
  const wo = await tx.workOrder.findUniqueOrThrow({ where: { id: workOrderId }, select: { amount: true } });
  const billed = await tx.vendorInvoice.aggregate({ where: { workOrderId, status: { in: [...LIVE] }, ...(exceptInvoiceId ? { id: { not: exceptInvoiceId } } : {}) }, _sum: { total: true } });
  const amount = toNumber(wo.amount);
  const invoiced = toNumber(billed._sum.total);
  return { amount, invoiced, left: round2(amount - invoiced) };
}

export async function submitInvoice(db: Db, actor: Actor, assignmentId: string, input: SubmitInvoiceInput, meta: RequestMeta = {}) {
  const v = parseInput(submitInvoiceSchema, input);
  if (v.invoiceDate > todayInIndia()) throw new ValidationError("The invoice date is in the future.", { invoiceDate: "Pick today or an earlier date." });
  const total = round2(v.taxableAmount + v.gstAmount);
  if (v.gstAmount > v.taxableAmount * 0.28 + 0.01) throw new ValidationError("GST looks too high for this amount (more than 28%).", { gstAmount: "Check the GST amount." });

  return db.$transaction(async (tx) => {
    assertCan(actor, "quotes.submit", "You can't send invoices.");
    const job = await tx.vendorAssignment.findUnique({ where: { id: assignmentId }, include: { vendor: { select: { id: true, companyName: true } }, event: { select: { id: true, name: true } } } });
    if (!job) throw new NotFoundError("That job");
    if (actor.accountType === "VENDOR") {
      if (!actor.vendorIds.includes(job.vendorId)) throw new NotFoundError("That job");
    } else if (actor.accountType === "INTERNAL") {
      await assertEventAccess(tx, actor, job.eventId, "quotes.submit");
    } else throw new NotFoundError("That job");
    if (!["ACCEPTED", "IN_PROGRESS", "DELIVERED", "COMPLETED"].includes(job.status)) throw new ConflictError("Invoices can be sent once the work order is accepted.");
    const wo = await tx.workOrder.findFirst({ where: { assignmentId: job.id, status: { in: ["ACKNOWLEDGED", "CLOSED"] } }, orderBy: { issuedAt: "desc" } });
    if (!wo) throw new ConflictError("There is no accepted work order on this job.");

    const file = await tx.file.findFirst({ where: { id: v.fileId, uploadedById: actor.userId, purpose: "DOCUMENT", status: "READY" }, select: { id: true, _count: { select: { vendorInvoices: true } } } });
    if (!file) throw new ValidationError("Attach the invoice (PDF or a photo) and wait for it to finish uploading.", { fileId: "Attach the invoice." });
    if (file._count.vendorInvoices) throw new ConflictError("That file is already attached to another invoice.");

    const balance = await workOrderBalance(tx, wo.id);
    if (total > balance.left + 0.5) {
      throw new ConflictError(`This invoice (${formatINR(total)}) is more than what is left on ${wo.number} (${formatINR(Math.max(0, balance.left))} of ${formatINR(balance.amount)}). Please talk to the manager.`);
    }
    const dup = await tx.vendorInvoice.count({ where: { vendorId: job.vendorId, invoiceNumber: v.invoiceNumber } });
    if (dup) throw new ConflictError(`Invoice ${v.invoiceNumber} has already been sent. Use your next invoice number.`);

    const invoice = await tx.vendorInvoice.create({
      data: {
        vendorId: job.vendorId,
        workOrderId: wo.id,
        invoiceNumber: v.invoiceNumber,
        invoiceDate: new Date(`${v.invoiceDate}T00:00:00Z`),
        taxableAmount: v.taxableAmount,
        gstAmount: v.gstAmount,
        total,
        fileId: file.id,
        submittedById: actor.userId,
      },
    });
    await notify(
      tx,
      await financeUserIds(tx),
      { type: "invoice.received", title: `Invoice to check: ${job.vendor.companyName} ${formatINR(total)}`, body: `${v.invoiceNumber} · ${wo.number} · ${job.event.name}`, link: "/invoices", entityType: "vendor_invoice", entityId: invoice.id },
      { exceptUserId: actor.userId },
    );
    await recordAudit(tx, actor, { action: "submit", entityType: "vendor_invoice", entityId: invoice.id, summary: `Invoice ${v.invoiceNumber} ${formatINR(total)} from ${job.vendor.companyName} against ${wo.number} (${job.event.name})`, financial: true }, meta);
    return { id: invoice.id, total };
  });
}

export const reviewInvoiceSchema = z.object({ decision: z.enum(["VERIFY", "DISPUTE", "VOID"]), note: z.string().trim().max(500).optional() });

/** The accountant (or an owner) checks an invoice: verified, disputed (vendor told why) or void. */
export async function reviewInvoice(db: Db, actor: Actor, invoiceId: string, input: z.input<typeof reviewInvoiceSchema>, meta: RequestMeta = {}) {
  const v = parseInput(reviewInvoiceSchema, input);
  if (v.decision !== "VERIFY" && !v.note) throw new ValidationError(v.decision === "DISPUTE" ? "Tell the vendor what to correct." : "Write why it is void.", { note: "A note is needed." });
  return db.$transaction(async (tx) => {
    if (actor.accountType !== "INTERNAL") throw new ForbiddenError("Only the office checks invoices.");
    assertCan(actor, "payments.prepare", "You can't check invoices.");
    const inv = await tx.vendorInvoice.findUnique({ where: { id: invoiceId }, include: { vendor: { select: { id: true, companyName: true } }, workOrder: { select: { id: true, number: true, assignmentId: true } } } });
    if (!inv) throw new NotFoundError("That invoice");
    const allowed: Record<string, string[]> = { VERIFY: ["SUBMITTED", "DISPUTED"], DISPUTE: ["SUBMITTED", "VERIFIED"], VOID: ["SUBMITTED", "VERIFIED", "DISPUTED"] };
    if (!allowed[v.decision].includes(inv.status)) throw new ConflictError(inv.status === "VOID" ? "This invoice is void." : `This invoice is already ${inv.status.toLowerCase().replace("_", " ")}.`);
    if (v.decision === "VERIFY" && inv.workOrderId) {
      // A disputed invoice coming back must still fit within the work order.
      const balance = await workOrderBalance(tx, inv.workOrderId, inv.id);
      if (toNumber(inv.total) > balance.left + 0.5) throw new ConflictError(`Verifying this would take ${inv.workOrder!.number} past its amount (${formatINR(balance.left)} left).`);
    }
    const status = v.decision === "VERIFY" ? "VERIFIED" : v.decision === "DISPUTE" ? "DISPUTED" : "VOID";
    await tx.vendorInvoice.update({ where: { id: inv.id }, data: { status, disputeNote: v.decision === "VERIFY" ? null : v.note } });
    const link = inv.workOrder ? `/vendor/jobs/${inv.workOrder.assignmentId}` : "/vendor";
    if (v.decision !== "VERIFY") {
      await notify(tx, await vendorUserIds(tx, inv.vendorId), {
        type: v.decision === "DISPUTE" ? "invoice.disputed" : "invoice.void",
        title: v.decision === "DISPUTE" ? `Please correct invoice ${inv.invoiceNumber}` : `Invoice ${inv.invoiceNumber} was cancelled`,
        body: v.note!,
        link,
        entityType: "vendor_invoice",
        entityId: inv.id,
      });
    } else {
      await notify(tx, await vendorUserIds(tx, inv.vendorId), { type: "invoice.verified", title: `Invoice ${inv.invoiceNumber} checked`, body: "It is now waiting for payment.", link, entityType: "vendor_invoice", entityId: inv.id });
      const owners = await ownerUserIds(tx);
      await notify(tx, owners, { type: "invoice.verified", title: `Ready to pay: ${inv.vendor.companyName} ${formatINR(inv.total)}`, body: `${inv.invoiceNumber}${inv.workOrder ? ` · ${inv.workOrder.number}` : ""}`, link: "/invoices?state=VERIFIED", entityType: "vendor_invoice", entityId: inv.id }, { exceptUserId: actor.userId });
    }
    await recordAudit(tx, actor, { action: v.decision.toLowerCase(), entityType: "vendor_invoice", entityId: inv.id, summary: `${status === "VERIFIED" ? "Verified" : status === "DISPUTED" ? "Disputed" : "Voided"} invoice ${inv.invoiceNumber} from ${inv.vendor.companyName} (${formatINR(inv.total)})${v.note ? ` · ${v.note}` : ""}`, financial: true }, meta);
    return { status };
  });
}

// ───────────────────────────── Reading ─────────────────────────────

const INVOICE_INCLUDE = {
  file: { select: MEDIA_SELECT },
  vendor: { select: { companyName: true, gstin: true } },
  workOrder: {
    select: {
      id: true,
      number: true,
      amount: true,
      assignment: {
        select: {
          id: true,
          scopeOfWork: true,
          status: true,
          event: { select: { id: true, name: true, code: true } },
          _count: { select: { proofs: { where: { status: "APPROVED" } } } },
        },
      },
    },
  },
} as const;

type InvoiceRow = Awaited<ReturnType<typeof loadRows>>[number];
function loadRows(db: DbTx, where: NonNullable<Parameters<DbTx["vendorInvoice"]["findMany"]>[0]>["where"], take = 200) {
  return db.vendorInvoice.findMany({ where, orderBy: [{ createdAt: "desc" }], take, include: INVOICE_INCLUDE });
}

function shape(actor: Actor, r: InvoiceRow, extras: { invoicedOnWO?: number } = {}) {
  return {
    id: r.id,
    number: r.invoiceNumber,
    date: r.invoiceDate,
    taxable: toNumber(r.taxableAmount),
    gst: toNumber(r.gstAmount),
    total: toNumber(r.total),
    status: r.status,
    note: r.disputeNote,
    createdAt: r.createdAt,
    vendor: r.vendor.companyName,
    vendorGstin: r.vendor.gstin,
    workOrder: r.workOrder ? { id: r.workOrder.id, number: r.workOrder.number, amount: toNumber(r.workOrder.amount), invoiced: extras.invoicedOnWO ?? null } : null,
    job: r.workOrder ? { id: r.workOrder.assignment.id, scope: r.workOrder.assignment.scopeOfWork, status: r.workOrder.assignment.status, approvedProof: r.workOrder.assignment._count.proofs } : null,
    event: r.workOrder?.assignment.event ?? null,
    file: r.file ? mediaView(actor.userId, r.file, { original: true }) : null,
  };
}
export type InvoiceItem = ReturnType<typeof shape>;

/** A vendor's own invoices for one job (or staff who may see quote amounts on the booking). */
export async function invoicesForJob(db: Db, actor: Actor, assignmentId: string): Promise<InvoiceItem[]> {
  if (actor.accountType === "VENDOR") {
    const job = await db.vendorAssignment.findFirst({ where: { id: assignmentId, vendorId: { in: actor.vendorIds } }, select: { id: true } });
    if (!job) return [];
  } else if (!can(actor, "quotes.view") && !can(actor, "payments.prepare")) return [];
  const rows = await loadRows(db, { workOrder: { assignmentId } });
  return rows.map((r) => shape(actor, r));
}

/** The office list (accountant, owners). */
export async function listInvoices(db: Db, actor: Actor, filter: { status?: string } = {}): Promise<InvoiceItem[]> {
  if (actor.accountType !== "INTERNAL" || !can(actor, "payments.prepare")) return [];
  const status = filter.status && filter.status !== "all" ? (filter.status as InvoiceRow["status"]) : undefined;
  const rows = await loadRows(db, status ? { status } : {});
  const woIds = [...new Set(rows.map((r) => r.workOrderId).filter((x): x is string => Boolean(x)))];
  const sums = woIds.length ? await db.vendorInvoice.groupBy({ by: ["workOrderId"], where: { workOrderId: { in: woIds }, status: { in: [...LIVE] } }, _sum: { total: true } }) : [];
  return rows.map((r) => shape(actor, r, { invoicedOnWO: toNumber(sums.find((s) => s.workOrderId === r.workOrderId)?._sum.total) }));
}

export async function invoicesToCheckCount(db: Db, actor: Actor): Promise<number> {
  if (actor.accountType !== "INTERNAL" || !can(actor, "payments.prepare")) return 0;
  return db.vendorInvoice.count({ where: { status: "SUBMITTED" } });
}
