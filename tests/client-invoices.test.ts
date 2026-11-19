import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fyCode, gstinCheckChar, isValidGstin, rupeesInWords, splitTax, stateCodeOf } from "@/lib/gst";
import { buildExport } from "@/modules/finance/exports";
import { bookingInvoices, cancelInvoice, deleteDraft, draftInvoice, invoiceForPrint, issueInvoice, updateClientBilling } from "@/modules/finance/client-invoices";
import { bookingLedger } from "@/modules/finance/overview";
import { addCharge, recordReceipt, removeCharge } from "@/modules/finance/payments";
import { settlementView } from "@/modules/finance/settlement";
import { loadActor, type Actor } from "@/modules/identity/actor";
import { getCompany, updateCompany } from "@/modules/settings/company";
import { makeEvent, makeUser, testDb } from "./support/factories";

// The switch is read from the actor; turning it on here leaves the shared company settings alone.
const on = (a: Actor): Actor => ({ ...a, switches: { ...a.switches, clientInvoices: true } });
let owner: Actor, accountant: Actor, manager: Actor;
let eventId: string, delhiEventId: string, packageId: string, decorId: string;
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const COMPANY_GSTIN = "08AAACT1234A1Z1";
const DELHI_GSTIN = "07AABCI5678B1ZN";

beforeAll(async () => {
  owner = on((await loadActor(testDb, (await makeUser({ name: "CI Owner", roleKey: "OWNER" })).id))!);
  accountant = (await loadActor(testDb, (await makeUser({ name: "CI Accountant", roleKey: "ACCOUNTANT" })).id))!;
  const m = await makeUser({ name: "CI Manager", roleKey: "EVENT_MANAGER" });
  eventId = (await makeEvent({ name: "CI Mehendi" })).id;
  delhiEventId = (await makeEvent({ name: "CI Offsite" })).id;
  await testDb.eventMember.create({ data: { eventId, userId: m.id, role: "MANAGER" } });
  manager = on((await loadActor(testDb, m.id))!);
  packageId = (await addCharge(testDb, accountant, { eventId, description: "Mehendi package", amount: 100000, gstRate: 18 })).id;
  decorId = (await addCharge(testDb, accountant, { eventId, description: "Floral upgrade", amount: 20000, gstRate: 18 })).id;
  await addCharge(testDb, accountant, { eventId: delhiEventId, description: "Corporate offsite", amount: 200000, gstRate: 18 });
});
afterAll(() => testDb.$disconnect());

describe("GST helpers", () => {
  it("checks GSTINs with their check character and state code", () => {
    expect(isValidGstin("27AAPFU0939F1ZV")).toBe(true); // a published example
    expect(isValidGstin(COMPANY_GSTIN)).toBe(true);
    expect(isValidGstin("27AAPFU0939F1ZW")).toBe(false);
    expect(isValidGstin("99AAPFU0939F1Z" + gstinCheckChar("99AAPFU0939F1Z"))).toBe(false);
    expect(stateCodeOf("rajasthan")).toBe("08");
  });

  it("splits tax and writes amounts in words", () => {
    expect(splitTax(1000, 18, true)).toEqual({ cgst: 90, sgst: 90, igst: 0 });
    expect(splitTax(1000.05, 5, true)).toEqual({ cgst: 25, sgst: 25, igst: 0 });
    expect(splitTax(1000, 18, false)).toEqual({ cgst: 0, sgst: 0, igst: 180 });
    expect(fyCode("2026-11-18")).toBe("26-27");
    expect(fyCode("2027-03-31")).toBe("26-27");
    expect(rupeesInWords(755200)).toBe("Rupees Seven Lakh Fifty-Five Thousand Two Hundred only");
    expect(rupeesInWords(12345678.5)).toBe("Rupees One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight and Fifty Paise only");
  });
});

