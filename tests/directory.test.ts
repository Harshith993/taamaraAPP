import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptField, encryptField } from "@/lib/crypto";
import { loadActor, type Actor } from "@/modules/identity/actor";
import { addUnavailable, getWorker, listWorkers, removeUnavailable, saveWorker } from "@/modules/crew/roster";
import { getVendor, listVendors, saveVendor, saveVendorBank } from "@/modules/vendors/directory";
import { makeEvent, makeUser, testDb } from "./support/factories";

const actorOf = async (u: { id: string }) => (await loadActor(testDb, u.id))!;
let owner: Actor, manager: Actor, supervisor: Actor, accountant: Actor, vendor: Actor, crew: Actor;
let lighting: string, decoration: string, helper: string, driver: string;

beforeAll(async () => {
  owner = await actorOf(await makeUser({ name: "DR Owner", roleKey: "OWNER" }));
  manager = await actorOf(await makeUser({ name: "DR Manager", roleKey: "EVENT_MANAGER" }));
  supervisor = await actorOf(await makeUser({ name: "DR Supervisor", roleKey: "SUPERVISOR" }));
  accountant = await actorOf(await makeUser({ name: "DR Accountant", roleKey: "ACCOUNTANT" }));
  vendor = await actorOf(await makeUser({ name: "DR Vendor", roleKey: "VENDOR", accountType: "VENDOR" }));
  crew = await actorOf(await makeUser({ name: "DR Crew", roleKey: "LABOUR", accountType: "LABOUR" }));
  lighting = (await testDb.vendorCategory.findFirstOrThrow({ where: { name: "Lighting" } })).id;
  decoration = (await testDb.vendorCategory.findFirstOrThrow({ where: { name: "Decoration" } })).id;
  helper = (await testDb.skill.findFirstOrThrow({ where: { name: "Helper" } })).id;
  driver = (await testDb.skill.findFirstOrThrow({ where: { name: "Driver" } })).id;
});
afterAll(() => testDb.$disconnect());

describe("encryption", () => {
  it("round-trips and never stores the plain value", () => {
    const enc = encryptField("123456789012");
    expect(enc).not.toContain("123456789012");
    expect(enc.startsWith("v1:")).toBe(true);
    expect(decryptField(enc)).toBe("123456789012");
    expect(encryptField("123456789012")).not.toBe(enc);
    expect(() => decryptField(enc.replace(/.$/, enc.endsWith("A") ? "B" : "A"))).toThrow();
  });
});

