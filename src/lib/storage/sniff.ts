/**
 * Works out what a file really is from its first bytes, never from its name or the type the browser
 * claims. Anything not recognised is refused.
 */

export type SniffedKind = "image" | "video" | "pdf";

export interface Sniffed {
  mime: string;
  kind: SniffedKind;
  ext: string;
}

const ascii = (buf: Uint8Array, start: number, end: number) => String.fromCharCode(...buf.subarray(start, end));

const startsWith = (buf: Uint8Array, bytes: number[], offset = 0) => bytes.every((b, i) => buf[offset + i] === b);

/** ISO base media brands (the 4 bytes after "ftyp"). */
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]);
const QUICKTIME_BRANDS = new Set(["qt  "]);

/** Needs at least the first 16 bytes; 64 is plenty. */
export function sniffType(head: Uint8Array): Sniffed | null {
  if (head.length < 12) return null;
  if (startsWith(head, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", kind: "image", ext: "jpg" };
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", kind: "image", ext: "png" };
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP") return { mime: "image/webp", kind: "image", ext: "webp" };
  if (ascii(head, 0, 5) === "%PDF-") return { mime: "application/pdf", kind: "pdf", ext: "pdf" };
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) return { mime: "video/webm", kind: "video", ext: "webm" };

  const box = ascii(head, 4, 8);
  if (box === "ftyp") {
    const brand = ascii(head, 8, 12);
    if (HEIF_BRANDS.has(brand)) return { mime: "image/heic", kind: "image", ext: "heic" };
    if (QUICKTIME_BRANDS.has(brand)) return { mime: "video/quicktime", kind: "video", ext: "mov" };
    // isom, iso2, mp41, mp42, avc1, M4V, 3gp*, dash…: all MPEG-4 video for our purposes.
    if (/^[\x20-\x7e]{4}$/.test(brand)) return { mime: "video/mp4", kind: "video", ext: "mp4" };
    return null;
  }
  // Older QuickTime files can start straight with a movie or data box.
  if (["moov", "mdat", "wide", "free", "skip"].includes(box)) return { mime: "video/quicktime", kind: "video", ext: "mov" };
  return null;
}
