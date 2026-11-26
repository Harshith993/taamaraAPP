import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildExport } from "@/modules/finance/exports";
import { loadActor, type Actor } from "@/modules/identity/actor";
import { makeUser, makeVendor, testDb } from "./support/factories";

let owner: Actor, accountant: Actor, manager: Actor;
const today = new Date().toISOString().slice(0, 10);
beforeAll(async () => {
  owner = (await loadActor(testDb, (await makeUser({ name: "XP Owner", roleKey: "OWNER" })).id))!;
  accountant = (await loadActor(testDb, (await makeUser({ name: "XP Accountant", roleKey: "ACCOUNTANT" })).id))!;
  manager = (await loadActor(testDb, (await makeUser({ name: "XP Manager", roleKey: "EVENT_MANAGER" })).id))!;
  const v = await makeVendor("XP Tent House");
  await testDb.vendor.update({ where: { id: v.id }, data: { gstin: "08ABCPR5678L1Z9" } });
  await testDb.vendorInvoice.create({ data: { vendorId: v.id, invoiceNumber: "XP/1", invoiceDate: new Date(`${today}T00:00:00Z`), taxableAmount: 10000, gstAmount: 1800, total: 11800, status: "VERIFIED" } });
  await testDb.vendorInvoice.create({ data: { vendorId: v.id, invoiceNumber: "XP/2", invoiceDate: new Date(`${today}T00:00:00Z`), taxableAmount: 5, total: 5, status: "VOID" } });
});
afterAll(() => testDb.$disconnect());

describe("exports", () => {
  it("the purchase register lists vendor invoices with GSTIN and GST, without void ones, and is audited", async () => {
    const { filename, buffer } = await buildExport(testDb, accountant, "purchases", today, today);
    expect(filename).toBe(`taamara-purchases-${today}-to-${today}.xlsx`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Purchases")!;
    const rows = ws.getSheetValues().slice(2).map((r) => (r as unknown[]).slice(1));
    const mine = rows.filter((r) => r[1] === "XP Tent House");
    expect(mine).toHaveLength(1);
    expect(mine[0][2]).toBe("08ABCPR5678L1Z9");
    expect(mine[0][5]).toBe(1800);
    expect(ws.getRow(1).values).not.toContain("TDS"); // no TDS on vendor payments (D63)
    expect(mine[0][6]).toBe(11800);
    expect(await testDb.auditLog.count({ where: { action: "export", entityId: "purchases", actorId: accountant.userId } })).toBe(1);
  });

  it("every kind builds; managers can't export; bad ranges are refused", async () => {
    for (const k of ["payments", "expenses", "crew-pay", "advances"]) expect((await buildExport(testDb, owner, k, "2026-01-01", today)).buffer.length).toBeGreaterThan(1000);
    await expect(buildExport(testDb, manager, "payments", today, today)).rejects.toThrow(/Only hosts and the accountant/);
    await expect(buildExport(testDb, owner, "payments", today, "2020-01-01")).rejects.toThrow(/date range/);
    await expect(buildExport(testDb, owner, "salaries", today, today)).rejects.toThrow(/Unknown/);
  });
});
