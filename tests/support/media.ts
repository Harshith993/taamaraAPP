/** Real test media made on the fly: photos with sharp, videos with ffmpeg. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const dir = mkdtempSync(path.join(os.tmpdir(), "taamara-test-media-"));

/** A JPEG that carries the phone's location in its EXIF data, like a real camera photo. */
export async function jpegWithLocation(width = 3000, height = 2000): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 221, g: 97, b: 154 } } })
    .withExif({ IFD0: { Make: "TestPhone", Model: "T1" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "26/1 54/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "75/1 47/1 0/1" } })
    .jpeg({ quality: 70 })
    .toBuffer();
}

/** An MP4 of the given length with a location tag, like an iPhone video. */
export function mp4WithLocation(seconds: number, name = `clip-${seconds}.mp4`): Buffer {
  const out = path.join(dir, name);
  execFileSync("ffmpeg", [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", `testsrc=size=640x360:rate=15:duration=${seconds}`,
    "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`,
    "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest",
    "-metadata", "location=+26.9124+075.7873/", "-metadata", "title=Secret venue",
    out,
  ]);
  return readFileSync(out);
}

export function ffprobeTags(file: string): Record<string, string> {
  const json = execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", file]).toString();
  return (JSON.parse(json) as { format: { tags?: Record<string, string> } }).format.tags ?? {};
}
