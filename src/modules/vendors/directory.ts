/**
 * The vendor directory: who the company works with, by department.
 *
 *  - Everyone internal with vendors.view sees the directory (phone, city, departments, rating).
 *  - GSTIN, PAN and bank details only with vendors.bank (owners, the accountant; ARCHITECTURE §6).
 *  - Adding needs vendors.create (owners, managers ⚙); editing needs vendors.edit (owners).
 *  - Bank account numbers are encrypted (src/lib/crypto.ts); screens show the last four digits.
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";
import { encryptField, lastFour } from "@/lib/crypto";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { toNumber } from "@/lib/format";
import { normalizePhone } from "@/lib/phone";
import { parseInput } from "@/lib/validate";
import { recordAudit, type RequestMeta } from "@/modules/audit/audit";
import { notify } from "@/modules/notifications/notify";
import type { Actor } from "@/modules/identity/actor";
import { assertCan, can, eventWhere } from "@/modules/identity/policy";

export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

function staffOnly(actor: Actor) {
  if (actor.accountType !== "INTERNAL") throw new ForbiddenError("The vendor directory is for the team.");
}

export async function listVendors(db: Db, actor: Actor, filter: { q?: string; categoryId?: string; status?: string } = {}) {
  staffOnly(actor);
  assertCan(actor, "vendors.view");
  const where: Prisma.VendorWhereInput[] = [{ deletedAt: null }];
  const q = filter.q?.trim();
  if (q) where.push({ OR: [{ companyName: { contains: q, mode: "insensitive" } }, { contactName: { contains: q, mode: "insensitive" } }, { services: { contains: q, mode: "insensitive" } }, { phone: { contains: q.replace(/\D/g, "") || q } }] });
  if (filter.categoryId) where.push({ categories: { some: { categoryId: filter.categoryId } } });
  if (filter.status && filter.status !== "all") where.push({ status: filter.status as "ACTIVE" });
  const rows = await db.vendor.findMany({
    where: { AND: where },
    orderBy: [{ status: "asc" }, { companyName: "asc" }],
    take: 500,
    select: {
      id: true,
      companyName: true,
      contactName: true,
      phone: true,
      city: true,
      services: true,
      status: true,
      ratingAverage: true,
      gstin: true,
      categories: { select: { category: { select: { id: true, name: true, color: true } } } },
      _count: { select: { users: true, assignments: { where: { status: { in: ["ACCEPTED", "IN_PROGRESS", "DELIVERED"] } } } } },
    },
  });
  const seesTax = can(actor, "vendors.bank");
  return rows.map((v) => ({
    id: v.id,
    company: v.companyName,
    contact: v.contactName,
    phone: v.phone,
    city: v.city,
    services: v.services,
    status: v.status,
    rating: v.ratingAverage ? toNumber(v.ratingAverage) : null,
    gstin: seesTax ? v.gstin : null,
    departments: v.categories.map((c) => c.category),
    hasLogin: v._count.users > 0,
    activeJobs: v._count.assignments,
  }));
}

export async function getVendor(db: Db, actor: Actor, vendorId: string) {
  staffOnly(actor);
  assertCan(actor, "vendors.view");
  const v = await db.vendor.findFirst({
    where: { id: vendorId, deletedAt: null },
    include: {
      categories: { select: { category: { select: { id: true, name: true, color: true } } } },
      bankDetail: true,
      users: { select: { user: { select: { id: true, name: true, phoneNumber: true, status: true, lastLoginAt: true } } } },
    },
  });
  if (!v) throw new NotFoundError("That vendor");
  const seesTax = can(actor, "vendors.bank");
  const seesAmounts = can(actor, "quotes.view");
  // Jobs only on bookings this person can see.
  const jobs = await db.vendorAssignment.findMany({
    where: { vendorId, event: eventWhere(actor) },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, status: true, scopeOfWork: true, agreedAmount: true, event: { select: { id: true, name: true, startDate: true } } },
  });
  return {
    id: v.id,
    company: v.companyName,
    contact: v.contactName,
    phone: v.phone,
    whatsapp: v.whatsapp,
    email: v.email,
    city: v.city,
    address: v.address,
    services: v.services,
    status: v.status,
    notes: v.notes,
    rating: v.ratingAverage ? toNumber(v.ratingAverage) : null,
    departments: v.categories.map((c) => c.category),
    gstin: seesTax ? v.gstin : null,
    pan: seesTax ? v.pan : null,
    bank: seesTax && v.bankDetail ? { accountName: v.bankDetail.accountName, last4: v.bankDetail.accountNumberLast4, ifsc: v.bankDetail.ifsc, upiId: v.bankDetail.upiId, needsCheck: v.bankDetail.needsCheck, changedByVendorAt: v.bankDetail.changedByVendorAt } : null,
    logins: v.users.map((u) => u.user),
    jobs: jobs.map((j) => ({ id: j.id, status: j.status, scope: j.scopeOfWork, agreed: seesAmounts && j.agreedAmount ? toNumber(j.agreedAmount) : null, event: j.event })),
  };
}

const optional = (max: number) => z.string().trim().max(max).optional();

export const vendorSchema = z.object({
  id: z.string().uuid().optional(),
  companyName: z.string().trim().min(2, "Enter the company or shop name.").max(120),
  contactName: z.string().trim().min(2, "Enter the contact person.").max(80),
  phone: z.string().trim().min(1, "Enter a phone number.").max(30),
  whatsapp: optional(30),
  email: z.union([z.literal(""), z.string().trim().email("That email doesn't look right.")]).optional(),
  city: optional(60),
  address: optional(300),
  services: optional(300),
  categoryIds: z.array(z.string().uuid()).min(1, "Pick at least one department."),
  gstin: optional(15),
  pan: optional(10),
  status: z.enum(["ACTIVE", "INACTIVE", "BLACKLISTED"]).default("ACTIVE"),
  notes: optional(2000),
});
export type VendorInput = z.input<typeof vendorSchema>;

export async function saveVendor(db: Db, actor: Actor, input: VendorInput, meta: RequestMeta = {}) {
  staffOnly(actor);
  const v = parseInput(vendorSchema, input);
  assertCan(actor, v.id ? "vendors.edit" : "vendors.create", v.id ? "You can't edit vendors." : "You can't add vendors.");
  if (v.id && actor.grants.get("vendors.edit") !== "ALL") throw new ForbiddenError("You can't edit vendors.");
  const phone = normalizePhone(v.phone);
  if (!phone) throw new ValidationError("That phone number doesn't look right.", { phone: "Use a 10-digit mobile number." });
  const whatsapp = v.whatsapp ? normalizePhone(v.whatsapp) : null;
  if (v.whatsapp && !whatsapp) throw new ValidationError("That WhatsApp number doesn't look right.", { whatsapp: "Use a 10-digit mobile number." });
  const seesTax = can(actor, "vendors.bank");
  const gstin = v.gstin?.toUpperCase().replace(/\s/g, "") || null;
  const pan = v.pan?.toUpperCase().replace(/\s/g, "") || null;
  if (seesTax && gstin && !GSTIN_RE.test(gstin)) throw new ValidationError("That GSTIN doesn't look right (15 characters, e.g. 08ABCPR5678L1Z9).", { gstin: "Check the GSTIN." });
  if (seesTax && pan && !PAN_RE.test(pan)) throw new ValidationError("That PAN doesn't look right (e.g. ABCPR5678L).", { pan: "Check the PAN." });

  return db.$transaction(async (tx) => {
    const cats = await tx.vendorCategory.count({ where: { id: { in: v.categoryIds } } });
    if (cats !== new Set(v.categoryIds).size) throw new ValidationError("Pick departments from the list.", { categoryIds: "Pick departments from the list." });
    const same = await tx.vendor.findFirst({ where: { phone, deletedAt: null, ...(v.id ? { id: { not: v.id } } : {}) }, select: { companyName: true } });
    if (same) throw new ConflictError(`${same.companyName} already has this phone number.`);
    const data = {
      companyName: v.companyName,
      contactName: v.contactName,
      phone,
      whatsapp: whatsapp ?? phone,
      email: v.email || null,
      city: v.city || null,
      address: v.address || null,
      services: v.services || null,
      status: v.status,
      notes: v.notes || null,
      // Tax details are only changed by people allowed to see them.
      ...(seesTax ? { gstin, pan } : {}),
    };
    let id = v.id;
    if (id) {
      const before = await tx.vendor.findFirst({ where: { id, deletedAt: null }, select: { companyName: true, status: true } });
      if (!before) throw new NotFoundError("That vendor");
      await tx.vendor.update({ where: { id }, data });
      await tx.vendorCategoryLink.deleteMany({ where: { vendorId: id } });
      await recordAudit(tx, actor, { action: "update", entityType: "vendor", entityId: id, summary: `Edited vendor ${v.companyName}${before.status !== v.status ? ` (${before.status} → ${v.status})` : ""}` }, meta);
    } else {
      id = (await tx.vendor.create({ data: { ...data, createdById: actor.userId } })).id;
      await recordAudit(tx, actor, { action: "create", entityType: "vendor", entityId: id, summary: `Added vendor ${v.companyName}` }, meta);
    }
    await tx.vendorCategoryLink.createMany({ data: [...new Set(v.categoryIds)].map((categoryId) => ({ vendorId: id!, categoryId })) });
    return { id };
  });
}

export const bankSchema = z.object({
  accountName: z.string().trim().min(2, "Enter the account holder's name.").max(120),
  accountNumber: z.union([z.literal(""), z.string().trim().regex(/^\d{6,20}$/, "Account numbers are 6 to 20 digits.")]).optional(),
  ifsc: z.union([z.literal(""), z.string().trim().toUpperCase().regex(IFSC_RE, "That IFSC doesn't look right (e.g. SBIN0031234).")]).optional(),
  upiId: z.union([z.literal(""), z.string().trim().regex(/^[\w.-]{2,}@[a-zA-Z]{2,}$/, "That UPI ID doesn't look right (e.g. name@sbi).")]).optional(),
});

/** Owners and the accountant (by the bank permission) plus every vendor login of the company. */
async function bankWatchers(tx: Parameters<Parameters<Db["$transaction"]>[0]>[0]) {
  const rows = await tx.user.findMany({ where: { status: "ACTIVE", accountType: "INTERNAL", roles: { some: { role: { OR: [{ isOwner: true }, { key: "ACCOUNTANT" }] } } } }, select: { id: true } });
  return rows.map((r) => r.id);
}

