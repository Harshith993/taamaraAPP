/**
 * Browser side of uploads (see src/modules/files/uploads.ts for the server side).
 *
 * - Photos are shrunk on the phone first (long side 2560 px, JPEG), which also turns iPhone HEIC
 *   photos into JPEG and drops their hidden metadata.
 * - Files go up in 4 MB pieces. If the network drops, the upload waits and carries on from the last
 *   piece the server has, for as long as the page stays open.
 */

export type UploadPurpose = "PROOF" | "DOCUMENT";

export class UploadError extends Error {}

const MAX_SIDE = 2560;
const SHRINK_ABOVE_BYTES = 1.5 * 1024 * 1024;

/** A smaller JPEG for big photos; anything that can't be read here is sent as it is. */
export async function preparePhoto(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const isHeic = /heic|heif/.test(file.type) || /\.(heic|heif)$/i.test(file.name);
    if (scale === 1 && file.size <= SHRINK_ABOVE_BYTES && !isHeic) return file;
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) return file;
    const name = file.name.replace(/\.[^.]*$/, "") || "photo";
    return new File([blob], `${name}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
  } finally {
    bitmap.close();
  }
}

/** Length of a video in seconds, read in the browser; null if the browser can't tell. */
export function videoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    const done = (d: number | null) => {
      URL.revokeObjectURL(url);
      resolve(d);
    };
    const timer = setTimeout(() => done(null), 8000);
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () => {
      clearTimeout(timer);
      done(Number.isFinite(v.duration) ? v.duration : null);
    };
    v.onerror = () => {
      clearTimeout(timer);
      done(null);
    };
    v.src = url;
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function waitForOnline(): Promise<void> {
  if (typeof navigator === "undefined" || navigator.onLine) return Promise.resolve();
  return new Promise((resolve) => window.addEventListener("online", () => resolve(), { once: true }));
}

async function readError(res: Response): Promise<{ error?: string; received?: number }> {
  try {
    return (await res.json()) as { error?: string; received?: number };
  } catch {
    return {};
  }
}

export interface UploadProgress {
  sent: number;
  total: number;
  /** True while waiting for the network to come back. */
  waiting: boolean;
}

export interface UploadedFile {
  id: string;
  status: string;
  mime: string;
}

/** Uploads one file and resolves with its id once the server has checked and stored it. */
export async function uploadFile(
  file: File,
  purpose: UploadPurpose,
  opts: { onProgress?: (p: UploadProgress) => void; signal?: AbortSignal } = {},
): Promise<UploadedFile> {
  const start = await fetch("/api/v1/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ purpose, filename: file.name, size: file.size, type: file.type }),
    signal: opts.signal,
  }).catch(() => null);
  if (!start) throw new UploadError("No connection. Please try again when you have signal.");
  if (!start.ok) throw new UploadError((await readError(start)).error ?? "The upload could not start.");
  const { id, chunkBytes } = (await start.json()) as { id: string; chunkBytes: number };

  let sent = 0;
  let failures = 0;
  const report = (waiting: boolean) => opts.onProgress?.({ sent, total: file.size, waiting });
  report(false);

  const recover = async () => {
    failures += 1;
    if (failures > 40) throw new UploadError("The connection kept dropping. Please try again later.");
    report(true);
    await waitForOnline();
    await sleep(Math.min(15_000, 1000 * 2 ** Math.min(failures - 1, 4)));
    const status = await fetch(`/api/v1/uploads/${id}`, { signal: opts.signal, cache: "no-store" }).catch(() => null);
    if (status?.ok) sent = ((await status.json()) as { received: number }).received;
  };

  while (sent < file.size) {
    if (opts.signal?.aborted) throw new UploadError("Upload cancelled.");
    const piece = file.slice(sent, Math.min(file.size, sent + chunkBytes));
    const res = await fetch(`/api/v1/uploads/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream", "Upload-Offset": String(sent) },
      body: piece,
      signal: opts.signal,
    }).catch(() => null);
    if (!res || res.status >= 500) {
      await recover();
      continue;
    }
    const body = await readError(res);
    if (res.status === 409 && typeof body.received === "number") {
      sent = body.received;
      continue;
    }
    if (!res.ok) throw new UploadError(body.error ?? "The upload failed.");
    sent = body.received ?? sent + piece.size;
    failures = 0;
    report(false);
  }

  for (;;) {
    const done = await fetch(`/api/v1/uploads/${id}/complete`, { method: "POST", signal: opts.signal }).catch(() => null);
    if (!done || done.status >= 500) {
      await recover();
      continue;
    }
    if (!done.ok) throw new UploadError((await readError(done)).error ?? "The upload could not be finished.");
    return (await done.json()) as UploadedFile;
  }
}

/** Throws away an upload that won't be used (best effort). */
export function discardUpload(id: string): void {
  void fetch(`/api/v1/uploads/${id}`, { method: "DELETE" }).catch(() => undefined);
}
