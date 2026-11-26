"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { toActionError, type ActionResult } from "@/lib/errors";
import { formatINR } from "@/lib/format";
import { closeAdvance, giveAdvance, markAdvanceGiven, voidAdvance, type AdvanceInput } from "@/modules/finance/advances";
import { requestMeta, requireActor } from "@/modules/identity/session";

const refresh = () => revalidatePath("/", "layout");

export async function giveAdvanceAction(input: AdvanceInput): Promise<ActionResult> {
  const actor = await requireActor();
  try {
    const r = await giveAdvance(db, actor, input, await requestMeta());
    refresh();
    return { ok: true, message: r.status === "GIVEN" ? "Given. They have been told." : r.status === "APPROVED" ? "Approved. Mark it handed over when the cash goes." : "Sent to the hosts for approval." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function markAdvanceGivenAction(id: string, input: { method: "CASH" | "UPI" | "BANK"; reference?: string; givenOn: string }): Promise<ActionResult> {
  const actor = await requireActor();
  try {
    await markAdvanceGiven(db, actor, id, input, await requestMeta());
    refresh();
    return { ok: true, message: "Handed over." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function closeAdvanceAction(id: string, input: { returned: string; note?: string }): Promise<ActionResult> {
  const actor = await requireActor();
  try {
    const r = await closeAdvance(db, actor, id, input, await requestMeta());
    refresh();
    return { ok: true, message: `Closed: ${formatINR(r.spent)} spent, ${formatINR(r.returned)} returned${r.shortfall ? `, ${formatINR(r.shortfall)} settled` : ""}.` };
  } catch (err) {
    return toActionError(err);
  }
}

export async function voidAdvanceAction(id: string, reason: string): Promise<ActionResult> {
  const actor = await requireActor();
  try {
    await voidAdvance(db, actor, id, reason, await requestMeta());
    refresh();
    return { ok: true, message: "Voided." };
  } catch (err) {
    return toActionError(err);
  }
}
