"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { toActionError, type ActionResult } from "@/lib/errors";
import { requestMeta, requireActor } from "@/modules/identity/session";
import { createTask, moveTask, reviewTask, type CreateTaskInput, type TaskMove } from "@/modules/tasks/service";

const refresh = () => revalidatePath("/", "layout");

export async function createTaskAction(input: CreateTaskInput): Promise<ActionResult> {
  const actor = await requireActor();
  try {
    await createTask(db, actor, input, await requestMeta());
    refresh();
    return { ok: true, message: "Task added." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function moveTaskAction(taskId: string, move: TaskMove): Promise<ActionResult<{ status: string }>> {
  const actor = await requireActor();
  try {
    const r = await moveTask(db, actor, taskId, move, await requestMeta());
    refresh();
    return { ok: true, data: r, message: r.status === "UNDER_REVIEW" ? "Done. Waiting for a check." : r.status === "COMPLETED" ? "Done." : "Started." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function reviewTaskAction(taskId: string, decision: "APPROVE" | "SEND_BACK", note: string): Promise<ActionResult> {
  const actor = await requireActor();
  try {
    await reviewTask(db, actor, taskId, { decision, note: note || undefined }, await requestMeta());
    refresh();
    return { ok: true, message: decision === "APPROVE" ? "Signed off." : "Sent back with your note." };
  } catch (err) {
    return toActionError(err);
  }
}
