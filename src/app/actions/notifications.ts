"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { markAllRead, notificationsPath, openNotification } from "@/modules/notifications/inbox";
import { requireActor } from "@/modules/identity/session";

/** Opens a notification: marks it read and goes where it points. */
export async function openNotificationAction(id: string) {
  const actor = await requireActor();
  const link = await openNotification(db, actor, id);
  revalidatePath("/", "layout");
  redirect(link ?? notificationsPath(actor));
}

export async function markAllReadAction() {
  const actor = await requireActor();
  await markAllRead(db, actor);
  revalidatePath("/", "layout");
}
