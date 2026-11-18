"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { toActionError, type ActionResult } from "@/lib/errors";
import { assignCrew, markAttendance, removeCrew, respondToBooking, selfCheckIn, type AssignCrewInput } from "@/modules/crew/service";
import { requestMeta, requireActor } from "@/modules/identity/session";

const refresh = () => revalidatePath("/", "layout");

export async function assignCrewAction(input: AssignCrewInput): Promise<ActionResult> {
  const actor = await requireActor();
  try {
    const r = await assignCrew(db, actor, input, await requestMeta());
    refresh();
    return { ok: true, message: r.warning ? `Added. Note: ${r.warning}` : "Added. They are asked to accept on their phone." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function removeCrewAction(assignmentId: string, reason: string): Promise<ActionResult> {
  const actor = await requireActor();
  try {
    await removeCrew(db, actor, assignmentId, reason, await requestMeta());
    refresh();
    return { ok: true, message: "Taken off the booking. They have been told." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function respondToBookingAction(assignmentId: string, accept: boolean, reason: string): Promise<ActionResult> {
  const actor = await requireActor();
  try {
    await respondToBooking(db, actor, assignmentId, accept, reason, await requestMeta());
    refresh();
    return { ok: true, message: accept ? "Accepted. See you there!" : "Declined. The manager has been told." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function markAttendanceAction(shiftId: string, status: "PRESENT" | "LATE" | "ABSENT" | "PENDING"): Promise<ActionResult> {
  const actor = await requireActor();
  try {
    await markAttendance(db, actor, shiftId, status, await requestMeta());
    refresh();
    return { ok: true };
  } catch (err) {
    return toActionError(err);
  }
}

export async function selfCheckInAction(shiftId: string, latitude?: number, longitude?: number): Promise<ActionResult> {
  const actor = await requireActor();
  try {
    const r = await selfCheckIn(db, actor, shiftId, { latitude, longitude }, await requestMeta());
    refresh();
    return { ok: true, message: r.status === "LATE" ? "Checked in (late). Please find your supervisor." : "Checked in. Thank you!" };
  } catch (err) {
    return toActionError(err);
  }
}