/**
 * Saves bank details; a blank account number keeps the one on file.
 * Owners and the accountant change any vendor's details. A vendor changes their own, which marks them
 * "to check": the office is told, and no payment can be prepared until someone confirms by phone.
 */
export async function saveVendorBank(db: Db, actor: Actor, vendorId: string, input: z.input<typeof bankSchema>, meta: RequestMeta = {}) {
  const byVendor = actor.accountType === "VENDOR";
  if (byVendor) {
    assertCan(actor, "vendors.bank", "You can't change bank details.");
    if (!actor.vendorIds.includes(vendorId)) throw new NotFoundError("That vendor");
  } else {
    staffOnly(actor);
    assertCan(actor, "vendors.bank", "Only hosts and the accountant change bank details.");
    if (actor.grants.get("vendors.bank") !== "ALL") throw new ForbiddenError("Only hosts and the accountant change bank details.");
  }
  const v = parseInput(bankSchema, input);
  return db.$transaction(async (tx) => {
    const vendor = await tx.vendor.findFirst({ where: { id: vendorId, deletedAt: null }, select: { companyName: true, bankDetail: { select: { accountNumberEnc: true } } } });
    if (!vendor) throw new NotFoundError("That vendor");
    if (!v.accountNumber && !vendor.bankDetail?.accountNumberEnc && !v.upiId) throw new ValidationError("Enter an account number or a UPI ID.", { accountNumber: "Enter an account number or a UPI ID." });
    if (v.accountNumber && !v.ifsc) throw new ValidationError("Enter the IFSC for this account.", { ifsc: "Enter the IFSC." });
    const account = v.accountNumber ? { accountNumberEnc: encryptField(v.accountNumber), accountNumberLast4: lastFour(v.accountNumber) } : {};
    const check = byVendor ? { needsCheck: true, changedByVendorAt: new Date() } : { needsCheck: false };
    const data = { accountName: v.accountName, ifsc: v.ifsc || null, upiId: v.upiId || null, ...account, ...check };
    await tx.vendorBankDetail.upsert({ where: { vendorId }, create: { vendorId, ...data }, update: data });
    if (byVendor) {
      await notify(tx, await bankWatchers(tx), {
        type: "vendor.bankChanged",
        title: `${vendor.companyName} changed their bank details`,
        body: "Call them on their usual number to confirm before paying. Payments wait until someone confirms.",
        link: `/vendors/${vendorId}`,
        entityType: "vendor",
        entityId: vendorId,
      });
    }
    await recordAudit(tx, actor, { action: "update", entityType: "vendor_bank", entityId: vendorId, summary: `${byVendor ? `${vendor.companyName} changed their own` : "Changed"} bank details${byVendor ? "" : ` of ${vendor.companyName}`}${v.accountNumber ? ` (account ending ${lastFour(v.accountNumber)})` : ""}`, financial: true }, meta);
  });
}

