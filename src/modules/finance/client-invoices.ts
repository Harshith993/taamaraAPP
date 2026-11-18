/**
 * GST tax invoices to clients (Phase 7). Behind an owner switch, off by default, until the owners
 * answer open question 2 (does the app issue client invoices, or does the accountant elsewhere?).
 *
 *   DRAFT ──(issue: number, date, tax split, seller/buyer details frozen)──▶ ISSUED ──▶ CANCELLED
 *     │                                                                     (with a reason)
 *     └── deleted while still a draft
 *
 * - Lines come from the booking's client charges. A charge can be split over several invoices
 *   (an advance and the balance) but never billed twice: drafts and issued invoices reserve it.
 * - Numbers are gap-free per financial year (src/lib/numbering.ts): PREFIX-26-27-0001, at most
 *   16 characters as GST requires. Invoice dates never go backwards within a year.
 * - Place of supply (event services, IGST Act s.12(7)): a registered client's state from their
 *   GSTIN; otherwise the client's state, or the company's state when unknown. Same state as the
 *   company: CGST + SGST; otherwise IGST.
 * - Issued invoices can't be edited or deleted (database triggers). Cancel only before the invoice
 *   is filed in GSTR-1; after that the accountant issues a credit note (not built yet).
 * - People with invoices.client (owners, the accountant) draft, issue and cancel; people who see
 *   client billing can view and print.
 */
import { z } from "zod";
import type { Db, DbTx } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatINR, todayInIndia, toNumber } from "@/lib/format";
import { fyCode, GST_STATES, isValidGstin, normalizeGstin, rupeesInWords, splitTax, stateCodeOf, stateName } from "@/lib/gst";
import { nextDocumentNumber } from "@/lib/numbering";
import { parseInput } from "@/lib/validate";
import { recordAudit, type RequestMeta } from "@/modules/audit/audit";
import { assertBookingOpen } from "@/modules/events/lock";
import type { Actor } from "@/modules/identity/actor";
import { assertCan, assertEventAccess, can } from "@/modules/identity/policy";
import { notify, ownerUserIds } from "@/modules/notifications/notify";
import { readCompany, type CompanyDetails } from "@/modules/settings/company";
import { round2 } from "./figures";

/** B2C invoices above this need the client's address (GST rule for unregistered recipients). */
const ADDRESS_NEEDED_ABOVE = 50_000;
const DEFAULT_SAC = "998596"; // Event, exhibition and conference organisation services

export const OFF_MESSAGE = "Client invoices are switched off. An owner can turn them on in Settings.";

function assertInvoicing(actor: Actor) {
  if (actor.accountType !== "INTERNAL") throw new ForbiddenError();
  assertCan(actor, "invoices.client", "Only owners and the accountant make client invoices.");
  if (!actor.switches.clientInvoices) throw new ConflictError(OFF_MESSAGE);
}

export interface PartyDetails {
  name: string;
  gstin: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  stateCode: string | null;
  pan?: string | null;
  phone?: string | null;
  email?: string | null;
}

function supplierOf(c: CompanyDetails): PartyDetails {
  return { name: c.legalName, gstin: c.gstin, pan: c.pan, address: c.address, city: c.city, state: c.state, stateCode: c.stateCode, phone: c.phone, email: c.email };
}

type ClientRow = { name: string; gstin: string | null; address: string | null; city: string | null; state: string | null };

function recipientOf(c: ClientRow): PartyDetails {
  const code = c.gstin ? c.gstin.slice(0, 2) : stateCodeOf(c.state);
  return { name: c.name, gstin: c.gstin, address: c.address, city: c.city, state: stateName(code) ?? c.state, stateCode: code };
}

export function placeOfSupply(client: ClientRow, company: Pick<CompanyDetails, "stateCode">): string | null {
  return recipientOf(client).stateCode ?? company.stateCode;
}

function totals(items: { amount: number; gstRate: number }[], intraState: boolean) {
  let subtotal = 0,
    cgst = 0,
    sgst = 0,
    igst = 0;
  for (const i of items) {
    const t = splitTax(i.amount, i.gstRate, intraState);
    subtotal += i.amount;
    cgst += t.cgst;
    sgst += t.sgst;
    igst += t.igst;
  }
  const r = { subtotal: round2(subtotal), cgst: round2(cgst), sgst: round2(sgst), igst: round2(igst) };
  return { ...r, total: round2(r.subtotal + r.cgst + r.sgst + r.igst) };
}

