"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { toActionError, type ActionResult } from "@/lib/errors";
import { requestMeta, requireActor } from "@/modules/identity/session";
import { cancelJob, inviteVendor, issueWorkOrder, signOffJob, type InviteVendorInput } from "@/modules/vendors/jobs";

function refresh(eventId: string) {
  revalidatePath(`/bookings/${eventId}`);
}

export async function inviteVendorAction(input: InviteVendorInput): Promise<ActionResult> {
  const actor = await requireActor();
  try {
    await inviteVendor(db, actor, input, await requestMeta());
    refresh(input.eventId);
    return { ok: true, message: "Asked for a quote. The vendor sees it in their app." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function issueWorkOrderAction(eventId: string, jobId: string, terms: string): Promise<ActionResult> {
  const actor = await requireActor();
  try {
    const wo = await issueWorkOrder(db, actor, jobId, terms, await requestMeta());
    refresh(eventId);
    return { ok: true, message: `${wo.number} sent to the vendor.` };
  } catch (err) {
    return toActionError(err);
  }
}

export async function signOffJobAction(eventId: string, jobId: string): Promise<ActionResult> {
  const actor = await requireActor();
  try {
    await signOffJob(db, actor, jobId, await requestMeta());
    refresh(eventId);
    return { ok: true, message: "Signed off." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function cancelJobAction(eventId: string, jobId: string, reason: string): Promise<ActionResult> {
  const actor = await requireActor();
  try {
    await cancelJob(db, actor, jobId, reason, await requestMeta());
    refresh(eventId);
    return { ok: true, message: "Withdrawn. The vendor has been told." };
  } catch (err) {
    return toActionError(err);
  }
}
