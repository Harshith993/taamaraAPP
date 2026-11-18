"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { toActionError, type ActionResult } from "@/lib/errors";
import { requestMeta, requireActor } from "@/modules/identity/session";
import {
  acceptWorkOrder,
  declineJob,
  reportProgress,
  submitQuote,
  type SubmitQuoteInput,
} from "@/modules/vendors/jobs";

function refresh(jobId: string) {
  revalidatePath(`/vendor/jobs/${jobId}`);
  revalidatePath("/vendor");
}

export async function submitQuoteAction(
  jobId: string,
  input: SubmitQuoteInput,
): Promise<ActionResult<{ version: number; total: number }>> {
  const actor = await requireActor();
  try {
    const q = await submitQuote(db, actor, jobId, input, await requestMeta());
    refresh(jobId);
    return {
      ok: true,
      data: { version: q.version, total: q.total },
      message: `Quote v${q.version} sent. Taamara Taamara will reply here.`,
    };
  } catch (err) {
    return toActionError(err);
  }
}

export async function declineJobAction(
  jobId: string,
  reason: string,
): Promise<ActionResult> {
  const actor = await requireActor();
  try {
    await declineJob(db, actor, jobId, reason, await requestMeta());
    refresh(jobId);
    return { ok: true, message: "Declined. The manager has been told." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function acceptWorkOrderAction(
  jobId: string,
): Promise<ActionResult> {
  const actor = await requireActor();
  try {
    await acceptWorkOrder(db, actor, jobId, await requestMeta());
    refresh(jobId);
    return { ok: true, message: "Accepted. You're booked." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function reportProgressAction(
  jobId: string,
  stage: "IN_PROGRESS" | "DELIVERED",
  note: string,
): Promise<ActionResult> {
  const actor = await requireActor();
  try {
    await reportProgress(
      db,
      actor,
      jobId,
      { stage, note: note || undefined },
      await requestMeta(),
    );
    refresh(jobId);
    return {
      ok: true,
      message:
        stage === "IN_PROGRESS"
          ? "Marked as started."
          : "Marked as done. The team will check and sign off.",
    };
  } catch (err) {
    return toActionError(err);
  }
}