describe("company tax details", () => {
  it("owners and the accountant set them; the GSTIN is checked and gives the state", async () => {
    await expect(getCompany(testDb, manager)).rejects.toThrow(/Only hosts and the accountant/);
    await expect(updateCompany(testDb, accountant, { legalName: "Taamara Taamara LLP", tradeName: "Taamara Taamara", gstin: "08AAACT1234A1Z2" })).rejects.toThrow(/GSTIN doesn't look right/);
    await expect(updateCompany(testDb, accountant, { legalName: "Taamara Taamara LLP", tradeName: "Taamara Taamara", gstin: COMPANY_GSTIN, pan: "ABCDE1234F" })).rejects.toThrow(/PAN doesn't match/);
    await updateCompany(testDb, accountant, { legalName: "Taamara Taamara LLP", tradeName: "Taamara Taamara", gstin: COMPANY_GSTIN, address: "12 MI Road", city: "Jaipur", stateCode: "27", bankDetails: "HDFC Bank · A/c 50200012345678 · IFSC HDFC0000123", invoicePrefix: "tt" });
    const c = await getCompany(testDb, owner);
    expect(c).toMatchObject({ gstin: COMPANY_GSTIN, pan: "AAACT1234A", stateCode: "08", state: "Rajasthan", invoicePrefix: "TT", bankDetails: "HDFC Bank · A/c 50200012345678 · IFSC HDFC0000123" });
    // Stored encrypted, and kept out of the audit log.
    const row = await testDb.companyProfile.findUniqueOrThrow({ where: { id: 1 } });
    expect(row.bankDetails).not.toContain("50200012345678");
    const audit = await testDb.auditLog.findFirstOrThrow({ where: { entityType: "company_profile" }, orderBy: { createdAt: "desc" } });
    expect(JSON.stringify([audit.summary, audit.before, audit.after])).not.toContain("50200012345678");
  });
});

describe("client invoices", () => {
  let draftId: string, firstId: string;

  it("are off until an owner switches them on", async () => {
    const off = (await loadActor(testDb, owner.userId))!;
    expect(off.switches.clientInvoices).toBe(false);
    expect(await bookingInvoices(testDb, off, eventId)).toBeNull();
    await expect(draftInvoice(testDb, off, { eventId, lines: [{ chargeId: packageId, amount: 1000 }] })).rejects.toThrow(/switched off/);
  });

  it("only owners and the accountant draft them; managers never see them", async () => {
    await expect(draftInvoice(testDb, manager, { eventId, lines: [{ chargeId: packageId, amount: 1000 }] })).rejects.toThrow(/Only hosts and the accountant/);
    expect(await bookingInvoices(testDb, manager, eventId)).toBeNull();
  });

  it("an advance bills part of a charge; a charge is never billed twice", async () => {
    firstId = (await draftInvoice(testDb, owner, { eventId, type: "ADVANCE", lines: [{ chargeId: packageId, amount: 50000 }] })).id;
    await expect(draftInvoice(testDb, owner, { eventId, lines: [{ chargeId: packageId, amount: 60000 }] })).rejects.toThrow(/₹50,000.00 left to bill/);
    draftId = (await draftInvoice(testDb, owner, { eventId, lines: [{ chargeId: packageId, amount: 50000 }, { chargeId: decorId, amount: 20000 }] })).id;
    const view = (await bookingInvoices(testDb, owner, eventId))!;
    expect(view.charges.map((c) => c.left)).toEqual([0, 0]);
    expect(view.invoices[0]).toMatchObject({ status: "DRAFT", subtotal: 50000, tax: 9000, total: 59000 });
    expect(view.invoices[0].lines[0].description).toBe("Mehendi package (advance)");
  });

  it("issuing needs the client's address above ₹50,000, then numbers it and splits CGST + SGST in Rajasthan", async () => {
    await expect(issueInvoice(testDb, owner, firstId, { issueDate: today })).rejects.toThrow(/billing address/);
    await updateClientBilling(testDb, owner, eventId, { address: "C-Scheme", city: "Jaipur", stateCode: "08" });
    await expect(issueInvoice(testDb, owner, firstId, { issueDate: "2099-01-01" })).rejects.toThrow(/future/);
    const { number } = await issueInvoice(testDb, owner, firstId, { issueDate: today });
    expect(number).toBe(`TT-${fyCode(today)}-0001`);
    expect(number.length).toBeLessThanOrEqual(16);
    const inv = await testDb.clientInvoice.findUniqueOrThrow({ where: { id: firstId } });
    expect(inv).toMatchObject({ status: "ISSUED", placeOfSupply: "08", financialYear: fyCode(today) });
    expect([Number(inv.cgst), Number(inv.sgst), Number(inv.igst), Number(inv.total)]).toEqual([4500, 4500, 0, 59000]);
    expect(inv.supplier).toMatchObject({ gstin: COMPANY_GSTIN, state: "Rajasthan" });
    expect(inv.recipient).toMatchObject({ address: "C-Scheme", stateCode: "08" });
    await expect(issueInvoice(testDb, owner, firstId, { issueDate: today })).rejects.toThrow(/already issued/);
  });

  it("an issued invoice is fixed: no edits, no deletes, its charges stay", async () => {
    await expect(testDb.clientInvoice.update({ where: { id: firstId }, data: { recipient: { name: "Someone else" } } })).rejects.toThrow(/cannot be edited/);
    await expect(testDb.clientInvoice.delete({ where: { id: firstId } })).rejects.toThrow(/cannot be deleted/);
    await expect(deleteDraft(testDb, owner, firstId)).rejects.toThrow(/Only drafts/);
    await expect(removeCharge(testDb, accountant, packageId)).rejects.toThrow(/on a client invoice/);
  });

  it("dates never go backwards; numbers have no gaps; drafts can be deleted", async () => {
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    if (fyCode(yesterday) === fyCode(today)) await expect(issueInvoice(testDb, on(accountant), draftId, { issueDate: yesterday })).rejects.toThrow(/can't be earlier/);
    expect((await issueInvoice(testDb, on(accountant), draftId, { issueDate: today })).number).toBe(`TT-${fyCode(today)}-0002`);
    const extra = (await addCharge(testDb, accountant, { eventId, description: "Extra hour", amount: 5000, gstRate: 18 })).id;
    const d = (await draftInvoice(testDb, owner, { eventId, type: "ADDITIONAL", lines: [{ chargeId: extra, amount: 5000 }] })).id;
    await deleteDraft(testDb, owner, d);
    expect(await testDb.clientInvoice.count({ where: { id: d } })).toBe(0);
  });

  it("a registered client in another state is billed IGST, with their GSTIN", async () => {
    await expect(updateClientBilling(testDb, owner, delhiEventId, { gstin: "07AABCI5678B1ZM" })).rejects.toThrow(/GSTIN doesn't look right/);
    await updateClientBilling(testDb, owner, delhiEventId, { gstin: DELHI_GSTIN, address: "Nehru Place", city: "New Delhi" });
    const charge = (await testDb.clientCharge.findFirstOrThrow({ where: { eventId: delhiEventId } })).id;
    const id = (await draftInvoice(testDb, owner, { eventId: delhiEventId, lines: [{ chargeId: charge, amount: 200000 }] })).id;
    expect((await bookingInvoices(testDb, owner, delhiEventId))!.client).toMatchObject({ placeOfSupply: "07", interState: true });
    await issueInvoice(testDb, owner, id, { issueDate: today });
    const p = await invoiceForPrint(testDb, accountant, id);
    expect(p).toMatchObject({ intraState: false, placeName: "Delhi", cgst: 0, sgst: 0, igst: 36000, total: 236000 });
    expect(p.recipient.gstin).toBe(DELHI_GSTIN);
    expect(p.inWords).toBe("Rupees Two Lakh Thirty-Six Thousand only");
    expect(p.taxByRate).toEqual([{ rate: 18, taxable: 200000, cgst: 0, sgst: 0, igst: 36000 }]);
    await expect(invoiceForPrint(testDb, manager, id)).rejects.toThrow(/Only hosts and the accountant/);
  });

  it("cancelling needs a reason; the charge can then be billed again", async () => {
    await expect(cancelInvoice(testDb, owner, firstId, "no")).rejects.toThrow(/Say why/);
    await cancelInvoice(testDb, owner, firstId, "Wrong client name");
    await expect(cancelInvoice(testDb, owner, firstId, "Wrong client name")).rejects.toThrow(/already cancelled/);
    await expect(testDb.clientInvoice.update({ where: { id: firstId }, data: { status: "ISSUED" } })).rejects.toThrow(/stays cancelled/);
    expect((await bookingInvoices(testDb, owner, eventId))!.charges[0].left).toBe(50000);
  });

  it("the sales register exports issued and cancelled invoices for GSTR-1", async () => {
    const { buffer } = await buildExport(testDb, accountant, "sales", today, today);
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const rows = wb.getWorksheet("Sales")!.getSheetValues().slice(2).map((r) => (r as unknown[]).slice(1));
    const mine = rows.filter((r) => String(r[1]).startsWith("TT-"));
    expect(mine.length).toBeGreaterThanOrEqual(3);
    expect(mine.find((r) => r[1] === `TT-${fyCode(today)}-0001`)?.[12]).toBe("CANCELLED");
    expect(mine.some((r) => r[3] === DELHI_GSTIN)).toBe(true);
  });
});

describe("TDS kept back by a client", () => {
  it("counts towards what the client owes, but not as cash received", async () => {
    const ev = await makeEvent({ name: "CI Corporate" });
    await addCharge(testDb, accountant, { eventId: ev.id, description: "Annual day", amount: 100000, gstRate: 18 });
    await expect(recordReceipt(testDb, accountant, { eventId: ev.id, amount: 1000, tdsAmount: 900, method: "BANK", reference: "N1", paidOn: today })).rejects.toThrow(/TDS looks too high/);
    // 1,18,000 billed with GST; the client deducts 2% TDS on 1,00,000 and pays the rest.
    await recordReceipt(testDb, accountant, { eventId: ev.id, amount: 116000, tdsAmount: 2000, method: "BANK", reference: "N2", paidOn: today });
    const l = (await bookingLedger(testDb, accountant, ev.id))!;
    expect([l.received, l.tds, l.clientBalance]).toEqual([116000, 2000, 0]);
    const s = (await settlementView(testDb, owner, ev.id))!;
    expect(s.checks.find((c) => c.key === "client")!.ok).toBe(true);
    const p = await testDb.payment.findFirstOrThrow({ where: { eventId: ev.id } });
    await expect(testDb.payment.update({ where: { id: p.id }, data: { tdsAmount: 1 } })).rejects.toThrow(/cannot be edited/);
  });
});
