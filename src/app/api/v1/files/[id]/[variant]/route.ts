/**
 * Serves a stored file through a signed, expiring link made for the signed-in person
 * (src/modules/files/links.ts). Supports byte ranges, which phones need to play video.
 */
import { Readable } from "node:stream";
import { db } from "@/lib/db";
import { apiActor, apiError } from "@/lib/http";
import { storage } from "@/lib/storage";
import { checkFileLink, type FileVariant } from "@/modules/files/links";

type Ctx = { params: Promise<{ id: string; variant: string }> };

const TYPE_BY_EXT: Record<string, string> = { jpg: "image/jpeg", mp4: "video/mp4", webp: "image/webp", png: "image/png" };

function parseRange(header: string | null, size: number): { start: number; end: number } | "bad" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return "bad";
  let start: number;
  let end: number;
  if (m[1] === "") {
    // Last N bytes.
    const n = Number(m[2]);
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return "bad";
  return { start, end };
}

function asciiName(name: string) {
  return name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
}

async function serve(request: Request, { params }: Ctx, withBody: boolean): Promise<Response> {
  try {
    const { id, variant } = await params;
    const url = new URL(request.url);
    const actor = await apiActor();
    const check = checkFileLink(actor.userId, id, variant, url.searchParams.get("e"), url.searchParams.get("s"));
    if (check === "expired") return Response.json({ error: "This link has expired. Refresh the page." }, { status: 410 });
    if (check !== "ok") return Response.json({ error: "Not found." }, { status: 404 });

    const file = await db.file.findUnique({ where: { id } });
    if (!file || file.status !== "READY") return Response.json({ error: "Not found." }, { status: 404 });
    const key = ({ original: file.storageKey, view: file.playableKey, thumb: file.thumbnailKey } as Record<FileVariant, string | null>)[variant as FileVariant];
    if (!key) return Response.json({ error: "Not found." }, { status: 404 });
    const size = await storage().size(key);
    if (size === null) return Response.json({ error: "Not found." }, { status: 404 });

    const ext = key.split(".").pop() ?? "";
    const type = variant === "original" ? file.mimeType : (TYPE_BY_EXT[ext] ?? "application/octet-stream");
    const filename = variant === "original" ? file.filename : `${file.filename.replace(/\.[^.]*$/, "")}-${variant}.${ext}`;
    const headers: Record<string, string> = {
      "Content-Type": type,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=600",
      "Content-Disposition": `inline; filename="${asciiName(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cross-Origin-Resource-Policy": "same-origin",
    };

    const range = parseRange(request.headers.get("range"), size);
    if (range === "bad") return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    if (!withBody) return new Response(null, { status: 200, headers: { ...headers, "Content-Length": String(size) } });

    if (range) {
      const stream = await storage().read(key, range);
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: { ...headers, "Content-Range": `bytes ${range.start}-${range.end}/${size}`, "Content-Length": String(range.end - range.start + 1) },
      });
    }
    const stream = await storage().read(key);
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: 200, headers: { ...headers, "Content-Length": String(size) } });
  } catch (err) {
    return apiError(err);
  }
}

export function GET(request: Request, ctx: Ctx) {
  return serve(request, ctx, true);
}

export function HEAD(request: Request, ctx: Ctx) {
  return serve(request, ctx, false);
}
