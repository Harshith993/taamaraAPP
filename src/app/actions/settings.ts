"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { toActionError, type ActionResult } from "@/lib/errors";
import { requestMeta, requireActor } from "@/modules/identity/session";
import { updateSwitches, type switchesSchema } from "@/modules/settings/service";
import type { z } from "zod";

export async function updateSwitchesAction(input: z.input<typeof switchesSchema>): Promise<ActionResult> {
  const actor = await requireActor();
  try {
    const r = await updateSwitches(db, actor, input, await requestMeta());
    revalidatePath("/", "layout");
    return { ok: true, message: r.changed ? "Saved. Everyone sees the change on their next page." : "Nothing changed." };
  } catch (err) {
    return toActionError(err);
  }
}
