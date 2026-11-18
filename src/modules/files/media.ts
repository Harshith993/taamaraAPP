/** How a stored photo, video or document is shown: plain fields plus signed links for one viewer. */
import type { FileStatus } from "@/generated/prisma/client";
import { fileLink } from "./links";

export interface MediaFile {
  id: string;
  filename: string;
  mimeType: string;
  status: FileStatus;
  processingError: string | null;
  thumbnailKey: string | null;
  playableKey: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
}

/** Fields to select when a page will show the file. */
export const MEDIA_SELECT = {
  id: true,
  filename: true,
  mimeType: true,
  status: true,
  processingError: true,
  thumbnailKey: true,
  playableKey: true,
  durationSeconds: true,
  width: true,
  height: true,
} as const;

export interface MediaView {
  fileId: string;
  kind: "photo" | "video" | "pdf" | "other";
  status: FileStatus;
  error: string | null;
  filename: string;
  thumbUrl: string | null;
  viewUrl: string | null;
  /** The file as uploaded (may carry the phone's location). Only for people allowed to check it. */
  originalUrl: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
}

export function mediaKind(mimeType: string): MediaView["kind"] {
  if (mimeType.startsWith("image/")) return "photo";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType === "application/pdf") return "pdf";
  return "other";
}

/** Call only after checking that viewerUserId may see this file. */
export function mediaView(viewerUserId: string, file: MediaFile, opts: { original?: boolean } = {}): MediaView {
  const ready = file.status === "READY";
  const kind = mediaKind(file.mimeType);
  const documentLike = kind === "pdf" || kind === "other";
  return {
    fileId: file.id,
    kind,
    status: file.status,
    error: file.processingError,
    filename: file.filename,
    thumbUrl: ready && file.thumbnailKey ? fileLink(viewerUserId, file.id, "thumb") : null,
    viewUrl: ready && file.playableKey ? fileLink(viewerUserId, file.id, "view") : null,
    originalUrl: ready && (opts.original || documentLike) ? fileLink(viewerUserId, file.id, "original") : null,
    durationSeconds: file.durationSeconds,
    width: file.width,
    height: file.height,
  };
}
