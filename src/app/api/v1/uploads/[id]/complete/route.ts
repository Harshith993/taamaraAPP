/** Finish an upload: the server checks what the file really is, stores it and starts processing. */
import { after } from "next/server";
import { apiActor, apiError, assertSameOrigin, NO_STORE } from "@/lib/http";
import { db } from "@/lib/db";
import { enqueueProcessing } from "@/modules/files/processing";
import { completeUpload, OffsetMismatchError } from "@/modules/files/uploads";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await apiActor();
    const done = await completeUpload(db, actor, (await params).id);
    if (done.needsProcessing) after(() => enqueueProcessing(db, done.id, done.mime));
    return Response.json({ id: done.id, status: done.status, mime: done.mime }, { headers: NO_STORE });
  } catch (err) {
    return apiError(err, err instanceof OffsetMismatchError ? { received: err.received } : {});
  }
}