/** Each charge on the booking with how much of it is already on live invoices (drafts included). */
async function chargeBalances(tx: DbTx, eventId: string, exceptInvoiceId?: string) {
  const charges = await tx.clientCharge.findMany({
    where: { eventId },
    orderBy: { createdAt: "asc" },
    include: { invoiceItems: { where: { invoice: { status: { not: "CANCELLED" }, ...(exceptInvoiceId ? { id: { not: exceptInvoiceId } } : {}) } }, select: { amount: true } } },
  });
  return charges.map((c) => {
    const invoiced = round2(c.invoiceItems.reduce((s, i) => s + toNumber(i.amount), 0));
    return { id: c.id, description: c.description, sacCode: c.sacCode, amount: toNumber(c.amount), gstRate: toNumber(c.gstRate), invoiced, left: round2(toNumber(c.amount) - invoiced) };
  });
}

// ───────────────────────────── Client billing details ─────────────────────────────

export const clientBillingSchema = z.object({
  gstin: z.string().trim().max(20).optional(),
  address: z.string().trim().max(300).optional(),
  city: z.string().trim().max(60).optional(),
  stateCode: z.string().refine((s) => s === "" || s in GST_STATES, "Pick the state.").optional(),
});

/** The client's GSTIN and address as they should appear on invoices. */
export async function updateClientBilling(db: Db, actor: Actor, eventId: string, input: z.input<typeof clientBillingSchema>, meta: RequestMeta = {}) {
  const v = parseInput(clientBillingSchema, input);
  if (actor.accountType !== "INTERNAL") throw new ForbiddenError();
  assertCan(actor, "invoices.client", "Only owners and the accountant change billing details.");
  const gstin = normalizeGstin(v.gstin) || null;
  if (gstin && !isValidGstin(gstin)) throw new ValidationError("That GSTIN doesn't look right. Check it with the client.", { gstin: "Check the GSTIN (15 characters)." });
  const code = gstin ? gstin.slice(0, 2) : v.stateCode || null;
  return db.$transaction(async (tx) => {
    const ev = await tx.event.findUnique({ where: { id: eventId }, select: { client: { select: { id: true, name: true, gstin: true, address: true, city: true, state: true } } } });
    if (!ev) throw new NotFoundError("That booking");
    const data = { gstin, address: v.address || null, city: v.city || null, state: stateName(code) };
    await tx.client.update({ where: { id: ev.client.id }, data });
    await recordAudit(tx, actor, { action: "update", entityType: "client", entityId: ev.client.id, summary: `Billing details of ${ev.client.name}: ${gstin ? `GSTIN ${gstin}` : "no GSTIN"}, ${data.state ?? "state not set"}`, financial: true, before: { gstin: ev.client.gstin, address: ev.client.address, city: ev.client.city, state: ev.client.state }, after: data }, meta);
  });
}

// ───────────────────────────── Drafting ─────────────────────────────

export const draftSchema = z.object({
  eventId: z.string().uuid(),
  type: z.enum(["ADVANCE", "FINAL", "ADDITIONAL"]).default("FINAL"),
  lines: z
    .array(z.object({ chargeId: z.string().uuid(), amount: z.coerce.number({ message: "Enter an amount." }).positive("Each line must be more than ₹0.") }))
    .min(1, "Pick at least one charge to bill."),
  dueDate: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(),
  notes: z.string().trim().max(500).optional(),
});
export type DraftInput = z.input<typeof draftSchema>;

