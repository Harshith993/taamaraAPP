"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { db } from "@/lib/db";
import { toActionError, type ActionResult } from "@/lib/errors";
import {
  cancelBooking,
  removeFunction,
  removeScheduleItem,
  saveFunction,
  saveRequirement,
  saveScheduleItem,
  setScheduleDone,
  setTeam,
  updateBookingDetails,
  type bookingDetailsSchema,
  type FunctionInput,
  type RequirementInput,
  type ScheduleItemInput,
} from "@/modules/events/planning";
import { requestMeta, requireActor } from "@/modules/identity/session";

async function run(fn: () => Promise<unknown>, message: string): Promise<ActionResult> {
  try {
    await fn();
    revalidatePath("/", "layout");
    return { ok: true, message };
  } catch (err) {
    return toActionError(err);
  }
}

export async function updateDetailsAction(eventId: string, input: z.input<typeof bookingDetailsSchema>) {
  const actor = await requireActor();
  return run(async () => updateBookingDetails(db, actor, eventId, input, await requestMeta()), "Saved.");
}

export async function cancelBookingAction(eventId: string, reason: string) {
  const actor = await requireActor();
  return run(async () => cancelBooking(db, actor, eventId, reason, await requestMeta()), "Booking cancelled. Everyone on it has been told.");
}

export async function saveFunctionAction(eventId: string, input: FunctionInput) {
  const actor = await requireActor();
  return run(async () => saveFunction(db, actor, eventId, input, await requestMeta()), input.id ? "Function saved." : "Function added.");
}

export async function removeFunctionAction(eventId: string, functionId: string) {
  const actor = await requireActor();
  return run(async () => removeFunction(db, actor, eventId, functionId, await requestMeta()), "Function removed.");
}

export async function setTeamAction(eventId: string, managerIds: string[], supervisorIds: string[]) {
  const actor = await requireActor();
  return run(async () => setTeam(db, actor, eventId, { managerIds, supervisorIds }, await requestMeta()), "Team saved. New people have been told.");
}

export async function saveScheduleItemAction(eventId: string, input: ScheduleItemInput) {
  const actor = await requireActor();
  return run(async () => saveScheduleItem(db, actor, eventId, input, await requestMeta()), input.id ? "Saved." : "Added to the run sheet.");
}

export async function removeScheduleItemAction(eventId: string, itemId: string) {
  const actor = await requireActor();
  return run(async () => removeScheduleItem(db, actor, eventId, itemId, await requestMeta()), "Removed.");
}

export async function setScheduleDoneAction(itemId: string, done: boolean) {
  const actor = await requireActor();
  return run(async () => setScheduleDone(db, actor, itemId, done), done ? "Done." : "Not done.");
}

export async function saveRequirementAction(eventId: string, input: RequirementInput) {
  const actor = await requireActor();
  return run(async () => saveRequirement(db, actor, eventId, input, await requestMeta()), input.id ? "Saved." : "Requirement added.");
}
