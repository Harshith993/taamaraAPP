/**
 * The policy layer: every read and write goes through these checks on the server.
 *
 *   can(actor, "bookings.view")             → may they do it at all?
 *   eventWhere(actor, "bookings.view")      → which bookings (as a database filter)?
 *
 * Filters follow the access paths in ARCHITECTURE.md §5: managers and supervisors reach a booking through
 * EventMember, vendors through VendorAssignment, crew through CrewAssignment.
 */
import type { Prisma } from "@/generated/prisma/client";
import { ForbiddenError } from "@/lib/errors";
import type { Actor } from "./actor";
import type { PermissionKey, Scope } from "./permissions";

export function scopeOf(actor: Actor, permission: PermissionKey): Scope | null {
  if (actor.status !== "ACTIVE") return null;
  return actor.grants.get(permission) ?? null;
}

export function can(actor: Actor, permission: PermissionKey): boolean {
  return scopeOf(actor, permission) !== null;
}

export function assertCan(actor: Actor, permission: PermissionKey, message?: string): Scope {
  const scope = scopeOf(actor, permission);
  if (!scope) throw new ForbiddenError(message);
  return scope;
}

/** A filter that matches nothing: used when someone has no access, so a mistake can never widen a query. */
const NOTHING = { id: { in: [] as string[] } };

const LIVE_VENDOR_STATUSES = { notIn: ["DECLINED", "CANCELLED"] } as Prisma.EnumVendorAssignmentStatusFilter;
const LIVE_CREW_STATUSES = { notIn: ["DECLINED", "CANCELLED"] } as Prisma.EnumCrewAssignmentStatusFilter;

/** Bookings the actor may see for a permission. */
export function eventWhere(actor: Actor, permission: PermissionKey = "bookings.view"): Prisma.EventWhereInput {
  const scope = scopeOf(actor, permission);
  if (!scope) return NOTHING;
  if (scope === "ALL") return {};
  switch (actor.accountType) {
    case "INTERNAL":
      return { members: { some: { userId: actor.userId } } };
    case "VENDOR":
      return actor.vendorIds.length
        ? { vendorAssignments: { some: { vendorId: { in: actor.vendorIds }, status: LIVE_VENDOR_STATUSES } } }
        : NOTHING;
    case "LABOUR":
      return actor.workerId ? { crewAssignments: { some: { workerId: actor.workerId, status: LIVE_CREW_STATUSES } } } : NOTHING;
  }
}

/** Vendor assignments (jobs) the actor may see. Vendors only ever see their own. */
export function vendorAssignmentWhere(actor: Actor, permission: PermissionKey = "bookings.view"): Prisma.VendorAssignmentWhereInput {
  const scope = scopeOf(actor, permission);
  if (!scope) return NOTHING;
  if (actor.accountType === "VENDOR") return actor.vendorIds.length ? { vendorId: { in: actor.vendorIds } } : NOTHING;
  if (actor.accountType === "LABOUR") return NOTHING;
  if (scope === "ALL") return {};
  return { event: { members: { some: { userId: actor.userId } } } };
}

/** Crew assignments the actor may see. Crew only ever see their own. */
export function crewAssignmentWhere(actor: Actor, permission: PermissionKey = "bookings.view"): Prisma.CrewAssignmentWhereInput {
  const scope = scopeOf(actor, permission);
  if (!scope) return NOTHING;
  if (actor.accountType === "LABOUR") return actor.workerId ? { workerId: actor.workerId } : NOTHING;
  if (actor.accountType === "VENDOR") return NOTHING;
  if (scope === "ALL") return {};
  return { event: { members: { some: { userId: actor.userId } } } };
}

/** Tasks the actor may see or update: their own, plus (for staff) every task on bookings they can reach. */
export function taskWhere(actor: Actor, permission: PermissionKey = "tasks.update"): Prisma.TaskWhereInput {
  const scope = scopeOf(actor, permission);
  if (!scope) return NOTHING;
  if (scope === "ALL") return {};
  const own: Prisma.TaskWhereInput = { assigneeId: actor.userId };
  if (scope === "OWN" || actor.accountType !== "INTERNAL") return own;
  return { OR: [own, { event: { members: { some: { userId: actor.userId } } } }] };
}

/** Work proof the actor may see: staff by booking, vendors and crew only what they uploaded or what is about their work. */
export function proofWhere(actor: Actor, permission: PermissionKey = "proof.view"): Prisma.WorkProofWhereInput {
  const scope = scopeOf(actor, permission);
  if (!scope) return NOTHING;
  if (actor.accountType === "VENDOR") {
    return actor.vendorIds.length
      ? { OR: [{ uploadedById: actor.userId }, { vendorAssignment: { vendorId: { in: actor.vendorIds } } }] }
      : { uploadedById: actor.userId };
  }
  if (actor.accountType === "LABOUR") {
    return actor.workerId
      ? { OR: [{ uploadedById: actor.userId }, { crewAssignment: { workerId: actor.workerId } }] }
      : { uploadedById: actor.userId };
  }
  if (scope === "ALL") return {};
  return { event: { members: { some: { userId: actor.userId } } } };
}

/** Payments whose status the actor may see. */
export function paymentWhere(actor: Actor, permission: PermissionKey = "payments.status"): Prisma.PaymentWhereInput {
  const scope = scopeOf(actor, permission);
  if (!scope) return NOTHING;
  if (actor.accountType === "VENDOR") return actor.vendorIds.length ? { direction: "OUT", vendorId: { in: actor.vendorIds } } : NOTHING;
  if (actor.accountType === "LABOUR") return actor.workerId ? { direction: "OUT", workerId: actor.workerId } : NOTHING;
  if (scope === "ALL") return {};
  // Managers see the status of what is paid out for their bookings, never client receipts.
  return { direction: "OUT", event: { members: { some: { userId: actor.userId } } } };
}

/** Cash advances (D57): hosts and the accountant see every one; a manager or supervisor sees the ones they carry. */
export function cashAdvanceWhere(actor: Actor): Prisma.CashAdvanceWhereInput {
  if (actor.status !== "ACTIVE" || actor.accountType !== "INTERNAL") return NOTHING;
  if (scopeOf(actor, "payments.prepare") === "ALL" || scopeOf(actor, "finance.company") === "ALL") return {};
  if (can(actor, "expenses.record")) return { userId: actor.userId };
  return NOTHING;
}

/** Throws unless the actor can reach this booking for the permission. */
export async function assertEventAccess(
  db: { event: { count(args: { where: Prisma.EventWhereInput }): Promise<number> } },
  actor: Actor,
  eventId: string,
  permission: PermissionKey = "bookings.view",
): Promise<void> {
  const n = await db.event.count({ where: { AND: [{ id: eventId }, eventWhere(actor, permission)] } });
  if (n === 0) throw new ForbiddenError("You don't have access to this booking.");
}