export async function draftInvoice(db: Db, actor: Actor, input: DraftInput, meta: RequestMeta = {}) {
  const v = parseInput(draftSchema, input);
  assertInvoicing(actor);
  if (new Set(v.lines.map((l) => l.chargeId)).size !== v.lines.length) throw new ValidationError("Each charge can be on the invoice once.");
  return db.$transaction(async (tx) => {
    await assertEventAccess(tx, actor, v.eventId, "invoices.client");
    await assertBookingOpen(tx, v.eventId);
    // One query at a time inside the transaction.
    const ev = await tx.event.findUniqueOrThrow({ where: { id: v.eventId }, select: { name: true, clientId: true, client: { select: { name: true, gstin: true, address: true, city: true, state: true } } } });
    const company = await readCompany(tx);
    const balances = await chargeBalances(tx, v.eventId);
    const items = v.lines.map((l, i) => {
      const c = balances.find((b) => b.id === l.chargeId);
      if (!c) throw new ValidationError("Pick charges from this booking.");
      const amount = round2(l.amount);
      if (amount > c.left + 0.005) throw new ConflictError(`"${c.description}" has ${formatINR(c.left, { decimals: true })} left to bill.`);
      const part = amount < c.amount - 0.005;
      return { chargeId: c.id, description: part ? `${c.description} (${v.type === "ADVANCE" ? "advance" : "part"})` : c.description, sacCode: c.sacCode || DEFAULT_SAC, quantity: 1, rate: amount, amount, gstRate: c.gstRate, sortOrder: i };
    });
    const pos = placeOfSupply(ev.client, company);
    const t = totals(items, pos === company.stateCode);
    const inv = await tx.clientInvoice.create({
      data: { eventId: v.eventId, clientId: ev.clientId, type: v.type, status: "DRAFT", placeOfSupply: pos, dueDate: v.dueDate ? new Date(`${v.dueDate}T00:00:00Z`) : null, notes: v.notes || null, ...t, createdById: actor.userId, items: { create: items } },
    });
    await recordAudit(tx, actor, { action: "create", entityType: "client_invoice", entityId: inv.id, summary: `Drafted ${v.type.toLowerCase()} invoice for ${ev.client.name} (${ev.name}): ${formatINR(t.total, { decimals: true })}`, financial: true }, meta);
    return { id: inv.id };
  });
}

export async function deleteDraft(db: Db, actor: Actor, invoiceId: string, meta: RequestMeta = {}) {
  assertInvoicing(actor);
  return db.$transaction(async (tx) => {
    const inv = await tx.clientInvoice.findUnique({ where: { id: invoiceId }, select: { status: true, eventId: true, total: true, client: { select: { name: true } } } });
    if (!inv) throw new NotFoundError("That invoice");
    await assertEventAccess(tx, actor, inv.eventId, "invoices.client");
    if (inv.status !== "DRAFT") throw new ConflictError("Only drafts can be deleted. Cancel an issued invoice instead.");
    await tx.clientInvoice.delete({ where: { id: invoiceId } });
    await recordAudit(tx, actor, { action: "delete", entityType: "client_invoice", entityId: invoiceId, summary: `Deleted draft invoice for ${inv.client.name} (${formatINR(inv.total, { decimals: true })})`, financial: true }, meta);
  });
}

// ───────────────────────────── Issuing and cancelling ─────────────────────────────

