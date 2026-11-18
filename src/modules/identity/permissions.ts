/**
 * The permission catalogue and the default role matrix (docs/ARCHITECTURE.md §6, v1.1).
 *
 * - Every permission has a key "area.action", the scopes it can take and the account types allowed to hold it.
 * - ALL      = every record
 * - ASSIGNED = only bookings the person is linked to (EventMember for staff, VendorAssignment for vendors,
 *              CrewAssignment for crew)
 * - OWN      = only the person's own records (their tasks, their quotes, their pay…)
 * - The Owner role implicitly holds every permission with scope ALL and cannot be edited.
 * - Event Manager, Accountant and Supervisor defaults can be changed by owners; Vendor and Labour are fixed.
 *
 * Pure data: no imports, so the seed script, the server and tests can all use it.
 */

export type Scope = "ALL" | "ASSIGNED" | "OWN";
export type AccountTypeKey = "INTERNAL" | "VENDOR" | "LABOUR";

export interface PermissionDef {
  key: string;
  group: string;
  label: string;
  /** Scopes this permission can be granted with. */
  scopes: readonly Scope[];
  /** Account types that may hold it at all. */
  accountTypes: readonly AccountTypeKey[];
  /** Money-related: responses and audit entries are filtered for people without finance access. */
  financial?: boolean;
}

const INTERNAL = ["INTERNAL"] as const;
const ANYONE = ["INTERNAL", "VENDOR", "LABOUR"] as const;
const STAFF_AND_VENDORS = ["INTERNAL", "VENDOR"] as const;
const STAFF_AND_CREW = ["INTERNAL", "LABOUR"] as const;
const ALL_SCOPES = ["ALL", "ASSIGNED", "OWN"] as const;
const ALL_OR_ASSIGNED = ["ALL", "ASSIGNED"] as const;
const ONLY_ALL = ["ALL"] as const;
const ALL_OR_OWN = ["ALL", "OWN"] as const;

