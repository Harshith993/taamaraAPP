// Joins the recorded segments of one demo into an H.264 MP4 with chapter marks.
// Usage: node scripts/demo/stitch.cjs <work-dir> <out.mp4>
//   Desktop video (frame "desktop"): 1440×900; phone and iPad segments sit centred on the cream page.
//   Phone video (frame "phone"): 786×1704 portrait, the phone recording enlarged two times.
// Also writes <out>.chapters.json and <out>.chapters.txt (YouTube-style "0:00 Title" lines).
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const [workDir, out] = process.argv.slice(2);
if (!workDir || !out) {
  console.error("Usage: node scripts/demo/stitch.cjs <work-dir> <out.mp4>");
  process.exit(1);
}
const { name, frame, segments, speed = 1 } = JSON.parse(fs.readFileSync(path.join(workDir, "segments.json"), "utf8"));
const CREAM = "0xF6F0E3";
const canvas = frame === "phone" ? { w: 786, h: 1704 } : { w: 1440, h: 900 };

const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
const duration = (file) =>
  parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());

function filterFor(device) {
  const { w, h } = canvas;
  if (frame === "phone") return `scale=${w}:${h}:flags=lanczos,setsar=1`;
  if (device === "desktop") return `scale=${w}:${h}:flags=lanczos,setsar=1`;
  // Phone or iPad inside the desktop frame: fit the height (a phone gets a little larger), centre it.
  const fit = device === "phone" ? 880 : h;
  return `scale=-2:${fit}:flags=lanczos,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${CREAM},setsar=1`;
}

const parts = [];
const chapters = [];
let clock = 0;
segments.forEach((seg, i) => {
  const part = path.join(workDir, `part-${String(i).padStart(2, "0")}.mp4`);
  ff([
    "-ss", seg.trim.toFixed(3), "-i", seg.file,
    // A gentle speed-up (set per video) keeps the long tour within its length without rushing captions.
    "-vf", `setpts=PTS/${speed},${filterFor(seg.device)},fps=30,format=yuv420p`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-an", part,
  ]);
  for (const m of seg.marks) chapters.push({ title: m.title, kicker: m.kicker, start: clock + Math.max(0, m.at) / speed });
  clock += duration(part);
  parts.push(part);
});

const list = path.join(workDir, "parts.txt");
fs.writeFileSync(list, parts.map((p) => `file '${p}'`).join("\n"));
const meta = path.join(workDir, "chapters.ffmeta");
const ms = (s) => Math.round(s * 1000);
fs.writeFileSync(
  meta,
  ";FFMETADATA1\ntitle=Taamara Taamara · " + name + "\n" +
    chapters
      .map((c, i) => `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${ms(c.start)}\nEND=${ms(i + 1 < chapters.length ? chapters[i + 1].start : clock)}\ntitle=${c.title}\n`)
      .join(""),
);
ff(["-f", "concat", "-safe", "0", "-i", list, "-i", meta, "-map_metadata", "1", "-map_chapters", "1", "-c", "copy", "-movflags", "+faststart", out]);

const stamp = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
fs.writeFileSync(out.replace(/\.mp4$/, ".chapters.json"), JSON.stringify(chapters.map((c) => ({ ...c, start: +c.start.toFixed(1), stamp: stamp(c.start) })), null, 2));
fs.writeFileSync(out.replace(/\.mp4$/, ".chapters.txt"), chapters.map((c) => `${stamp(c.start)} ${c.title}`).join("\n") + "\n");
const size = fs.statSync(out).size / 1e6;
console.log(`${out}: ${stamp(clock)} long, ${size.toFixed(1)} MB, ${chapters.length} chapters`);
