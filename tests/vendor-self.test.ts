import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addUnavailable } from "@/modules/crew/roster";
import { preparePayment } from "@/modules/finance/payments";
import { loadActor, type Actor } from "@/modules/identity/actor";
import { confirmVendorBank, saveVendorBank, updateOwnVendorProfile } from "@/modules/vendors/directory";
import { makeUser, makeVendor, makeWorker, testDb } from "./support/factories";

const actorOf = async (u: { id: string }) => (await loadActor(testDb, u.id))!;
let owner: Actor, accountant: Actor, vendor: Actor, otherVendor: Actor, crew: Actor;
let vendorId: string, otherVendorId: string, invoiceId: string, workerId: string;

beforeAll(async () => {
  owner = await actorOf(await makeUser({ name: "VS Owner", roleKey: "OWNER" }));
  accountant = await actorOf(await makeUser({ name: "VS Accountant", roleKey: "ACCOUNTANT" }));
  const v = await makeVendor("VS Sound");
  const v2 = await makeVendor("VS Lights");
  vendorId = v.id;
  otherVendorId = v2.id;
  const vu = await makeUser({ name: "VS Sound login", roleKey: "VENDOR", accountType: "VENDOR" });
  const vu2 = await makeUser({ name: "VS Lights login", roleKey: "VENDOR", accountType: "VENDOR" });
  await testDb.vendorUser.createMany({ data: [{ vendorId: v.id, userId: vu.id }, { vendorId: v2.id, userId: vu2.id }] });
  vendor = await actorOf(vu);
  otherVendor = await actorOf(vu2);
  invoiceId = (await testDb.vendorInvoice.create({ data: { vendorId: v.id, invoiceNumber: "VS/1", invoiceDate: new Date(), taxableAmount: 1000, total: 1000, status: "VERIFIED" } })).id;
  const w = await makeWorker("VS Crew");
  const cu = await makeUser({ name: "VS Crew login", roleKey: "LABOUR", accountType: "LABOUR" });
  await testDb.worker.update({ where: { id: w.id }, data: { userId: cu.id } });
  workerId = w.id;
  crew = await actorOf(cu);
});
afterAll(() => testDb.$disconnect());

describe("vendors keep their own details", () => {
  it("a vendor's bank change waits for a confirmation call before any payment", async () => {
    await saveVendorBank(testDb, vendor, vendorId, { accountName: "VS Sound", accountNumber: "998877665544", ifsc: "HDFC0001234" });
    const b = await testDb.vendorBankDetail.findUniqueOrThrow({ where: { vendorId } });
    expect(b.needsCheck).toBe(true);
    expect(await testDb.notification.count({ where: { userId: { in: [owner.userId, accountant.userId] }, type: "vendor.bankChanged" } })).toBe(2);
    await expect(preparePayment(testDb, accountant, { kind: "VENDOR_INVOICE", invoiceId, amount: 500 })).rejects.toThrow(/changed their bank details/);
    await confirmVendorBank(testDb, accountant, vendorId);
    expect((await testDb.vendorBankDetail.findUniqueOrThrow({ where: { vendorId } })).needsCheck).toBe(false);
    await preparePayment(testDb, accountant, { kind: "VENDOR_INVOICE", invoiceId, amount: 500 });
    await expect(confirmVendorBank(testDb, accountant, vendorId)).rejects.toThrow(/nothing to confirm/);
  });

  it("never another vendor's", async () => {
    await expect(saveVendorBank(testDb, vendor, otherVendorId, { accountName: "Thief", accountNumber: "111122223333", ifsc: "HDFC0001234" })).rejects.toThrow(/not found/);
    await expect(confirmVendorBank(testDb, vendor, vendorId)).rejects.toThrow();
  });

  it("contact and GST details, checked", async () => {
    await expect(updateOwnVendorProfile(testDb, vendor, { contactName: "Vicky", gstin: "NOTAGSTIN" })).rejects.toThrow(/GSTIN/);
    await updateOwnVendorProfile(testDb, vendor, { contactName: "Vicky Sharma", gstin: "08abcpr5678l1z9", services: "DJ, sound" });
    const v = await testDb.vendor.findUniqueOrThrow({ where: { id: vendorId } });
    expect(v.contactName).toBe("Vicky Sharma");
    expect(v.gstin).toBe("08ABCPR5678L1Z9");
    await expect(updateOwnVendorProfile(testDb, accountant, { contactName: "x x" })).rejects.toThrow();
  });
});

describe("crew mark their own days off", () => {
  it("for themselves only", async () => {
    const day = new Date(Date.now() + 4 * 86400_000).toISOString().slice(0, 10);
    await addUnavailable(testDb, crew, workerId, { date: day, reason: "Exam" });
    expect(await testDb.workerUnavailability.count({ where: { workerId } })).toBe(1);
    const other = await makeWorker("VS Other");
    await expect(addUnavailable(testDb, crew, other.id, { date: day })).rejects.toThrow(/for the team/);
  });
});
