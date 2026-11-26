/** Opens (or starts) a booking conversation and goes to it: /api/v1/channels/open?type=CREW&eventId=… */
import { checkRate } from "@/lib/rate-limit";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { apiActor, apiError } from "@/lib/http";
import { messagesBase, openChannel } from "@/modules/communication/chat";

export async function GET(request: Request) {
  let target: string;
  try {
    const actor = await apiActor();
    checkRate(actor.userId, "channel.open");
    const q = new URL(request.url).searchParams;
    const id = await openChannel(db, actor, { type: (q.get("type") ?? "") as "CREW", eventId: q.get("eventId") ?? "", vendorId: q.get("vendorId") || undefined });
    target = `${messagesBase(actor.accountType)}/${id}`;
  } catch (err) {
    return apiError(err);
  }
  redirect(target);
}
