/** Web push on this device: POST saves the browser's subscription, DELETE removes it (src/modules/notifications/push.ts). */
import { db } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { apiActor, apiError, assertSameOrigin, NO_STORE } from "@/lib/http";
import { removePushSubscription, savePushSubscription } from "@/modules/notifications/push";

async function json(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new ValidationError("Send JSON.");
  return request.json().catch(() => {
    throw new ValidationError("Send JSON.");
  });
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await apiActor();
    const r = await savePushSubscription(db, actor, await json(request), request.headers.get("user-agent"));
    return Response.json(r, { status: 201, headers: NO_STORE });
  } catch (err) {
    return apiError(err);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await apiActor();
    const body = (await json(request)) as { endpoint?: unknown };
    if (typeof body.endpoint !== "string") throw new ValidationError("Which device?");
    return Response.json(await removePushSubscription(db, actor, body.endpoint), { headers: NO_STORE });
  } catch (err) {
    return apiError(err);
  }
}
