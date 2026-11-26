"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { toActionError, type ActionResult } from "@/lib/errors";
import { bookEquipment, cancelEquipmentBooking, checkInEquipment, checkOutEquipment, resolveEquipmentIssue, saveEquipmentItem, type BookEquipmentInput, type ItemInput } from "@/modules/equipment/service";
import { requestMeta, requireActor } from "@/modules/identity/session";

const refresh = () => revalidatePath("/", "layout");

async function run(fn: () => Promise<unknown>, message: string): Promise<ActionResult> {
  try {
    await fn();
    refresh();
    return { ok: true, message };
  } catch (err) {
    return toActionError(err);
  }
}

export async function saveEquipmentItemAction(input: ItemInput): Promise<ActionResult> {
  const actor = await requireActor();
  return run(async () => saveEquipmentItem(db, actor, input, await requestMeta()), input.id ? "Saved." : "Added to the register.");
}

export async function bookEquipmentAction(input: BookEquipmentInput): Promise<ActionResult> {
  const actor = await requireActor();
  try {
    const r = await bookEquipment(db, actor, input, await requestMeta());
    refresh();
    return { ok: true, message: r.warning ? `Booked. ${r.warning}` : "Booked for these dates." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function cancelEquipmentBookingAction(id: string, reason: string): Promise<ActionResult> {
  const actor = await requireActor();
  return run(async () => cancelEquipmentBooking(db, actor, id, reason, await requestMeta()), "Cancelled.");
}

export async function checkOutEquipmentAction(id: string, note: string): Promise<ActionResult> {
  const actor = await requireActor();
  return run(async () => checkOutEquipment(db, actor, id, { note: note || undefined }, await requestMeta()), "Checked out.");
}

export async function checkInEquipmentAction(id: string, input: { good: string; damaged: string; missing: string; note: string }): Promise<ActionResult> {
  const actor = await requireActor();
  return run(async () => checkInEquipment(db, actor, id, { good: input.good, damaged: input.damaged || 0, missing: input.missing || 0, note: input.note || undefined }, await requestMeta()), "Checked in.");
}

export async function resolveEquipmentIssueAction(id: string, note: string): Promise<ActionResult> {
  const actor = await requireActor();
  return run(async () => resolveEquipmentIssue(db, actor, id, note, await requestMeta()), "Settled.");
}
