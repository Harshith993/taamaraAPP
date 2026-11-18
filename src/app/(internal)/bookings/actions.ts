"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { toActionError, type ActionResult } from "@/lib/errors";
import { createBooking, type CreateBookingInput } from "@/modules/events/service";
import { requestMeta, requirePermission } from "@/modules/identity/session";

export async function createBookingAction(input: CreateBookingInput): Promise<ActionResult<{ id: string; code: string; taskCount: number }>> {
  const actor = await requirePermission("bookings.create");
  try {
    const booking = await createBooking(db, actor, input, await requestMeta());
    revalidatePath("/bookings");
    revalidatePath("/home");
    return { ok: true, data: { id: booking.id, code: booking.code, taskCount: booking.taskCount } };
  } catch (err) {
    return toActionError(err);
  }
}
