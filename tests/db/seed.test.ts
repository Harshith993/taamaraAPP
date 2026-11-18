import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_ROLE_GRANTS, ROLE_KEYS } from "@/modules/identity/permissions";
import { testDb } from "../support/factories";

afterAll(() => testDb.$disconnect());

describe("reference seed", () => {
  it("creates the six system roles", async () => {
    const roles = await testDb.role.findMany();
    expect(roles.map((r) => r.key).sort()).toEqual([...ROLE_KEYS].sort());
    expect(roles.find((r) => r.key === "OWNER")?.isOwner).toBe(true);
    expect(roles.filter((r) => r.isOwner)).toHaveLength(1);
  });

  it("stores the default grants for every non-owner role", async () => {
    for (const [roleKey, grants] of Object.entries(DEFAULT_ROLE_GRANTS)) {
      const role = await testDb.role.findUniqueOrThrow({ where: { key: roleKey }, include: { permissions: true } });
      const stored = Object.fromEntries(role.permissions.map((p) => [p.permission, p.scope]));
      expect(stored).toEqual(grants);
    }
  });

  it("gives the Owner role no stored rows: owners always have everything", async () => {
    const owner = await testDb.role.findUniqueOrThrow({ where: { key: "OWNER" }, include: { permissions: true } });
    expect(owner.permissions).toHaveLength(0);
  });

  it("colours every vendor department and booking type", async () => {
    const cats = await testDb.vendorCategory.findMany();
    expect(cats.length).toBeGreaterThanOrEqual(12);
    for (const c of cats) expect(c.color).toMatch(/^#[0-9A-F]{6}$/i);
    const wedding = await testDb.eventCategory.findUniqueOrThrow({ where: { name: "Wedding" }, include: { defaultTemplate: { include: { items: true } } } });
    expect(wedding.defaultTemplate?.items.length).toBeGreaterThan(5);
  });

  it("does not add demo data when SEED_DEMO=false", async () => {
    expect(await testDb.user.count({ where: { email: { endsWith: "@demo.taamara.in" } } })).toBe(0);
  });
});
