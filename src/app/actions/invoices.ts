"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { toActionError, type ActionResult } from "@/lib/errors";
import { requestMeta, requireActor } from "@/modules/identity/session";
import { reviewInvoice, submitInvoice, type SubmitInvoiceInput } from "@/modules/vendors/invoices";

export async function submitInvoiceAction(jobId: string, input: SubmitInvoiceInput): Promise<ActionResult> {
  const actor = await requireActor();
  try {
    await submitInvoice(db, actor, jobId, input, await requestMeta());
    revalidatePath("/", "layout");
    return { ok: true, message: "Invoice sent. The accounts team will check it against the work order." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function reviewInvoiceAction(invoiceId: string, decision: "VERIFY" | "DISPUTE" | "VOID", note: string): Promise<ActionResult> {
  const actor = await requireActor();
  try {
    const r = await reviewInvoice(db, actor, invoiceId, { decision, note: note || undefined }, await requestMeta());
    revalidatePath("/", "layout");
    return { ok: true, message: r.status === "VERIFIED" ? "Verified. It is ready for payment." : r.status === "DISPUTED" ? "Sent back to the vendor." : "Voided." };
  } catch (err) {
    return toActionError(err);
  }
}
