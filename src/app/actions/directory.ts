"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { db } from "@/lib/db";
import { toActionError, type ActionResult } from "@/lib/errors";
import { addUnavailable, removeUnavailable, saveWorker, type unavailableSchema, type WorkerInput } from "@/modules/crew/roster";
import { requestMeta, requireActor } from "@/modules/identity/session";
import { confirmVendorBank, saveVendor, saveVendorBank, updateOwnVendorProfile, type bankSchema, type ownProfileSchema, type VendorInput } from "@/modules/vendors/directory";

async function run<T>(fn: () => Promise<T>, message: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    revalidatePath("/", "layout");
    return { ok: true, data, message };
  } catch (err) {
    return toActionError(err);
  }
}

export async function saveVendorAction(input: VendorInput) {
  const actor = await requireActor();
  return run(async () => saveVendor(db, actor, input, await requestMeta()), input.id ? "Saved." : "Vendor added.");
}

export async function saveVendorBankAction(vendorId: string, input: z.input<typeof bankSchema>) {
  const actor = await requireActor();
  return run(async () => saveVendorBank(db, actor, vendorId, input, await requestMeta()), "Bank details saved.");
}

export async function saveWorkerAction(input: WorkerInput) {
  const actor = await requireActor();
  return run(async () => saveWorker(db, actor, input, await requestMeta()), input.id ? "Saved." : "Crew member registered.");
}

export async function addUnavailableAction(workerId: string, input: z.input<typeof unavailableSchema>) {
  const actor = await requireActor();
  return run(async () => addUnavailable(db, actor, workerId, input, await requestMeta()), "Day marked as not available.");
}

export async function removeUnavailableAction(workerId: string, id: string) {
  const actor = await requireActor();
  return run(async () => removeUnavailable(db, actor, workerId, id), "Removed.");
}

export async function confirmVendorBankAction(vendorId: string) {
  const actor = await requireActor();
  return run(async () => confirmVendorBank(db, actor, vendorId, await requestMeta()), "Confirmed. Payments can go ahead.");
}

export async function updateOwnProfileAction(input: z.input<typeof ownProfileSchema>) {
  const actor = await requireActor();
  return run(async () => updateOwnVendorProfile(db, actor, input, await requestMeta()), "Saved.");
}
