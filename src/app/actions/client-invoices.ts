"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { db } from "@/lib/db";
import { toActionError, type ActionResult } from "@/lib/errors";
import { cancelInvoice, deleteDraft, draftInvoice, issueInvoice, updateClientBilling, type clientBillingSchema, type DraftInput } from "@/modules/finance/client-invoices";
import { requestMeta, requireActor } from "@/modules/identity/session";

async function run<T>(fn: () => Promise<T>, message: (r: T) => string): Promise<ActionResult> {
  try {
    const r = await fn();
    revalidatePath("/", "layout");
    return { ok: true, message: message(r) };
  } catch (err) {
    return toActionError(err);
  }
}

export async function draftInvoiceAction(input: DraftInput) {
  const actor = await requireActor();
  return run(async () => draftInvoice(db, actor, input, await requestMeta()), () => "Draft saved. Check it, then issue it.");
}

export async function issueInvoiceAction(invoiceId: string, issueDate: string) {
  const actor = await requireActor();
  return run(async () => issueInvoice(db, actor, invoiceId, { issueDate }, await requestMeta()), (r) => `Issued as ${r.number}.`);
}

export async function deleteDraftAction(invoiceId: string) {
  const actor = await requireActor();
  return run(async () => deleteDraft(db, actor, invoiceId, await requestMeta()), () => "Draft deleted.");
}

export async function cancelInvoiceAction(invoiceId: string, reason: string) {
  const actor = await requireActor();
  return run(async () => cancelInvoice(db, actor, invoiceId, reason, await requestMeta()), () => "Invoice cancelled. Its number stays in the register.");
}

export async function updateClientBillingAction(eventId: string, input: z.input<typeof clientBillingSchema>) {
  const actor = await requireActor();
  return run(async () => updateClientBilling(db, actor, eventId, input, await requestMeta()), () => "Billing details saved.");
}
