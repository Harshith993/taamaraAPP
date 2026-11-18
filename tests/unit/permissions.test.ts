import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROLE_GRANTS,
  PERMISSIONS,
  PERMISSION_KEYS,
  ROLES,
  getPermission,
  validateGrant,
  widerScope,
  type PermissionKey,
} from "@/modules/identity/permissions";

const grants = DEFAULT_ROLE_GRANTS;
const has = (role: keyof typeof grants, key: PermissionKey) => Boolean(grants[role][key]);

describe("permission catalogue", () => {
  it("has unique keys", () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
  });

  it("every default grant is allowed by the catalogue", () => {
    for (const [roleKey, roleGrants] of Object.entries(grants)) {
      const accountType = ROLES[roleKey as keyof typeof ROLES].accountType;
      for (const [key, scope] of Object.entries(roleGrants)) {
        expect(validateGrant(key, scope!, accountType), `${roleKey} → ${key}`).toBeNull();
      }
    }
  });

  it("rejects unknown keys, wrong scopes and wrong account types", () => {
    expect(validateGrant("nope.nothing", "ALL", "INTERNAL")).toMatch(/Unknown/);
    expect(validateGrant("quotes.approve", "ASSIGNED", "INTERNAL")).toMatch(/scope/);
    expect(validateGrant("finance.company", "ALL", "VENDOR")).toMatch(/vendor/);
  });

  it("marks money permissions as financial", () => {
    for (const key of ["finance.company", "finance.billing", "quotes.view", "crew.pay.view", "payments.status", "vendors.bank"] as const) {
      expect(getPermission(key)?.financial, key).toBe(true);
    }
    expect(getPermission("bookings.view")?.financial).toBeFalsy();
  });

  it("widerScope picks the broader scope", () => {
    expect(widerScope("OWN", "ALL")).toBe("ALL");
    expect(widerScope("ASSIGNED", "OWN")).toBe("ASSIGNED");
    expect(widerScope(undefined, "OWN")).toBe("OWN");
    expect(widerScope(undefined, undefined)).toBeUndefined();
  });
});

describe("hard rules from the approved matrix", () => {
  it("event managers never see client billing, margin, company totals or vendor bank details", () => {
    for (const key of ["finance.billing", "finance.company", "vendors.bank", "payments.recordIn", "invoices.client", "approvals.decide"] as const) {
      expect(has("EVENT_MANAGER", key), key).toBe(false);
    }
    expect(grants.EVENT_MANAGER["bookings.view"]).toBe("ASSIGNED");
  });

  it("supervisors never see client billing, vendor quotes or anyone's pay", () => {
    for (const key of ["finance.billing", "finance.company", "finance.budget", "quotes.view", "crew.pay.view", "payments.status"] as const) {
      expect(has("SUPERVISOR", key), key).toBe(false);
    }
  });

  it("vendors only ever see their own records and nothing about crew or clients", () => {
    for (const [key, scope] of Object.entries(grants.VENDOR)) {
      expect(scope === "OWN" || (key === "bookings.view" && scope === "ASSIGNED"), key).toBe(true);
    }
    for (const key of ["crew.view", "crew.pay.view", "clients.view", "finance.budget", "finance.billing"] as const) {
      expect(has("VENDOR", key), key).toBe(false);
    }
  });

  it("crew never see client details, budgets, vendors or other people's pay", () => {
    for (const [key, scope] of Object.entries(grants.LABOUR)) {
      expect(scope === "OWN" || (key === "bookings.view" && scope === "ASSIGNED"), key).toBe(true);
    }
    for (const key of ["clients.view", "finance.budget", "vendors.view", "quotes.view"] as const) {
      expect(has("LABOUR", key), key).toBe(false);
    }
  });

  it("only owners approve money and manage users", () => {
    for (const role of Object.keys(grants) as (keyof typeof grants)[]) {
      expect(has(role, "approvals.decide"), role).toBe(false);
      expect(has(role, "quotes.approve"), role).toBe(false);
      expect(has(role, "admin.users"), role).toBe(false);
    }
  });

  it("the accountant prepares payments but does not approve them", () => {
    expect(has("ACCOUNTANT", "payments.prepare")).toBe(true);
    expect(has("ACCOUNTANT", "payments.markPaid")).toBe(true);
    expect(has("ACCOUNTANT", "approvals.decide")).toBe(false);
  });

  it("covers every permission in the catalogue somewhere (or it is owner-only)", () => {
    const ownerOnly = new Set(["bookings.assignTeam", "bookings.cancel", "bookings.delete", "quotes.approve", "approvals.decide", "documents.confidential", "admin.users", "admin.settings", "audit.view"]);
    for (const p of PERMISSIONS) {
      const granted = Object.values(grants).some((g) => (g as Record<string, unknown>)[p.key]);
      expect(granted || ownerOnly.has(p.key), p.key).toBe(true);
    }
  });
});