/** The office confirms (by phone) bank details a vendor changed, so payments can go ahead. */
export async function confirmVendorBank(db: Db, actor: Actor, vendorId: string, meta: RequestMeta = {}) {
  staffOnly(actor);
  if (actor.grants.get("vendors.bank") !== "ALL") throw new ForbiddenError("Only hosts and the accountant confirm bank details.");
  return db.$transaction(async (tx) => {
    const b = await tx.vendorBankDetail.findUnique({ where: { vendorId }, include: { vendor: { select: { companyName: true } } } });
    if (!b?.needsCheck) throw new ConflictError("There is nothing to confirm.");
    await tx.vendorBankDetail.update({ where: { vendorId }, data: { needsCheck: false } });
    await recordAudit(tx, actor, { action: "confirm", entityType: "vendor_bank", entityId: vendorId, summary: `Confirmed ${b.vendor.companyName}'s new bank details (account ending ${b.accountNumberLast4 ?? "—"})`, financial: true }, meta);
  });
}

export const ownProfileSchema = z.object({
  contactName: z.string().trim().min(2, "Enter the contact person.").max(80),
  email: z.union([z.literal(""), z.string().trim().email("That email doesn't look right.")]).optional(),
  address: z.string().trim().max(300).optional(),
  services: z.string().trim().max(300).optional(),
  gstin: z.string().trim().max(15).optional(),
  pan: z.string().trim().max(10).optional(),
});

