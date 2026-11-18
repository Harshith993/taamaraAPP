/** One upload: how much has arrived (GET), the next piece (PUT), or throw it away (DELETE). */
import { apiActor, apiError, assertSameOrigin, NO_STORE } from "@/lib/http";
import { db } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { appendChunk, CHUNK_BYTES, discardUpload, OffsetMismatchError, uploadStatus } from "@/modules/files/uploads";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const actor = await apiActor();
    return Response.json(await uploadStatus(db, actor, (await params).id), { headers: NO_STORE });
  } catch (err) {
    return apiError(err);
  }
}

/** Reads at most CHUNK_BYTES; anything longer is refused without reading it all. */
async function readCapped(request: Request): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > CHUNK_BYTES) throw new ValidationError("That piece is too big.");
  if (!request.body) return new Uint8Array();
  const parts: Uint8Array[] = [];
  let total = 0;
  const reader = request.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > CHUNK_BYTES) {
      await reader.cancel();
      throw new ValidationError("That piece is too big.");
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

export async function PUT(request: Request, { params }: Ctx) {
  try {
    assertSameOrigin(request);
    const actor = await apiActor();
    const offset = Number(request.headers.get("upload-offset") ?? NaN);
    const data = await readCapped(request);
    const r = await appendChunk(db, actor, (await params).id, offset, data);
    return Response.json(r, { headers: NO_STORE });
  } catch (err) {
    return apiError(err, err instanceof OffsetMismatchError ? { received: err.received } : {});
  }
}

export async function DELETE(request: Request, { params }: Ctx) {
  try {
    assertSameOrigin(request);
    const actor = await apiActor();
    await discardUpload(db, actor, (await params).id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return apiError(err);
  }
}
