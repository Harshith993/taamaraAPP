/**
 * The "actor": who is making a request and what they may do. Loaded once per request from the database,
 * so permission changes and switched-off accounts take effect immediately.
 */
import type { DbTx } from "@/lib/db";
import {
  PERMISSION_LIST,
  ROLES,
  getPermission,
  isPermissionKey,
  widerScope,
  type AccountTypeKey,
  type PermissionKey,
  type RoleKey,
  type Scope,
} from "./permissions";

export interface CompanySwitches {
  crewCanSeePay: boolean;
  crewSelfCheckIn: boolean;
  proofFromGallery: boolean;
  maxVideoSeconds: number;
  finalVendorPaymentNeedsProof: boolean;
}

export const DEFAULT_SWITCHES: CompanySwitches = {
  crewCanSeePay: true,
  crewSelfCheckIn: false,
  proofFromGallery: true,
  maxVideoSeconds: 120,
  finalVendorPaymentNeedsProof: true,
};

export interface Actor {
  userId: string;
  name: string;
  email: string;
  hasRealEmail: boolean;
  phoneNumber: string | null;
  accountType: AccountTypeKey;
  status: "ACTIVE" | "DISABLED";
  mustChangePassword: boolean;
  isOwner: boolean;
  roles: RoleKey[];
  grants: ReadonlyMap<PermissionKey, Scope>;
  /** Vendor companies this login acts for (vendor accounts). */
  vendorIds: string[];
  /** The crew record of this login (labour accounts). */
  workerId: string | null;
  switches: CompanySwitches;
}

export function readSwitches(settings: unknown): CompanySwitches {
  const s = (settings && typeof settings === "object" ? settings : {}) as Partial<CompanySwitches>;
  return { ...DEFAULT_SWITCHES, ...s };
}

/** Builds the grant map from role rows, company switches and the account type. Pure, so it is easy to test. */
export function computeGrants(input: {
  isOwner: boolean;
  accountType: AccountTypeKey;
  rolePermissions: { permission: string; scope: Scope }[];
  switches: CompanySwitches;
}): Map<PermissionKey, Scope> {
  const grants = new Map<PermissionKey, Scope>();
  if (input.isOwner) {
    for (const p of PERMISSION_LIST) if (p.accountTypes.includes(input.accountType) && p.scopes.includes("ALL")) grants.set(p.key as PermissionKey, "ALL");
    return grants;
  }
  for (const { permission, scope } of input.rolePermissions) {
    if (!isPermissionKey(permission)) continue;
    const def = getPermission(permission)!;
    // Never trust stored rows beyond what the catalogue allows.
    if (!def.accountTypes.includes(input.accountType) || !def.scopes.includes(scope)) continue;
    // Vendor and crew logins never get "every record": the widest they can hold is their own (or, for
    // bookings, the ones they are booked on).
    let effective: Scope = scope;
    if (input.accountType !== "INTERNAL" && scope === "ALL") effective = permission === "bookings.view" ? "ASSIGNED" : "OWN";
    const merged = widerScope(grants.get(permission), effective);
    if (merged) grants.set(permission, merged);
  }
  if (input.accountType === "LABOUR") {
    if (!input.switches.crewCanSeePay) {
      grants.delete("crew.pay.view");
      grants.delete("payments.status");
    }
    if (!input.switches.crewSelfCheckIn) grants.delete("attendance.mark");
  }
  return grants;
}

export async function loadActor(db: DbTx, userId: string): Promise<Actor | null> {
  const [user, company] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      include: {
        roles: { include: { role: { include: { permissions: true } } } },
        vendorLinks: { select: { vendorId: true } },
        worker: { select: { id: true } },
      },
    }),
    db.companyProfile.findUnique({ where: { id: 1 }, select: { settings: true } }),
  ]);
  if (!user) return null;

  const switches = readSwitches(company?.settings);
  // Roles must match the account type (a vendor login can never carry an internal role).
  const roles = user.roles.filter((ur) => ur.role.accountType === user.accountType);
  const isOwner = user.accountType === "INTERNAL" && roles.some((ur) => ur.role.isOwner);
  const grants = computeGrants({
    isOwner,
    accountType: user.accountType,
    rolePermissions: roles.flatMap((ur) => ur.role.permissions.map((p) => ({ permission: p.permission, scope: p.scope }))),
    switches,
  });

  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    hasRealEmail: user.hasRealEmail,
    phoneNumber: user.phoneNumber,
    accountType: user.accountType,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    isOwner,
    roles: roles.map((ur) => ur.role.key as RoleKey).filter((k) => k in ROLES),
    grants,
    vendorIds: user.accountType === "VENDOR" ? user.vendorLinks.map((v) => v.vendorId) : [],
    workerId: user.accountType === "LABOUR" ? (user.worker?.id ?? null) : null,
    switches,
  };
}
