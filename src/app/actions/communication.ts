"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { toActionError, type ActionResult } from "@/lib/errors";
import { acknowledge, sendAnnouncement, type AnnouncementInput } from "@/modules/communication/announcements";
import { deleteMessage, postMessage } from "@/modules/communication/chat";
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

export async function sendAnnouncementAction(input: AnnouncementInput) {
  const actor = await requireActor();
  return run(async () => sendAnnouncement(db, actor, input, await requestMeta()), "Sent. Everyone it is for has been told.");
}

export async function acknowledgeAction(announcementId: string) {
  const actor = await requireActor();
  return run(() => acknowledge(db, actor, announcementId), "Thanks, noted.");
}

export async function postMessageAction(channelId: string, body: string, fileId?: string) {
  const actor = await requireActor();
  return run(() => postMessage(db, actor, channelId, { body, fileId }), "Sent.");
}

export async function deleteMessageAction(messageId: string) {
  const actor = await requireActor();
  return run(() => deleteMessage(db, actor, messageId), "Removed.");
}
