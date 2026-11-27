/** The S3 storage driver (Phase 10) against a local S3-compatible server (s3rver). */
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { S3Storage } from "@/lib/storage/s3";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const S3rver = require("s3rver");

let server: { run(): Promise<{ port: number }>; close(): Promise<void> };
let dir: string;
let s3: S3Storage;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "taamara-s3-"));
  server = new S3rver({ port: 0, address: "127.0.0.1", silent: true, directory: path.join(dir, "bucket"), configureBuckets: [{ name: "taamara-test" }] });
  const { port } = await server.run();
  s3 = new S3Storage({ bucket: "taamara-test", endpoint: `http://127.0.0.1:${port}`, forcePathStyle: true, encrypt: false, credentials: { accessKeyId: "S3RVER", secretAccessKey: "S3RVER" } });
});
afterAll(async () => {
  await server.close();
  await rm(dir, { recursive: true, force: true });
});

const text = async (r: NodeJS.ReadableStream) => {
  const chunks: Buffer[] = [];
  for await (const c of r) chunks.push(Buffer.from(c as Buffer));
  return Buffer.concat(chunks).toString();
};

describe("S3 storage", () => {
  it("stores, sizes, reads (whole and a byte range) and removes objects", async () => {
    await s3.putBuffer("proof/2026-11/abc/original", Buffer.from("hello mandap"), "text/plain");
    expect(await s3.size("proof/2026-11/abc/original")).toBe(12);
    expect(await text(await s3.read("proof/2026-11/abc/original"))).toBe("hello mandap");
    expect(await text(await s3.read("proof/2026-11/abc/original", { start: 6, end: 11 }))).toBe("mandap");
    await s3.remove("proof/2026-11/abc/original");
    expect(await s3.size("proof/2026-11/abc/original")).toBeNull();
  });

  it("moves a local file in (the local copy is gone) and copies one out for ffmpeg and sharp", async () => {
    const src = path.join(dir, "upload.bin");
    await writeFile(src, Buffer.alloc(300_000, 7));
    await s3.putFromPath("document/2026-11/def/original", src, "application/octet-stream");
    await expect(stat(src)).rejects.toThrow();
    const out = path.join(dir, "copy.bin");
    await s3.copyToPath("document/2026-11/def/original", out);
    expect((await readFile(out)).length).toBe(300_000);
  });

  it("refuses unsafe keys", async () => {
    await expect(s3.putBuffer("../etc/passwd", Buffer.from("x"), "text/plain")).rejects.toThrow(/Unsafe/);
    await expect(s3.size("a/../../b")).rejects.toThrow(/Unsafe/);
  });

  it("needs a bucket", () => {
    expect(() => new S3Storage({ bucket: "" })).toThrow(/S3_BUCKET/);
  });
});
