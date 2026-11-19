"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { toActionError, type ActionResult } from "@/lib/errors";
import { markRepaid, submitExpense, type ExpenseInput } from "@/modules/finance/expenses";
import { requestMeta, requireActor } from "@/modules/identity/session";

export async function submitExpenseAction(input: ExpenseInput): Promise<ActionResult> {
  const actor = await requireActor();
  try {
    await submitExpense(db, actor, input, await requestMeta());
    revalidatePath("/", "layout");
    return { ok: true, message: "Sent to the hosts for approval." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function markRepaidAction(expenseId: string, method: "CASH" | "UPI" | "BANK", reference: string): Promise<ActionResult> {
  const actor = await requireActor();
  try {
    await markRepaid(db, actor, expenseId, { method, reference }, await requestMeta());
    revalidatePath("/", "layout");
    return { ok: true, message: "Marked as repaid." };
  } catch (err) {
    return toActionError(err);
  }
}
