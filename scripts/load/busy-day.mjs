#!/usr/bin/env node
/**
 * Load test: a busy event day (Phase 9).
 *
 *   node scripts/load/busy-day.mjs --base http://localhost:3000 --seconds 120 --media <folder>
 *
 * Against a production build (`npm run build && npm run start`) on the demo seed. Development
 * database only: it clears the sign-in rate limit between its own sign-ins.
 *
 * What it does at the same time, for --seconds:
 *   uploaders   crew and vendor logins send proof the way phones do (4 MB pieces): mostly photos,
 *               some videos; each finished file goes to the server's processing queue
 *   viewers     the hosts, managers, accountant and supervisor keep opening pages: home, the
 *               booking, Event day, Money, Messages, the proof queue, the calendar
 * Then it waits for the processing queue to empty and reports page times (median, 95th
 * percentile, slowest), errors, upload throughput and how long processing took to catch up.
 * The media folder needs photo.jpg and video.mp4 (a phone-sized photo and a 1080p video).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("dotenv/config");
const { Client } = require("pg");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const BASE = arg("base", "http://localhost:3000");
const SECONDS = Number(arg("seconds", "120"));
const MEDIA = arg("media", "./media");
const VIEWERS_PER_LOGIN = Number(arg("viewers", "3"));
const UPLOADS_PER_LOGIN = Number(arg("uploaders", "2"));
const PASSWORD = "Taamara@2026";

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
if (!new URL(process.env.DATABASE_URL).pathname.endsWith("_dev")) throw new Error("Development database only.");

async function signIn(phone) {
  await db.query("DELETE FROM rate_limits");
  const res = await fetch(`${BASE}/api/auth/sign-in/phone-number`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ phoneNumber: phone, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`sign-in ${phone}: ${res.status} ${await res.text()}`);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

const stats = new Map();
const record = (key, ms, ok) => {
  const s = stats.get(key) ?? { times: [], errors: 0 };
  s.times.push(ms);
  if (!ok) s.errors += 1;
  stats.set(key, s);
};
const pct = (xs, p) => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : 0;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = Date.now() + SECONDS * 1000;

// ── The people
const [wedding] = (await db.query(`SELECT id FROM events WHERE name = 'Aditi & Karan'`)).rows;
const viewers = { host: "+919800000001", cohost: "+919800000002", manager: "+919800000003", manager2: "+919800000004", accountant: "+919800000005", supervisor: "+919800000006" };
const uploaders = { vendor1: "+919811000005", vendor2: "+919811000002", crew1: "+919922000002", crew2: "+919922000005" };
const cookies = {};
for (const [k, phone] of Object.entries({ ...viewers, ...uploaders })) cookies[k] = await signIn(phone);

const PAGES = {
  host: ["/home", `/bookings/${wedding.id}`, `/bookings/${wedding.id}?tab=money`, "/money", "/approvals", "/messages", "/calendar", "/proof"],
  cohost: ["/home", "/money", `/bookings/${wedding.id}?tab=vendors`, "/proof"],
  manager: ["/home", `/bookings/${wedding.id}`, `/bookings/${wedding.id}?tab=crew`, "/messages", "/event-day"],
  manager2: ["/home", "/bookings", "/calendar"],
  accountant: ["/money", "/invoices", "/expenses"],
  supervisor: ["/event-day", "/proof", `/bookings/${wedding.id}?tab=schedule`],
};

async function viewer(who) {
  const list = PAGES[who];
  let i = Math.floor(Math.random() * list.length);
  while (Date.now() < until) {
    const page = list[i++ % list.length];
    const t = performance.now();
    let ok = false;
    try {
      const res = await fetch(`${BASE}${page}`, { headers: { cookie: cookies[who] }, redirect: "manual" });
      await res.arrayBuffer();
      ok = res.status === 200;
    } catch {}
    record(`page ${page.replace(wedding.id, ":id")}`, performance.now() - t, ok);
    await sleep(500 + Math.random() * 1500); // a person reading the screen
  }
}

// ── Uploads, the way the phone does them
const photo = await readFile(path.join(MEDIA, "photo.jpg"));
const video = await readFile(path.join(MEDIA, "video.mp4"));
const uploaded = [];
let bytesSent = 0;

async function uploadOnce(who, data, name, type) {
  const h = { cookie: cookies[who] };
  const t = performance.now();
  const start = await fetch(`${BASE}/api/v1/uploads`, { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ purpose: "PROOF", filename: name, size: data.length, type }) });
  if (!start.ok) return record(`upload ${type}`, performance.now() - t, false);
  const { id, chunkBytes } = await start.json();
  for (let at = 0; at < data.length; ) {
    const piece = data.subarray(at, at + chunkBytes);
    const res = await fetch(`${BASE}/api/v1/uploads/${id}`, { method: "PUT", headers: { ...h, "content-type": "application/octet-stream", "upload-offset": String(at) }, body: piece });
    if (res.status === 429) {
      record("upload piece slowed down (429)", 0, true);
      await sleep(Number(res.headers.get("retry-after") || 5) * 1000);
      continue;
    }
    if (!res.ok) return record(`upload ${type}`, performance.now() - t, false);
    at += piece.length;
    bytesSent += piece.length;
  }
  const done = await fetch(`${BASE}/api/v1/uploads/${id}/complete`, { method: "POST", headers: h });
  record(`upload ${type}`, performance.now() - t, done.ok);
  if (done.ok) uploaded.push(id);
}

async function uploader(who) {
  while (Date.now() < until) {
    if (Math.random() < 0.75) await uploadOnce(who, photo, "IMG_LOAD.jpg", "image/jpeg");
    else await uploadOnce(who, video, "VID_LOAD.mp4", "video/mp4");
    await sleep(1000 + Math.random() * 3000);
  }
}

console.log(`Busy day: ${Object.keys(viewers).length * VIEWERS_PER_LOGIN} people opening pages, ${Object.keys(uploaders).length * UPLOADS_PER_LOGIN} phones uploading, for ${SECONDS} s against ${BASE}`);
const began = Date.now();
await Promise.all([
  ...Object.keys(viewers).flatMap((w) => Array.from({ length: VIEWERS_PER_LOGIN }, () => viewer(w))),
  ...Object.keys(uploaders).flatMap((w) => Array.from({ length: UPLOADS_PER_LOGIN }, () => uploader(w))),
]);
const loadEnded = Date.now();

// ── Wait for processing to catch up
let left = uploaded.length;
while (left > 0 && Date.now() - loadEnded < 15 * 60_000) {
  left = Number((await db.query(`SELECT count(*) FROM files WHERE id = ANY($1) AND status IN ('PROCESSING', 'UPLOADING')`, [uploaded])).rows[0].count);
  if (left) await sleep(2000);
}
const caughtUp = Date.now();
const results = (await db.query(`SELECT status, "mimeType", count(*)::int AS n FROM files WHERE id = ANY($1) GROUP BY 1, 2 ORDER BY 1, 2`, [uploaded])).rows;
await db.end();

// ── Report
const rows = [...stats.entries()].sort(([a], [b]) => a.localeCompare(b));
console.log("\n| What | Count | Errors | Median ms | 95th pct ms | Slowest ms |\n|---|---|---|---|---|---|");
for (const [k, s] of rows) console.log(`| ${k} | ${s.times.length} | ${s.errors} | ${Math.round(pct(s.times, 50))} | ${Math.round(pct(s.times, 95))} | ${Math.round(Math.max(...s.times))} |`);
const pages = rows.filter(([k]) => k.startsWith("page")).flatMap(([, s]) => s.times);
const pageErrors = rows.filter(([k]) => k.startsWith("page")).reduce((n, [, s]) => n + s.errors, 0);
console.log(`\nAll pages: ${pages.length} loads, ${pageErrors} errors, median ${Math.round(pct(pages, 50))} ms, 95th ${Math.round(pct(pages, 95))} ms.`);
console.log(`Uploaded ${(bytesSent / 1048576).toFixed(0)} MB in ${((loadEnded - began) / 1000).toFixed(0)} s (${(bytesSent / 1048576 / ((loadEnded - began) / 1000)).toFixed(1)} MB/s).`);
console.log(`Processing caught up ${((caughtUp - loadEnded) / 1000).toFixed(0)} s after the load ended${left ? ` (${left} still not done)` : ""}.`);
console.log("Files:", results.map((r) => `${r.n} ${r.mimeType} ${r.status}`).join(", "));
