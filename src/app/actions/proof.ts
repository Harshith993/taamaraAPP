"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { toActionError, type ActionResult } from "@/lib/errors";
import { requestMeta, requireActor } from "@/modules/identity/session";
import { addProof, reviewProof, type AddProofInput } from "@/modules/proof/service";

/** Attach uploaded photos and videos as proof (vendors, crew, task assignees and staff). */
export async function addProofAction(input: AddProofInput): Promise<ActionResult<{ count: number }>> {
  const actor = await requireActor();
  try {
    const r = await addProof(db, actor, input, await requestMeta());
    revalidatePath("/", "layout");
    return { ok: true, data: { count: r.count }, message: r.count === 1 ? "Sent. The team will check it." : `${r.count} sent. The team will check them.` };
  } catch (err) {
    return toActionError(err);
  }
}

/** Approve proof, or ask for it to be redone with a note (booking manager, supervisor or owner). */
export async function reviewProofAction(proofId: string, decision: "APPROVE" | "REJECT", note: string): Promise<ActionResult> {
  const actor = await requireActor();
  try {
    await reviewProof(db, actor, proofId, { decision, note: note || undefined }, await requestMeta());
    revalidatePath("/", "layout");
    return { ok: true, message: decision === "APPROVE" ? "Approved." : "Sent back with your note." };
  } catch (err) {
    return toActionError(err);
  }
}
