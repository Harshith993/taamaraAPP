/**
 * The company's own details as printed on GST invoices: legal name, GSTIN, PAN, address, state,
 * contact, bank details (encrypted) and the invoice number prefix. Owners and the accountant
 * (admin.taxSettings) see and change them; every change is audited.
 *
 * The state comes from the GSTIN when there is one, so the two can't disagree.
 */
import { z } from "zod";
import { decryptField, encryptField } from "@/lib/crypto";
import type { Db, DbTx } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { GST_STATES, isValidGstin, normalizeGstin, stateName } from "@/lib/gst";
import { parseInput } from "@/lib/validate";
import { recordAudit, type RequestMeta } from "@/modules/audit/audit";
import type { Actor } from "@/modules/identity/actor";
import { assertCan } from "@/modules/identity/policy";

export const DEFAULT_INVOICE_PREFIX = "TT";

export interface CompanyDetails {
  legalName: string;
  tradeName: string;
  gstin: string | null;
  pan: string | null;
  address: string | null;
  city: string | null;
  stateCode: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  bankDetails: string | null;
  invoicePrefix: string;
}

/** For services that print invoices (no permission check). */
export async function readCompany(tx: DbTx): Promise<CompanyDetails> {
  const c = await tx.companyProfile.findUniqueOrThrow({ where: { id: 1 } });
  const settings = (c.settings && typeof c.settings === "object" ? c.settings : {}) as { invoicePrefix?: string };
  let bank: string | null = null;
  if (c.bankDetails) {
    try {
      bank = decryptField(c.bankDetails);
    } catch {
      bank = null; // a key change would make it unreadable; it is re-entered on Settings
    }
  }
  return {
    legalName: c.legalName,
    tradeName: c.tradeName,
    gstin: c.gstin,
    pan: c.pan,
    address: c.address,
    city: c.city,
    stateCode: c.stateCode,
    state: c.state,
    phone: c.phone,
    email: c.email,
    bankDetails: bank,
    invoicePrefix: settings.invoicePrefix || DEFAULT_INVOICE_PREFIX,
  };
}

export async function getCompany(db: Db, actor: Actor): Promise<CompanyDetails> {
  assertCan(actor, "admin.taxSettings", "Only owners and the accountant see the company's tax details.");
  return readCompany(db);
}

const optional = (max: number) => z.string().trim().max(max).optional();

export const companySchema = z.object({
  legalName: z.string().trim().min(2, "Enter the legal name as on the GST certificate.").max(120),
  tradeName: z.string().trim().min(2).max(80),
  gstin: optional(20),
  pan: optional(12),
  address: optional(300),
  city: optional(60),
  stateCode: z.string().refine((s) => s === "" || s in GST_STATES, "Pick the state.").optional(),
  phone: optional(20),
  email: z.union([z.literal(""), z.string().trim().email("That email doesn't look right.")]).optional(),
  bankDetails: optional(400),
  invoicePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{1,5}$/, "1 to 5 letters, e.g. TT.")
    .optional(),
});

export async function updateCompany(db: Db, actor: Actor, input: z.input<typeof companySchema>, meta: RequestMeta = {}) {
  assertCan(actor, "admin.taxSettings", "Only owners and the accountant change the company's tax details.");
  const v = parseInput(companySchema, input);
  const gstin = normalizeGstin(v.gstin) || null;
  if (gstin && !isValidGstin(gstin)) throw new ValidationError("That GSTIN doesn't look right. Check it against the GST certificate.", { gstin: "Check the GSTIN (15 characters)." });
  const pan = (v.pan ?? "").toUpperCase().replace(/\s/g, "") || null;
  if (pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) throw new ValidationError("That PAN doesn't look right (e.g. ABCPR5678L).", { pan: "Check the PAN." });
  if (gstin && pan && gstin.slice(2, 12) !== pan) throw new ValidationError("The PAN doesn't match the GSTIN (characters 3 to 12).", { pan: "Check the PAN." });
  const stateCode = gstin ? gstin.slice(0, 2) : v.stateCode || null;

  return db.$transaction(async (tx) => {
    const before = await readCompany(tx);
    const company = await tx.companyProfile.findUniqueOrThrow({ where: { id: 1 }, select: { settings: true } });
    const settings = company.settings && typeof company.settings === "object" ? (company.settings as Record<string, unknown>) : {};
    const after = {
      legalName: v.legalName,
      tradeName: v.tradeName,
      gstin,
      pan: pan ?? (gstin ? gstin.slice(2, 12) : null),
      address: v.address || null,
      city: v.city || null,
      stateCode,
      state: stateName(stateCode),
      phone: v.phone || null,
      email: v.email || null,
    };
    const bank = v.bankDetails?.trim() || null;
    await tx.companyProfile.update({
      where: { id: 1 },
      data: { ...after, bankDetails: bank ? encryptField(bank) : null, settings: { ...settings, invoicePrefix: v.invoicePrefix || before.invoicePrefix } },
    });
    const prefix = v.invoicePrefix || before.invoicePrefix;
    const fields = (Object.keys(after) as (keyof typeof after)[]).filter((k) => before[k] !== after[k]);
    const labels: string[] = [...fields];
    if (before.bankDetails !== bank) labels.push("bank details");
    if (prefix !== before.invoicePrefix) labels.push("invoice prefix");
    if (labels.length)
      await recordAudit(
        tx,
        actor,
        {
          action: "update",
          entityType: "company_profile",
          entityId: "1",
          summary: `Changed the company's ${labels.join(", ")}`,
          financial: true,
          // Bank details are not copied into the audit log.
          before: { ...Object.fromEntries(fields.map((k) => [k, before[k]])), ...(prefix !== before.invoicePrefix ? { invoicePrefix: before.invoicePrefix } : {}) },
          after: { ...Object.fromEntries(fields.map((k) => [k, after[k]])), ...(prefix !== before.invoicePrefix ? { invoicePrefix: prefix } : {}) },
        },
        meta,
      );
    return { changed: labels.length };
  });
}