export const issueSchema = z.object({ issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the invoice date.") });

export async function issueInvoice(db: Db, actor: Actor, invoiceId: string, input: z.input<typeof issueSchema>, meta: RequestMeta = {}) {
  const v = parseInput(issueSchema, input);
  assertInvoicing(actor);
  if (v.issueDate > todayInIndia()) throw new ValidationError("The invoice date is in the future.", { issueDate: "Pick today or earlier." });
  return db.$transaction(async (tx) => {
    const inv = await tx.clientInvoice.findUnique({ where: { id: invoiceId }, include: { items: { orderBy: { sortOrder: "asc" } }, event: { select: { name: true } }, client: { select: { name: true, gstin: true, address: true, city: true, state: true } } } });
    if (!inv) throw new NotFoundError("That invoice");
    await assertEventAccess(tx, actor, inv.eventId, "invoices.client");
    await assertBookingOpen(tx, inv.eventId);
    if (inv.status !== "DRAFT") throw new ConflictError("This invoice is already issued.");
    const company = await readCompany(tx);
    if (!company.gstin || !company.address || !company.stateCode) throw new ConflictError("Add the company's GSTIN and address in Settings before issuing invoices.");
    const recipient = recipientOf(inv.client);
    const pos = placeOfSupply(inv.client, company)!;
    const items = inv.items.map((i) => ({ amount: toNumber(i.amount), gstRate: toNumber(i.gstRate) }));
    const t = totals(items, pos === company.stateCode);
    if ((recipient.gstin || t.total > ADDRESS_NEEDED_ABOVE) && !recipient.address) throw new ConflictError(`Add ${inv.client.name}'s billing address first (needed for ${recipient.gstin ? "a registered client" : `invoices above ${formatINR(ADDRESS_NEEDED_ABOVE)}`}).`);
    // Invoice dates never go backwards within the year's numbering.
    const fy = fyCode(v.issueDate);
    const last = await tx.clientInvoice.findFirst({ where: { financialYear: fy, status: { not: "DRAFT" } }, orderBy: { issueDate: "desc" }, select: { issueDate: true, number: true } });
    if (last?.issueDate && v.issueDate < last.issueDate.toISOString().slice(0, 10)) throw new ValidationError(`Invoice ${last.number} is dated ${last.issueDate.toISOString().slice(0, 10)}; this one can't be earlier.`, { issueDate: "Pick that date or later." });
    const number = await nextDocumentNumber(tx, "CLIENT_INVOICE", fy, company.invoicePrefix);
    await tx.clientInvoice.update({
      where: { id: inv.id },
      data: { status: "ISSUED", number, financialYear: fy, issueDate: new Date(`${v.issueDate}T00:00:00Z`), placeOfSupply: pos, supplier: { ...supplierOf(company) }, recipient: { ...recipient }, ...t },
    });
    await recordAudit(tx, actor, { action: "issue", entityType: "client_invoice", entityId: inv.id, summary: `Issued invoice ${number} to ${inv.client.name} (${inv.event.name}): ${formatINR(t.total, { decimals: true })}${t.igst ? " IGST" : " CGST+SGST"}`, financial: true }, meta);
    await notify(tx, await ownerUserIds(tx), { type: "invoice.issued", title: `Invoice ${number} issued: ${formatINR(t.total)}`, body: `${inv.client.name} · ${inv.event.name}`, link: `/invoices/client/${inv.id}`, entityType: "client_invoice", entityId: inv.id }, { exceptUserId: actor.userId });
    return { number };
  });
}

export async function cancelInvoice(db: Db, actor: Actor, invoiceId: string, reason: string, meta: RequestMeta = {}) {
  const why = reason.trim();
  if (why.length < 5) throw new ValidationError("Say why it is cancelled.", { reason: "A reason is needed." });
  assertInvoicing(actor);
  return db.$transaction(async (tx) => {
    const inv = await tx.clientInvoice.findUnique({ where: { id: invoiceId }, select: { status: true, number: true, eventId: true, total: true, client: { select: { name: true } } } });
    if (!inv) throw new NotFoundError("That invoice");
    await assertEventAccess(tx, actor, inv.eventId, "invoices.client");
    await assertBookingOpen(tx, inv.eventId);
    if (inv.status === "DRAFT") throw new ConflictError("Delete a draft instead.");
    if (inv.status === "CANCELLED") throw new ConflictError("This invoice is already cancelled.");
    await tx.clientInvoice.update({ where: { id: invoiceId }, data: { status: "CANCELLED", cancelReason: why } });
    await recordAudit(tx, actor, { action: "cancel", entityType: "client_invoice", entityId: invoiceId, summary: `Cancelled invoice ${inv.number} to ${inv.client.name} (${formatINR(inv.total, { decimals: true })}) · ${why}`, financial: true }, meta);
    await notify(tx, await ownerUserIds(tx), { type: "invoice.cancelled", title: `Invoice ${inv.number} cancelled`, body: why, link: `/invoices/client/${invoiceId}`, entityType: "client_invoice", entityId: invoiceId }, { exceptUserId: actor.userId });
  });
}

// ───────────────────────────── Reading ─────────────────────────────

/** The invoices panel on a booking's Money tab, or null when switched off or not allowed. */
export async function bookingInvoices(db: Db, actor: Actor, eventId: string) {
  if (actor.accountType !== "INTERNAL" || !actor.switches.clientInvoices || !can(actor, "finance.billing")) return null;
  const [ev, invoices, balances, company] = await Promise.all([
    db.event.findUnique({ where: { id: eventId }, select: { status: true, client: { select: { name: true, gstin: true, address: true, city: true, state: true } } } }),
    db.clientInvoice.findMany({ where: { eventId }, orderBy: { createdAt: "asc" }, include: { items: { orderBy: { sortOrder: "asc" }, select: { description: true, amount: true, gstRate: true } } } }),
    chargeBalances(db, eventId),
    readCompany(db),
  ]);
  if (!ev) return null;
  const pos = placeOfSupply(ev.client, company);
  return {
    manages: can(actor, "invoices.client"),
    companyReady: Boolean(company.gstin && company.address && company.stateCode),
    client: { ...recipientOf(ev.client), placeOfSupply: pos, placeName: stateName(pos), interState: Boolean(pos && company.stateCode && pos !== company.stateCode) },
    charges: balances,
    invoices: invoices.map((i) => ({
      id: i.id,
      number: i.number,
      type: i.type,
      status: i.status,
      issueDate: i.issueDate,
      subtotal: toNumber(i.subtotal),
      tax: round2(toNumber(i.cgst) + toNumber(i.sgst) + toNumber(i.igst)),
      total: toNumber(i.total),
      cancelReason: i.cancelReason,
      lines: i.items.map((x) => ({ description: x.description, amount: toNumber(x.amount), gstRate: toNumber(x.gstRate) })),
    })),
  };
}

export type BookingInvoices = NonNullable<Awaited<ReturnType<typeof bookingInvoices>>>;

/** One invoice, laid out for printing (or saving as PDF from the browser). */
export async function invoiceForPrint(db: Db, actor: Actor, invoiceId: string) {
  if (actor.accountType !== "INTERNAL" || !can(actor, "finance.billing")) throw new ForbiddenError("Only owners and the accountant see client invoices.");
  const inv = await db.clientInvoice.findUnique({ where: { id: invoiceId }, include: { items: { orderBy: { sortOrder: "asc" } }, event: { select: { id: true, code: true, name: true, startDate: true } }, client: { select: { name: true, gstin: true, address: true, city: true, state: true } } } });
  if (!inv) throw new NotFoundError("That invoice");
  await assertEventAccess(db, actor, inv.eventId, "finance.billing");
  const company = await readCompany(db);
  // Drafts show today's details; issued invoices show what they were issued with.
  const supplier = (inv.supplier as PartyDetails | null) ?? supplierOf(company);
  const recipient = (inv.recipient as PartyDetails | null) ?? recipientOf(inv.client);
  const intra = toNumber(inv.igst) === 0;
  const lines = inv.items.map((i) => {
    const amount = toNumber(i.amount);
    const rate = toNumber(i.gstRate);
    return { description: i.description, sac: i.sacCode ?? DEFAULT_SAC, quantity: toNumber(i.quantity), rate: toNumber(i.rate), amount, gstRate: rate, ...splitTax(amount, rate, intra) };
  });
  const byRate = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number }>();
  for (const l of lines) {
    const r = byRate.get(l.gstRate) ?? { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    r.taxable = round2(r.taxable + l.amount);
    r.cgst = round2(r.cgst + l.cgst);
    r.sgst = round2(r.sgst + l.sgst);
    r.igst = round2(r.igst + l.igst);
    byRate.set(l.gstRate, r);
  }
  const total = toNumber(inv.total);
  return {
    id: inv.id,
    number: inv.number,
    status: inv.status,
    type: inv.type,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    placeOfSupply: inv.placeOfSupply,
    placeName: stateName(inv.placeOfSupply),
    intraState: intra,
    supplier,
    tradeName: company.tradeName,
    bankDetails: company.bankDetails,
    recipient,
    event: inv.event,
    notes: inv.notes,
    cancelReason: inv.cancelReason,
    lines,
    taxByRate: [...byRate.entries()].map(([rate, t]) => ({ rate, ...t })),
    subtotal: toNumber(inv.subtotal),
    cgst: toNumber(inv.cgst),
    sgst: toNumber(inv.sgst),
    igst: toNumber(inv.igst),
    total,
    inWords: rupeesInWords(total),
  };
}
