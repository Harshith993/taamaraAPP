/** Start an upload. See src/modules/files/uploads.ts for the whole protocol. */
import { checkRate } from "@/lib/rate-limit";
import { apiActor, apiError, assertSameOrigin, NO_STORE } from "@/lib/http";
import { db } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { startUpload } from "@/modules/files/uploads";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await apiActor();
    checkRate(actor.userId, "upload.start");
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new ValidationError("Send JSON.");
    const body = await request.json().catch(() => {
      throw new ValidationError("Send JSON.");
    });
    const started = await startUpload(db, actor, body);
    return Response.json(started, { status: 201, headers: NO_STORE });
  } catch (err) {
    return apiError(err);
  }
}