describe("vendor directory", () => {
  let vendorId: string;

  it("a manager adds a vendor; GSTIN from a manager is ignored", async () => {
    const r = await saveVendor(testDb, manager, { companyName: "DR Jyoti Lights", contactName: "Jyoti", phone: "98290 55501", categoryIds: [lighting], city: "Jaipur", gstin: "08ABCPR5678L1Z9" });
    vendorId = r.id;
    const v = await testDb.vendor.findUniqueOrThrow({ where: { id: vendorId }, include: { categories: true } });
    expect(v.phone).toBe("+919829055501");
    expect(v.whatsapp).toBe("+919829055501");
    expect(v.gstin).toBeNull();
    expect(v.categories).toHaveLength(1);
    await expect(saveVendor(testDb, manager, { id: vendorId, companyName: "DR Jyoti Lights", contactName: "Jyoti", phone: "9829055501", categoryIds: [lighting] })).rejects.toThrow(/can't edit vendors/);
    await expect(saveVendor(testDb, supervisor, { companyName: "DR New", contactName: "N N", phone: "9829055599", categoryIds: [lighting] })).rejects.toThrow(/can't add vendors/);
    await expect(saveVendor(testDb, manager, { companyName: "DR Copy", contactName: "C C", phone: "+91 98290 55501", categoryIds: [lighting] })).rejects.toThrow(/already has this phone/);
  });

  it("owners edit, with GSTIN checked; tax and bank details are hidden from managers", async () => {
    await expect(saveVendor(testDb, owner, { id: vendorId, companyName: "DR Jyoti Lights", contactName: "Jyoti", phone: "9829055501", categoryIds: [lighting, decoration], gstin: "08ABC" })).rejects.toThrow(/GSTIN/);
    await saveVendor(testDb, owner, { id: vendorId, companyName: "DR Jyoti Lights & Decor", contactName: "Jyoti", phone: "9829055501", categoryIds: [lighting, decoration], gstin: "08abcpr5678l1z9" });
    await saveVendorBank(testDb, accountant, vendorId, { accountName: "Jyoti Lights", accountNumber: "001122334455", ifsc: "sbin0031234", upiId: "jyoti@sbi" });
    const stored = await testDb.vendorBankDetail.findUniqueOrThrow({ where: { vendorId } });
    expect(stored.accountNumberLast4).toBe("4455");
    expect(decryptField(stored.accountNumberEnc!)).toBe("001122334455");
    expect(stored.ifsc).toBe("SBIN0031234");
    const forAccountant = await getVendor(testDb, accountant, vendorId);
    expect(forAccountant.gstin).toBe("08ABCPR5678L1Z9");
    expect(forAccountant.bank?.last4).toBe("4455");
    const forManager = await getVendor(testDb, manager, vendorId);
    expect(forManager.gstin).toBeNull();
    expect(forManager.bank).toBeNull();
    expect(forManager.departments.map((d) => d.name).sort()).toEqual(["Decoration", "Lighting"]);
    await expect(saveVendorBank(testDb, manager, vendorId, { accountName: "x x" })).rejects.toThrow(/Only owners and the accountant/);
    const log = await testDb.auditLog.findFirstOrThrow({ where: { entityType: "vendor_bank", entityId: vendorId } });
    expect(log.summary).not.toContain("001122334455");
  });

  it("the list searches and filters; vendors and crew can't open it", async () => {
    const found = await listVendors(testDb, manager, { q: "jyoti" });
    expect(found.map((v) => v.company)).toEqual(["DR Jyoti Lights & Decor"]);
    expect((await listVendors(testDb, manager, { categoryId: decoration })).some((v) => v.id === vendorId)).toBe(true);
    await expect(listVendors(testDb, vendor)).rejects.toThrow(/for the team/);
    await expect(listVendors(testDb, crew)).rejects.toThrow(/for the team/);
  });
});

describe("crew roster", () => {
  let workerId: string;

  it("a supervisor registers crew; the usual rate is only set by people who see pay", async () => {
    const r = await saveWorker(testDb, supervisor, { name: "DR Bablu", phone: "99220 77701", skillIds: [helper], usualEventRate: "650" });
    workerId = r.id;
    expect((await testDb.worker.findUniqueOrThrow({ where: { id: workerId } })).usualEventRate).toBeNull();
    await expect(saveWorker(testDb, supervisor, { id: workerId, name: "DR Bablu", phone: "9922077701", skillIds: [helper] })).rejects.toThrow(/can't edit crew/);
    await saveWorker(testDb, manager, { id: workerId, name: "DR Bablu Saini", phone: "9922077701", skillIds: [helper, driver], usualEventRate: "700" });
    const w = await getWorker(testDb, manager, workerId);
    expect(w.usualRate).toBe(700);
    expect(w.skills.map((s) => s.name).sort()).toEqual(["Driver", "Helper"]);
    expect((await getWorker(testDb, supervisor, workerId)).usualRate).toBeNull();
    await expect(saveWorker(testDb, manager, { name: "DR Copy", phone: "+919922077701", skillIds: [helper] })).rejects.toThrow(/already has this phone/);
  });

  it("days off are kept, but not on a day they are already booked", async () => {
    const day = new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10);
    await addUnavailable(testDb, manager, workerId, { date: day, reason: "Village wedding" });
    let w = await getWorker(testDb, manager, workerId);
    expect(w.unavailable.map((u) => u.reason)).toEqual(["Village wedding"]);
    await removeUnavailable(testDb, manager, workerId, w.unavailable[0].id);
    const ev = await makeEvent({ name: "DR Booking" });
    const fn = await testDb.eventFunction.create({ data: { eventId: ev.id, name: "Party", date: new Date(`${day}T00:00:00Z`), startsAt: new Date(`${day}T19:00:00+05:30`) } });
    await testDb.crewAssignment.create({ data: { eventId: ev.id, workerId, duty: "Helper", agreedPay: 700, shifts: { create: { functionId: fn.id, date: fn.date, reportAt: fn.startsAt } } } });
    await expect(addUnavailable(testDb, manager, workerId, { date: day })).rejects.toThrow(/already booked/);
    await expect(addUnavailable(testDb, manager, workerId, { date: "2020-01-01" })).rejects.toThrow(/today or a later day/);
    w = await getWorker(testDb, owner, workerId);
    expect(w.assignments).toHaveLength(1);
    expect(w.assignments[0].pay).toBe(700);
  });

  it("the roster filters by skill and is only for the team", async () => {
    expect((await listWorkers(testDb, manager, { skillId: driver })).some((w) => w.id === workerId)).toBe(true);
    expect((await listWorkers(testDb, manager, { q: "bablu" })).map((w) => w.name)).toEqual(["DR Bablu Saini"]);
    await expect(listWorkers(testDb, crew)).rejects.toThrow(/for the team/);
  });
});
