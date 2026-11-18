"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { db } from "@/lib/db";
import { toActionError, type ActionResult } from "@/lib/errors";
import {
  addCharge,
  markPaid,
  preparePayment,
  recordReceipt,
  removeCharge,
  requestAdjustment,
  voidPayment,
  type adjustmentSchema,
  type chargeSchema,
  type markPaidSchema,
  type PreparePaymentInput,
  type receiptSchema,
} from "@/modules/finance/payments";
import { reopenBooking, settleBooking } from "@/modules/finance/settlement";
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

export async function preparePaymentAction(input: PreparePaymentInput) {
  const actor = await requireActor();
  return run(async () => preparePayment(db, actor, input, await requestMeta()), "Sent to the owners for approval.");
}

export async function markPaidAction(paymentId: string, input: z.input<typeof markPaidSchema>) {
  const actor = await requireActor();
  return run(async () => markPaid(db, actor, paymentId, input, await requestMeta()), "Marked as paid. They have been told.");
}

export async function voidPaymentAction(paymentId: string, reason: string) {
  const actor = await requireActor();
  return run(async () => voidPayment(db, actor, paymentId, reason, await requestMeta()), "Voided.");
}

export async function recordReceiptAction(input: z.input<typeof receiptSchema>) {
  const actor = await requireActor();
  return run(async () => recordReceipt(db, actor, input, await requestMeta()), "Payment recorded.");
}

export async function addChargeAction(input: z.input<typeof chargeSchema>) {
  const actor = await requireActor();
  return run(async () => addCharge(db, actor, input, await requestMeta()), "Charge added.");
}

export async function removeChargeAction(chargeId: string) {
  const actor = await requireActor();
  return run(async () => removeCharge(db, actor, chargeId, await requestMeta()), "Charge removed.");
}

export async function requestAdjustmentAction(input: z.input<typeof adjustmentSchema>) {
  const actor = await requireActor();
  return run(async () => requestAdjustment(db, actor, input, await requestMeta()), "Sent to the owners for approval.");
}

import { addBudgetLine, removeBudgetLine, reviseBudget, submitBudget, type budgetLineSchema } from "@/modules/finance/budgets";

export async function addBudgetLineAction(eventId: string, input: z.input<typeof budgetLineSchema>) {
  const actor = await requireActor();
  return run(async () => addBudgetLine(db, actor, eventId, input, await requestMeta()), "Line added.");
}

export async function removeBudgetLineAction(eventId: string, lineId: string) {
  const actor = await requireActor();
  return run(async () => removeBudgetLine(db, actor, eventId, lineId, await requestMeta()), "Removed.");
}

export async function reviseBudgetAction(eventId: string) {
  const actor = await requireActor();
  return run(async () => reviseBudget(db, actor, eventId), "A new draft was started from the approved budget.");
}

export async function submitBudgetAction(eventId: string) {
  const actor = await requireActor();
  return run(async () => submitBudget(db, actor, eventId, await requestMeta()), "Sent to the owners for approval.");
}

export async function settleBookingAction(eventId: string, note: string) {
  const actor = await requireActor();
  return run(async () => settleBooking(db, actor, eventId, { note }, await requestMeta()), "Settled. The booking's money is now locked.");
}

export async function reopenBookingAction(eventId: string, reason: string) {
  const actor = await requireActor();
  return run(async () => reopenBooking(db, actor, eventId, { reason }, await requestMeta()), "Reopened. The booking is back to completed.");
}
