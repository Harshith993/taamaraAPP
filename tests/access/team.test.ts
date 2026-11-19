import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auth } from "@/lib/auth";
import { loadActor, type Actor } from "@/modules/identity/actor";
import { listRoles, updateRoleGrants } from "@/modules/identity/roles";
import { createUser, resetPassword, setUserRoles, setUserStatus } from "@/modules/identity/users";
import { DEFAULT_ROLE_GRANTS } from "@/modules/identity/permissions";
import { makeUser, makeVendor, testDb } from "../support/factories";

let owner: Actor;
let manager: Actor;

beforeAll(async () => {
  owner = (await loadActor(testDb, (await makeUser({ name: "Team Owner", roleKey: "OWNER" })).id))!;
  manager = (await loadActor(testDb, (await makeUser({ name: "Team Manager", roleKey: "EVENT_MANAGER" })).id))!;
});
afterAll(() => testDb.$disconnect());

const phone = () => `98${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

async function signInByPhone(phoneNumber: string, password: string) {
  return auth.api.signInPhoneNumber({ body: { phoneNumber, password } });
}

describe("adding people", () => {
  it("lets an owner add a manager who can then sign in with phone or email", async () => {
    const p = phone();
    const user = await createUser(testDb, owner, { name: "Neha Manager", phone: p, email: "neha.manager@test.taamara.in", roleKey: "EVENT_MANAGER", temporaryPassword: "Temp@12345" });
    expect(user.phoneNumber).toBe(`+91${p}`);
    expect(user.mustChangePassword).toBe(true);

    const byPhone = await signInByPhone(`+91${p}`, "Temp@12345");
    expect(byPhone.user.id).toBe(user.id);
    const byEmail = await auth.api.signInEmail({ body: { email: "neha.manager@test.taamara.in", password: "Temp@12345" } });
    expect(byEmail.user.id).toBe(user.id);
    await expect(signInByPhone(`+91${p}`, "wrong-password")).rejects.toThrow();

    const audit = await testDb.auditLog.findFirst({ where: { entityType: "user", entityId: user.id, action: "create" } });
    expect(audit?.summary).toMatch(/Added Neha Manager as Event Manager/);
  });

  it("creates a crew record for a new crew login and links vendor logins to their vendor", async () => {
    const crew = await createUser(testDb, owner, { name: "New Crew", phone: phone(), roleKey: "LABOUR", temporaryPassword: "Temp@12345" });
    expect(crew.accountType).toBe("LABOUR");
    expect(crew.hasRealEmail).toBe(false);
    expect(await testDb.worker.findUnique({ where: { userId: crew.id } })).not.toBeNull();

    const vendor = await makeVendor("Login Vendor");
    const vUser = await createUser(testDb, owner, { name: "Vendor Person", phone: phone(), roleKey: "VENDOR", vendorId: vendor.id, temporaryPassword: "Temp@12345" });
    const actor = (await loadActor(testDb, vUser.id))!;
    expect(actor.vendorIds).toEqual([vendor.id]);
  });

  it("refuses non-owners, duplicates, bad phones and vendor logins without a vendor", async () => {
    await expect(createUser(testDb, manager, { name: "X", phone: phone(), roleKey: "SUPERVISOR", temporaryPassword: "Temp@12345" })).rejects.toThrow(/Only hosts/);
    const p = phone();
    await createUser(testDb, owner, { name: "Once", phone: p, roleKey: "SUPERVISOR", temporaryPassword: "Temp@12345" });
    await expect(createUser(testDb, owner, { name: "Twice", phone: `0${p}`, roleKey: "SUPERVISOR", temporaryPassword: "Temp@12345" })).rejects.toThrow(/already uses this phone/);
    await expect(createUser(testDb, owner, { name: "Bad", phone: "12345", roleKey: "SUPERVISOR", temporaryPassword: "Temp@12345" })).rejects.toThrow(/doesn't look right/);
    await expect(createUser(testDb, owner, { name: "Vend", phone: phone(), roleKey: "VENDOR", temporaryPassword: "Temp@12345" })).rejects.toThrow(/Pick the vendor/);
    await expect(createUser(testDb, owner, { name: "Short", phone: phone(), roleKey: "SUPERVISOR", temporaryPassword: "short" })).rejects.toThrow(/at least 8/);
  });
});

describe("switching accounts off, resetting passwords, roles", () => {
  it("switching someone off signs them out everywhere and blocks new sign-ins", async () => {
    const p = phone();
    const user = await createUser(testDb, owner, { name: "Leaving", phone: p, roleKey: "SUPERVISOR", temporaryPassword: "Temp@12345" });
    await signInByPhone(`+91${p}`, "Temp@12345");
    expect(await testDb.session.count({ where: { userId: user.id } })).toBe(1);

    await setUserStatus(testDb, owner, user.id, "DISABLED");
    expect(await testDb.session.count({ where: { userId: user.id } })).toBe(0);
    await expect(signInByPhone(`+91${p}`, "Temp@12345")).rejects.toThrow(/switched off/);

    await setUserStatus(testDb, owner, user.id, "ACTIVE");
    await expect(signInByPhone(`+91${p}`, "Temp@12345")).resolves.toBeTruthy();
  });

  it("an owner cannot switch off themselves, and the last owner cannot be removed", async () => {
    await expect(setUserStatus(testDb, owner, owner.userId, "DISABLED")).rejects.toThrow(/your own account/);
    // Make this owner the only active one, then try to demote them.
    const others = await testDb.user.findMany({ where: { id: { not: owner.userId }, roles: { some: { role: { key: "OWNER" } } }, status: "ACTIVE" }, select: { id: true } });
    await testDb.user.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { status: "DISABLED" } });
    await expect(setUserRoles(testDb, owner, owner.userId, ["EVENT_MANAGER"])).rejects.toThrow(/at least one active host/);
    expect((await loadActor(testDb, owner.userId))!.isOwner).toBe(true);
    await testDb.user.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { status: "ACTIVE" } });
  });

  it("roles must match the kind of account", async () => {
    const crew = await createUser(testDb, owner, { name: "Crew Role", phone: phone(), roleKey: "LABOUR", temporaryPassword: "Temp@12345" });
    await expect(setUserRoles(testDb, owner, crew.id, ["EVENT_MANAGER"])).rejects.toThrow(/cannot be given/);
  });

  it("a password reset forces a new password and signs the person out", async () => {
    const p = phone();
    const user = await createUser(testDb, owner, { name: "Forgetful", phone: p, roleKey: "SUPERVISOR", temporaryPassword: "Temp@12345" });
    await testDb.user.update({ where: { id: user.id }, data: { mustChangePassword: false } });
    await signInByPhone(`+91${p}`, "Temp@12345");
    await resetPassword(testDb, owner, user.id, "Fresh@67890");
    expect(await testDb.session.count({ where: { userId: user.id } })).toBe(0);
    expect((await testDb.user.findUniqueOrThrow({ where: { id: user.id } })).mustChangePassword).toBe(true);
    await expect(signInByPhone(`+91${p}`, "Temp@12345")).rejects.toThrow();
    await expect(signInByPhone(`+91${p}`, "Fresh@67890")).resolves.toBeTruthy();
  });
});

describe("editing role permissions", () => {
  it("lets an owner change an editable role and records what changed", async () => {
    const next = { ...DEFAULT_ROLE_GRANTS.SUPERVISOR, "crew.pay.view": "ASSIGNED" as const };
    await updateRoleGrants(testDb, owner, "SUPERVISOR", next);
    const roles = await listRoles(testDb, owner);
    expect(roles.find((r) => r.key === "SUPERVISOR")?.grants["crew.pay.view"]).toBe("ASSIGNED");
    const entry = await testDb.auditLog.findFirst({ where: { entityType: "role", action: "permission_change" }, orderBy: { id: "desc" } });
    expect(entry?.summary).toMatch(/Supervisor: allowed See per-event pay/);
    await updateRoleGrants(testDb, owner, "SUPERVISOR", { ...DEFAULT_ROLE_GRANTS.SUPERVISOR });
  });

  it("refuses fixed roles, owner-only powers and invalid scopes", async () => {
    await expect(updateRoleGrants(testDb, owner, "OWNER", {})).rejects.toThrow(/fixed/);
    await expect(updateRoleGrants(testDb, owner, "VENDOR", {})).rejects.toThrow(/fixed/);
    await expect(updateRoleGrants(testDb, owner, "ACCOUNTANT", { "approvals.decide": "ALL" })).rejects.toThrow(/Only hosts/);
    await expect(updateRoleGrants(testDb, owner, "EVENT_MANAGER", { "quotes.approve": "ALL" })).rejects.toThrow(/Only hosts/);
    await expect(updateRoleGrants(testDb, owner, "EVENT_MANAGER", { "finance.company": "ASSIGNED" })).rejects.toThrow(/scope/);
    await expect(updateRoleGrants(testDb, manager, "SUPERVISOR", {})).rejects.toThrow(/Only hosts/);
  });

  it("takes effect the next time the person's access is loaded", async () => {
    const sup = await makeUser({ roleKey: "SUPERVISOR" });
    expect((await loadActor(testDb, sup.id))!.grants.has("crew.pay.view")).toBe(false);
    await updateRoleGrants(testDb, owner, "SUPERVISOR", { ...DEFAULT_ROLE_GRANTS.SUPERVISOR, "crew.pay.view": "ASSIGNED" });
    expect((await loadActor(testDb, sup.id))!.grants.get("crew.pay.view")).toBe("ASSIGNED");
    await updateRoleGrants(testDb, owner, "SUPERVISOR", { ...DEFAULT_ROLE_GRANTS.SUPERVISOR });
  });
});

describe("host and co-host", () => {
  it("the full-access role is shown as Host or Co-host; both have full access", async () => {
    expect(owner.hostTitle).toBe("Host");
    expect(manager.hostTitle).toBeNull();
    const u = await createUser(testDb, owner, { name: "Team Co-host", phone: "98765 01234", roleKey: "OWNER", hostTitle: "Co-host", temporaryPassword: "Temp@12345" });
    const cohost = (await loadActor(testDb, u.id))!;
    expect(cohost).toMatchObject({ isOwner: true, hostTitle: "Co-host" });
    // Changing someone to Host keeps full access and drops the Co-host title.
    await setUserRoles(testDb, owner, u.id, ["OWNER"], {}, "Host");
    expect((await loadActor(testDb, u.id))!.hostTitle).toBe("Host");
    await setUserRoles(testDb, owner, u.id, ["EVENT_MANAGER"]);
    expect((await testDb.user.findUniqueOrThrow({ where: { id: u.id } })).title).toBeNull();
    expect((await listRoles(testDb, owner)).find((r) => r.key === "OWNER")!.name).toBe("Host");
  });
});