export const PERMISSIONS = [
  // Bookings & planning
  { key: "bookings.view", group: "Bookings & planning", label: "See bookings and functions", scopes: ALL_OR_ASSIGNED, accountTypes: ANYONE },
  { key: "bookings.create", group: "Bookings & planning", label: "Create bookings", scopes: ONLY_ALL, accountTypes: INTERNAL },
  { key: "bookings.edit", group: "Bookings & planning", label: "Edit booking details and functions", scopes: ALL_OR_ASSIGNED, accountTypes: INTERNAL },
  { key: "bookings.assignTeam", group: "Bookings & planning", label: "Assign managers and supervisors", scopes: ONLY_ALL, accountTypes: INTERNAL },
  { key: "bookings.cancel", group: "Bookings & planning", label: "Cancel bookings", scopes: ONLY_ALL, accountTypes: INTERNAL },
  { key: "bookings.delete", group: "Bookings & planning", label: "Delete bookings with no money recorded", scopes: ONLY_ALL, accountTypes: INTERNAL },
  { key: "schedule.view", group: "Bookings & planning", label: "See the schedule and run sheet", scopes: ALL_SCOPES, accountTypes: ANYONE },
  { key: "schedule.edit", group: "Bookings & planning", label: "Edit the schedule and run sheet", scopes: ALL_OR_ASSIGNED, accountTypes: INTERNAL },
  { key: "requirements.view", group: "Bookings & planning", label: "See requirements per function", scopes: ALL_SCOPES, accountTypes: STAFF_AND_VENDORS },
  { key: "requirements.edit", group: "Bookings & planning", label: "Edit requirements", scopes: ALL_OR_ASSIGNED, accountTypes: INTERNAL },
  { key: "clients.view", group: "Bookings & planning", label: "See client contact details", scopes: ALL_OR_ASSIGNED, accountTypes: INTERNAL },
  { key: "clients.edit", group: "Bookings & planning", label: "Add and edit clients", scopes: ALL_OR_ASSIGNED, accountTypes: INTERNAL },

  // Tasks
  { key: "tasks.create", group: "Tasks", label: "Create and assign tasks", scopes: ALL_OR_ASSIGNED, accountTypes: INTERNAL },
  { key: "tasks.update", group: "Tasks", label: "Update tasks", scopes: ALL_SCOPES, accountTypes: ANYONE },
  { key: "tasks.approve", group: "Tasks", label: "Approve completed work", scopes: ALL_OR_ASSIGNED, accountTypes: INTERNAL },

  // Work proof
  { key: "proof.upload", group: "Work proof", label: "Upload photos or videos of completed work", scopes: ALL_SCOPES, accountTypes: ANYONE },
  { key: "proof.view", group: "Work proof", label: "See work proof", scopes: ALL_SCOPES, accountTypes: ANYONE },
  { key: "proof.review", group: "Work proof", label: "Approve or reject proof", scopes: ALL_OR_ASSIGNED, accountTypes: INTERNAL },

  // Vendors
  { key: "vendors.view", group: "Vendors", label: "See the vendor directory", scopes: ALL_OR_OWN, accountTypes: STAFF_AND_VENDORS },
  { key: "vendors.create", group: "Vendors", label: "Add vendors", scopes: ONLY_ALL, accountTypes: INTERNAL },
  { key: "vendors.edit", group: "Vendors", label: "Edit vendors", scopes: ALL_OR_OWN, accountTypes: STAFF_AND_VENDORS },
  { key: "vendors.bank", group: "Vendors", label: "See and edit vendor bank and GST details", scopes: ALL_OR_OWN, accountTypes: STAFF_AND_VENDORS, financial: true },
  { key: "quotes.request", group: "Vendors", label: "Ask vendors for quotes", scopes: ALL_OR_ASSIGNED, accountTypes: INTERNAL },
  { key: "quotes.submit", group: "Vendors", label: "Submit quotes and invoices", scopes: ALL_OR_OWN, accountTypes: STAFF_AND_VENDORS, financial: true },
  { key: "quotes.view", group: "Vendors", label: "See quote amounts", scopes: ALL_SCOPES, accountTypes: STAFF_AND_VENDORS, financial: true },
  { key: "quotes.approve", group: "Vendors", label: "Approve quotes", scopes: ONLY_ALL, accountTypes: INTERNAL, financial: true },
  { key: "jobs.respond", group: "Vendors", label: "Accept or decline work", scopes: ["OWN"], accountTypes: ["VENDOR"] },
  { key: "workOrders.issue", group: "Vendors", label: "Issue work orders", scopes: ALL_OR_ASSIGNED, accountTypes: INTERNAL, financial: true },
  { key: "vendors.rate", group: "Vendors", label: "Rate vendors", scopes: ALL_OR_ASSIGNED, accountTypes: INTERNAL },

  // Crew
  { key: "crew.view", group: "Crew", label: "See the crew directory", scopes: ALL_OR_OWN, accountTypes: STAFF_AND_CREW },
  { key: "crew.create", group: "Crew", label: "Register crew", scopes: ONLY_ALL, accountTypes: INTERNAL },
  { key: "crew.edit", group: "Crew", label: "Edit crew details", scopes: ALL_OR_OWN, accountTypes: STAFF_AND_CREW },
  { key: "crew.assign", group: "Crew", label: "Assign crew to bookings and shifts", scopes: ALL_OR_ASSIGNED, accountTypes: INTERNAL },
  { key: "attendance.mark", group: "Crew", label: "Mark attendance", scopes: ALL_SCOPES, accountTypes: STAFF_AND_CREW },
  { key: "crew.pay.view", group: "Crew", label: "See per-event pay", scopes: ALL_SCOPES, accountTypes: STAFF_AND_CREW, financial: true },

  // Money
  { key: "finance.company", group: "Money", label: "See company revenue, expenses and P&L", scopes: ONLY_ALL, accountTypes: INTERNAL, financial: true },
  { key: "finance.billing", group: "Money", label: "See client billing and margin", scopes: ONLY_ALL, accountTypes: INTERNAL, financial: true },
  { key: "finance.budget", group: "Money", label: "See booking budgets (costs)", scopes: ALL_OR_ASSIGNED, accountTypes: INTERNAL, financial: true },
  { key: "expenses.record", group: "Money", label: "Record expenses with receipts", scopes: ALL_OR_ASSIGNED, accountTypes: INTERNAL, financial: true },
  { key: "payments.recordIn", group: "Money", label: "Record client payments", scopes: ONLY_ALL, accountTypes: INTERNAL, financial: true },
  { key: "invoices.client", group: "Money", label: "Create client invoices", scopes: ONLY_ALL, accountTypes: INTERNAL, financial: true },
  { key: "approvals.decide", group: "Money", label: "Approve payments, expenses, quotes and crew extras", scopes: ONLY_ALL, accountTypes: INTERNAL, financial: true },
  { key: "payments.prepare", group: "Money", label: "Prepare payments for approval", scopes: ONLY_ALL, accountTypes: INTERNAL, financial: true },
  { key: "payments.markPaid", group: "Money", label: "Mark approved payments as paid", scopes: ONLY_ALL, accountTypes: INTERNAL, financial: true },
  { key: "payments.status", group: "Money", label: "See payment status", scopes: ALL_SCOPES, accountTypes: ANYONE, financial: true },
  { key: "reports.finance", group: "Money", label: "Financial reports and exports", scopes: ONLY_ALL, accountTypes: INTERNAL, financial: true },

  // Documents & communication
  { key: "documents.view", group: "Documents & communication", label: "See booking documents", scopes: ALL_SCOPES, accountTypes: ANYONE },
  { key: "documents.upload", group: "Documents & communication", label: "Upload documents", scopes: ALL_SCOPES, accountTypes: ANYONE },
  { key: "documents.confidential", group: "Documents & communication", label: "See owner-only documents", scopes: ONLY_ALL, accountTypes: INTERNAL },
  { key: "chat.booking", group: "Documents & communication", label: "Booking team chat", scopes: ALL_OR_ASSIGNED, accountTypes: INTERNAL },
  { key: "chat.direct", group: "Documents & communication", label: "Direct threads", scopes: ALL_SCOPES, accountTypes: ANYONE },
  { key: "announcements.send", group: "Documents & communication", label: "Send announcements", scopes: ALL_OR_ASSIGNED, accountTypes: INTERNAL },

  // Administration
  { key: "admin.users", group: "Administration", label: "Manage users and roles", scopes: ONLY_ALL, accountTypes: INTERNAL },
  { key: "admin.settings", group: "Administration", label: "Change settings and lists", scopes: ONLY_ALL, accountTypes: INTERNAL },
  { key: "admin.taxSettings", group: "Administration", label: "Change GST and numbering settings", scopes: ONLY_ALL, accountTypes: INTERNAL, financial: true },
  { key: "audit.view", group: "Administration", label: "See the full audit log", scopes: ONLY_ALL, accountTypes: INTERNAL },
  { key: "audit.viewFinancial", group: "Administration", label: "See financial audit entries", scopes: ONLY_ALL, accountTypes: INTERNAL, financial: true },
  { key: "reports.ops", group: "Administration", label: "Operations reports", scopes: ALL_OR_ASSIGNED, accountTypes: INTERNAL },
] as const satisfies readonly PermissionDef[];

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSIONS.map((p) => p.key);

