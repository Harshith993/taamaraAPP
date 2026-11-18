"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { toActionError, type ActionResult } from "@/lib/errors";
import { decideApproval, type Decision } from "@/modules/approvals/service";
import { requestMeta, requirePermission } from "@/modules/identity/session";

export async function decideAction(approvalId: string, decision: Decision, comment: string): Promise<ActionResult> {
  const actor = await requirePermission("approvals.decide");
  if (!["APPROVE", "REJECT", "REVISE"].includes(decision)) return { ok: false, error: "Unknown decision." };
  try {
    await decideApproval(db, actor, approvalId, decision, comment, await requestMeta());
    revalidatePath("/approvals");
    revalidatePath("/home");
    return { ok: true, message: decision === "APPROVE" ? "Approved." : decision === "REVISE" ? "Sent back for a new quote." : "Not approved. They have been told why." };
  } catch (err) {
    return toActionError(err);
  }
}