/** A vendor keeps their own contact, GST and PAN up to date. Name, phone and departments stay with the office. */
export async function updateOwnVendorProfile(db: Db, actor: Actor, input: z.input<typeof ownProfileSchema>, meta: RequestMeta = {}) {
  if (actor.accountType !== "VENDOR" || !actor.vendorIds[0]) throw new ForbiddenError();
  assertCan(actor, "vendors.edit", "You can't change these details.");
  const v = parseInput(ownProfileSchema, input);
  const gstin = v.gstin?.toUpperCase().replace(/\s/g, "") || null;
  const pan = v.pan?.toUpperCase().replace(/\s/g, "") || null;
  if (gstin && !GSTIN_RE.test(gstin)) throw new ValidationError("That GSTIN doesn't look right (15 characters, e.g. 08ABCPR5678L1Z9).", { gstin: "Check the GSTIN." });
  if (pan && !PAN_RE.test(pan)) throw new ValidationError("That PAN doesn't look right (e.g. ABCPR5678L).", { pan: "Check the PAN." });
  const vendorId = actor.vendorIds[0];
  return db.$transaction(async (tx) => {
    await tx.vendor.update({ where: { id: vendorId }, data: { contactName: v.contactName, email: v.email || null, address: v.address || null, services: v.services || null, ...(can(actor, "vendors.bank") ? { gstin, pan } : {}) } });
    await recordAudit(tx, actor, { action: "update", entityType: "vendor", entityId: vendorId, summary: `Vendor updated their own profile` }, meta);
  });
}