/** The catalogue typed loosely, for looping and filtering. */
export const PERMISSION_LIST: readonly PermissionDef[] = PERMISSIONS;

const BY_KEY = new Map<string, PermissionDef>(PERMISSION_LIST.map((p) => [p.key, p]));

export function getPermission(key: string): PermissionDef | undefined {
  return BY_KEY.get(key);
}

export function isPermissionKey(key: string): key is PermissionKey {
  return BY_KEY.has(key);
}

export const ROLE_KEYS = ["OWNER", "EVENT_MANAGER", "ACCOUNTANT", "SUPERVISOR", "VENDOR", "LABOUR"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export interface RoleDef {
  key: RoleKey;
  name: string;
  description: string;
  accountType: AccountTypeKey;
  isOwner: boolean;
  /** Owners may change this role's permissions. */
  editable: boolean;
}

export const ROLES: Record<RoleKey, RoleDef> = {
  OWNER: { key: "OWNER", name: "Owner", description: "Founder and co-founder. Full access to everything; cannot be restricted.", accountType: "INTERNAL", isOwner: true, editable: false },
  EVENT_MANAGER: { key: "EVENT_MANAGER", name: "Event Manager", description: "Runs the bookings assigned to them. Never sees client billing or margin.", accountType: "INTERNAL", isOwner: false, editable: true },
  ACCOUNTANT: { key: "ACCOUNTANT", name: "Accountant", description: "Client billing, vendor invoices, payments and exports.", accountType: "INTERNAL", isOwner: false, editable: true },
  SUPERVISOR: { key: "SUPERVISOR", name: "Supervisor", description: "On site on event days: run sheet, attendance, proof review.", accountType: "INTERNAL", isOwner: false, editable: true },
  VENDOR: { key: "VENDOR", name: "Vendor", description: "Sees only their own jobs, quotes, invoices and payments.", accountType: "VENDOR", isOwner: false, editable: false },
  LABOUR: { key: "LABOUR", name: "Crew", description: "Sees only their own shifts, tasks and (if allowed) pay.", accountType: "LABOUR", isOwner: false, editable: false },
};

type Grants = Partial<Record<PermissionKey, Scope>>;

/** Default matrix for every role except Owner (who has everything). Mirrors ARCHITECTURE.md §6 v1.1. */
export const DEFAULT_ROLE_GRANTS: Record<Exclude<RoleKey, "OWNER">, Grants> = {
  EVENT_MANAGER: {
    "bookings.view": "ASSIGNED",
    "bookings.create": "ALL",
    "bookings.edit": "ASSIGNED",
    "schedule.view": "ASSIGNED",
    "schedule.edit": "ASSIGNED",
    "requirements.view": "ASSIGNED",
    "requirements.edit": "ASSIGNED",
    "clients.view": "ASSIGNED",
    "clients.edit": "ASSIGNED",
    "tasks.create": "ASSIGNED",
    "tasks.update": "ASSIGNED",
    "tasks.approve": "ASSIGNED",
    "proof.upload": "ASSIGNED",
    "proof.view": "ASSIGNED",
    "proof.review": "ASSIGNED",
    "vendors.view": "ALL",
    "vendors.create": "ALL",
    "quotes.request": "ASSIGNED",
    "quotes.view": "ASSIGNED",
    "workOrders.issue": "ASSIGNED",
    "vendors.rate": "ASSIGNED",
    "crew.view": "ALL",
    "crew.create": "ALL",
    "crew.edit": "ALL",
    "crew.assign": "ASSIGNED",
    "attendance.mark": "ASSIGNED",
    "crew.pay.view": "ASSIGNED",
    "finance.budget": "ASSIGNED",
    "expenses.record": "ASSIGNED",
    "payments.status": "ASSIGNED",
    "documents.view": "ASSIGNED",
    "documents.upload": "ASSIGNED",
    "chat.booking": "ASSIGNED",
    "chat.direct": "ASSIGNED",
    "announcements.send": "ASSIGNED",
    "reports.ops": "ASSIGNED",
  },
  ACCOUNTANT: {
    "bookings.view": "ALL",
    "schedule.view": "ALL",
    "requirements.view": "ALL",
    "clients.view": "ALL",
    "tasks.update": "OWN",
    "proof.view": "ALL",
    "vendors.view": "ALL",
    "vendors.bank": "ALL",
    "quotes.submit": "ALL",
    "quotes.view": "ALL",
    "crew.view": "ALL",
    "crew.pay.view": "ALL",
    "finance.company": "ALL",
    "finance.billing": "ALL",
    "finance.budget": "ALL",
    "expenses.record": "ALL",
    "payments.recordIn": "ALL",
    "invoices.client": "ALL",
    "payments.prepare": "ALL",
    "payments.markPaid": "ALL",
    "payments.status": "ALL",
    "reports.finance": "ALL",
    "documents.view": "ALL",
    "documents.upload": "ALL",
    "chat.direct": "OWN",
    "admin.taxSettings": "ALL",
    "audit.viewFinancial": "ALL",
  },
  SUPERVISOR: {
    "bookings.view": "ASSIGNED",
    "schedule.view": "ASSIGNED",
    "requirements.view": "ASSIGNED",
    "clients.view": "ASSIGNED",
    "tasks.create": "ASSIGNED",
    "tasks.update": "ASSIGNED",
    "tasks.approve": "ASSIGNED",
    "proof.upload": "ASSIGNED",
    "proof.view": "ASSIGNED",
    "proof.review": "ASSIGNED",
    "vendors.view": "ALL",
    "vendors.rate": "ASSIGNED",
    "crew.view": "ALL",
    "crew.create": "ALL",
    "attendance.mark": "ASSIGNED",
    "expenses.record": "ASSIGNED",
    "documents.view": "ASSIGNED",
    "documents.upload": "ASSIGNED",
    "chat.booking": "ASSIGNED",
    "chat.direct": "ASSIGNED",
    "announcements.send": "ASSIGNED",
  },
  VENDOR: {
    "bookings.view": "ASSIGNED",
    "schedule.view": "OWN",
    "requirements.view": "OWN",
    "tasks.update": "OWN",
    "proof.upload": "OWN",
    "proof.view": "OWN",
    "vendors.view": "OWN",
    "vendors.edit": "OWN",
    "vendors.bank": "OWN",
    "quotes.submit": "OWN",
    "quotes.view": "OWN",
    "jobs.respond": "OWN",
    "payments.status": "OWN",
    "documents.view": "OWN",
    "documents.upload": "OWN",
    "chat.direct": "OWN",
  },
  LABOUR: {
    "bookings.view": "ASSIGNED",
    "schedule.view": "OWN",
    "tasks.update": "OWN",
    "proof.upload": "OWN",
    "proof.view": "OWN",
    "crew.view": "OWN",
    "crew.edit": "OWN",
    "attendance.mark": "OWN",
    "crew.pay.view": "OWN",
    "payments.status": "OWN",
    "documents.view": "OWN",
    "documents.upload": "OWN",
    "chat.direct": "OWN",
  },
};

const SCOPE_RANK: Record<Scope, number> = { OWN: 1, ASSIGNED: 2, ALL: 3 };

/** The wider of two scopes (used when someone holds more than one role). */
export function widerScope(a: Scope | undefined, b: Scope | undefined): Scope | undefined {
  if (!a) return b;
  if (!b) return a;
  return SCOPE_RANK[a] >= SCOPE_RANK[b] ? a : b;
}

/** Checks that a grant is allowed by the catalogue (scope and account type). Returns a reason when it is not. */
export function validateGrant(key: string, scope: Scope, accountType: AccountTypeKey): string | null {
  const def = getPermission(key);
  if (!def) return `Unknown permission "${key}"`;
  if (!def.scopes.includes(scope)) return `"${def.label}" cannot be given with scope ${scope}`;
  if (!def.accountTypes.includes(accountType)) return `"${def.label}" cannot be given to ${accountType.toLowerCase()} accounts`;
  return null;
}
