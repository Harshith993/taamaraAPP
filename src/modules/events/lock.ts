/**
 * A settled booking is locked: its money can't change until an owner reopens it (Phase 7).
 * Services call this first for a clear message; database triggers are the backstop
 * (migration 20261118084657_booking_settlement).
 */
import type { DbTx } from "@/lib/db";
import { ConflictError } from "@/lib/errors";

export const SETTLED_MESSAGE = "This booking is settled. A host has to reopen it before its money can change.";

export async function assertBookingOpen(tx: DbTx, eventId: string | null | undefined) {
  if (!eventId) return;
  const ev = await tx.event.findUnique({ where: { id: eventId }, select: { status: true } });
  if (ev?.status === "SETTLED") throw new ConflictError(SETTLED_MESSAGE);
}
