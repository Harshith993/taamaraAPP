import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localRoot, storage } from "@/lib/storage";
import { sniffType } from "@/lib/storage/sniff";
import { loadActor, type Actor } from "@/modules/identity/actor";
import { checkFileLink, fileLink } from "@/modules/files/links";
import { mediaView } from "@/modules/files/media";
import { describeLength, processFile } from "@/modules/files/processing";
import { appendChunk, CHUNK_BYTES, cleanFilename, cleanupAbandonedUploads, completeUpload, discardUpload, OffsetMismatchError, startUpload, uploadStatus } from "@/modules/files/uploads";
import { makeUser, testDb } from "../support/factories";
import { ffprobeTags, jpegWithLocation, mp4WithLocation } from "../support/media";

let vendor: Actor;
let crew: Actor;
let accountant: Actor;
let otherCrew: Actor;
const actorOf = async (u: { id: string }) => (await loadActor(testDb, u.id))!;

beforeAll(async () => {
  vendor = await actorOf(await makeUser({ name: "Up Vendor", roleKey: "VENDOR", accountType: "VENDOR" }));
  crew = await actorOf(await makeUser({ name: "Up Crew", roleKey: "LABOUR", accountType: "LABOUR" }));
  otherCrew = await actorOf(await makeUser({ name: "Up Crew 2", roleKey: "LABOUR", accountType: "LABOUR" }));
  accountant = await actorOf(await makeUser({ name: "Up Accountant", roleKey: "ACCOUNTANT" }));
});
afterAll(() => testDb.$disconnect());

/** Sends a whole buffer in pieces, the way the browser does. */
async function sendAll(actor: Actor, id: string, data: Buffer) {
  for (let at = 0; at < data.length; at += CHUNK_BYTES) await appendChunk(testDb, actor, id, at, data.subarray(at, at + CHUNK_BYTES));
}

async function upload(actor: Actor, data: Buffer, opts: { purpose?: "PROOF" | "DOCUMENT"; name?: string; type?: string } = {}) {
  const { id } = await startUpload(testDb, actor, { purpose: opts.purpose ?? "PROOF", filename: opts.name ?? "photo.jpg", size: data.length, type: opts.type ?? "image/jpeg" });
  await sendAll(actor, id, data);
  return completeUpload(testDb, actor, id);
}

describe("file type sniffing", () => {
  it("reads the type from the bytes, not the name", () => {
    expect(sniffType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))?.mime).toBe("image/jpeg");
    expect(sniffType(Buffer.from("%PDF-1.7\n%âãÏÓ\n"))?.kind).toBe("pdf");
    expect(sniffType(Buffer.from("\0\0\0\x18ftypmp42\0\0\0\0"))?.mime).toBe("video/mp4");
    expect(sniffType(Buffer.from("\0\0\0\x14ftypqt  \0\0\0\0"))?.mime).toBe("video/quicktime");
    expect(sniffType(Buffer.from("\0\0\0\x18ftypheic\0\0\0\0"))?.mime).toBe("image/heic");
    expect(sniffType(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))?.mime).toBe("image/webp");
    expect(sniffType(Buffer.from("<html><script>alert(1)</script>"))).toBeNull();
    expect(sniffType(Buffer.from("MZ\x90\0\x03\0\0\0\x04\0\0\0"))).toBeNull();
  });

  it("cleans file names", () => {
    expect(cleanFilename("../../etc/passwd")).toBe("passwd");
    expect(cleanFilename("C:\\Users\\me\\IMG_0001.HEIC", { ext: "jpg" })).toBe("IMG_0001.jpg");
    expect(cleanFilename('a"<b>.pdf')).toBe("ab.pdf");
  });
});

describe("chunked uploads", () => {
  it("refuses people who may not upload, and files that are too big", async () => {
    await expect(startUpload(testDb, accountant, { purpose: "PROOF", filename: "x.jpg", size: 10, type: "image/jpeg" })).rejects.toThrow(/can't upload/);
    await expect(startUpload(testDb, crew, { purpose: "PROOF", filename: "big.mp4", size: 600 * 1024 * 1024, type: "video/mp4" })).rejects.toThrow(/too big/);
    await expect(startUpload(testDb, crew, { purpose: "PROOF", filename: "big.jpg", size: 30 * 1024 * 1024, type: "image/jpeg" })).rejects.toThrow(/too big/);
  });

  it("resumes from what the server has, and refuses pieces out of order", async () => {
    const data = Buffer.concat([await jpegWithLocation(), Buffer.alloc(CHUNK_BYTES + 10, 1)]);
    const { id } = await startUpload(testDb, crew, { purpose: "PROOF", filename: "p.jpg", size: data.length, type: "image/jpeg" });
    await appendChunk(testDb, crew, id, 0, data.subarray(0, CHUNK_BYTES));
    // A retry of the same piece after a dropped connection: told where to continue.
    const err = await appendChunk(testDb, crew, id, 0, data.subarray(0, CHUNK_BYTES)).catch((e) => e);
    expect(err).toBeInstanceOf(OffsetMismatchError);
    expect((err as OffsetMismatchError).received).toBe(CHUNK_BYTES);
    expect((await uploadStatus(testDb, crew, id)).received).toBe(CHUNK_BYTES);
    await expect(completeUpload(testDb, crew, id)).rejects.toBeInstanceOf(OffsetMismatchError);
    await appendChunk(testDb, crew, id, CHUNK_BYTES, data.subarray(CHUNK_BYTES));
    await expect(appendChunk(testDb, crew, id, data.length, Buffer.from([1]))).rejects.toThrow(/More data/);
    expect((await uploadStatus(testDb, crew, id)).received).toBe(data.length);
  });

  it("only the uploader can add to or finish an upload", async () => {
    const data = await jpegWithLocation(200, 200);
    const { id } = await startUpload(testDb, crew, { purpose: "PROOF", filename: "p.jpg", size: data.length, type: "image/jpeg" });
    await expect(appendChunk(testDb, otherCrew, id, 0, data)).rejects.toThrow(/not found/);
    await expect(completeUpload(testDb, otherCrew, id)).rejects.toThrow(/not found/);
    await expect(uploadStatus(testDb, vendor, id)).rejects.toThrow(/not found/);
  });

  it("refuses a disguised file on its first piece", async () => {
    const fake = Buffer.from("<!doctype html><script>steal()</script>".padEnd(400, " "));
    const { id } = await startUpload(testDb, vendor, { purpose: "PROOF", filename: "nice-photo.jpg", size: fake.length, type: "image/jpeg" });
    await expect(appendChunk(testDb, vendor, id, 0, fake)).rejects.toThrow(/can't be used here/);
    expect((await testDb.file.findUniqueOrThrow({ where: { id } })).status).toBe("FAILED");
  });

  it("documents take PDFs but not videos", async () => {
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
    const done = await upload(vendor, pdf, { purpose: "DOCUMENT", name: "invoice.pdf", type: "application/pdf" });
    expect(done.status).toBe("READY");
    expect(done.mime).toBe("application/pdf");
    const video = mp4WithLocation(1, "doc.mp4");
    await expect(upload(vendor, video, { purpose: "DOCUMENT", name: "invoice.pdf", type: "application/pdf" })).rejects.toThrow(/PDF or a photo/);
  });
});

describe("processing", () => {
  it("makes a thumbnail and a viewing copy of a photo, without the location", async () => {
    const photo = await jpegWithLocation();
    expect((await sharp(photo).metadata()).exif).toBeDefined();
    const done = await upload(crew, photo, { name: "IMG_2041.JPG" });
    expect(done.status).toBe("PROCESSING");
    await processFile(testDb, done.id);
    const f = await testDb.file.findUniqueOrThrow({ where: { id: done.id } });
    expect(f.status).toBe("READY");
    expect(f.filename).toBe("IMG_2041.jpg");
    expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(f.width).toBe(1600);
    const view = await sharp(path.join(localRoot(), f.playableKey!)).metadata();
    expect(view.width).toBe(1600);
    expect(view.exif).toBeUndefined();
    const thumb = await sharp(path.join(localRoot(), f.thumbnailKey!)).metadata();
    expect(Math.max(thumb.width!, thumb.height!)).toBe(480);
    // The original is kept exactly as uploaded.
    expect(await storage().size(f.storageKey)).toBe(photo.length);
  });

  it("converts a video into a small MP4 with no location tag", async () => {
    const clip = mp4WithLocation(3);
    expect(ffprobeTags(await writeTemp(clip)).location).toBeDefined();
    const done = await upload(crew, clip, { name: "walkthrough.mov", type: "video/quicktime" });
    await processFile(testDb, done.id);
    const f = await testDb.file.findUniqueOrThrow({ where: { id: done.id } });
    expect(f.status).toBe("READY");
    expect(f.durationSeconds).toBe(3);
    expect(f.playableKey).toMatch(/play\.mp4$/);
    const tags = ffprobeTags(path.join(localRoot(), f.playableKey!));
    expect(tags.location).toBeUndefined();
    expect(tags.title).toBeUndefined();
    expect(await storage().size(f.thumbnailKey!)).toBeGreaterThan(1000);
  }, 60_000);

  it("refuses a video longer than the owners' limit and tells the uploader", async () => {
    const company = await testDb.companyProfile.findUniqueOrThrow({ where: { id: 1 } });
    await testDb.companyProfile.update({ where: { id: 1 }, data: { settings: { ...(company.settings as object), maxVideoSeconds: 2 } } });
    try {
      const done = await upload(crew, mp4WithLocation(4, "long.mp4"), { name: "long.mp4", type: "video/mp4" });
      await processFile(testDb, done.id);
      const f = await testDb.file.findUniqueOrThrow({ where: { id: done.id } });
      expect(f.status).toBe("FAILED");
      expect(f.processingError).toMatch(/4 s long\. Videos can be up to 2 s/);
    } finally {
      await testDb.companyProfile.update({ where: { id: 1 }, data: { settings: company.settings ?? {} } });
    }
    expect(describeLength(130)).toBe("2 min 10 s");
  }, 60_000);
});

describe("signed links", () => {
  it("work only for the person, the file and the variant they were made for, until they expire", () => {
    const now = Date.now();
    const url = new URL(fileLink("user-a", "file-1", "thumb", now), "http://x");
    const e = url.searchParams.get("e");
    const s = url.searchParams.get("s");
    expect(checkFileLink("user-a", "file-1", "thumb", e, s, now)).toBe("ok");
    expect(checkFileLink("user-b", "file-1", "thumb", e, s, now)).toBe("invalid");
    expect(checkFileLink("user-a", "file-2", "thumb", e, s, now)).toBe("invalid");
    expect(checkFileLink("user-a", "file-1", "original", e, s, now)).toBe("invalid");
    expect(checkFileLink("user-a", "file-1", "thumb", String(Number(e) + 1), s, now)).toBe("invalid");
    expect(checkFileLink("user-a", "file-1", "thumb", e, s, now + 31 * 60_000)).toBe("expired");
  });

  it("only offer the original when asked", () => {
    const file = { id: "f", filename: "a.jpg", mimeType: "image/jpeg", status: "READY" as const, processingError: null, thumbnailKey: "k/thumb.jpg", playableKey: "k/view.jpg", durationSeconds: null, width: 1, height: 1 };
    expect(mediaView("u", file).originalUrl).toBeNull();
    expect(mediaView("u", file, { original: true }).originalUrl).toMatch(/\/original\?/);
    expect(mediaView("u", { ...file, status: "PROCESSING" }).thumbUrl).toBeNull();
  });
});

describe("housekeeping", () => {
  it("throws away abandoned uploads but never files in use", async () => {
    const photo = await jpegWithLocation(100, 100);
    const unused = await upload(crew, photo);
    const discarded = await upload(crew, photo);
    await discardUpload(testDb, crew, discarded.id);
    expect(await testDb.file.findUnique({ where: { id: discarded.id } })).toBeNull();

    const used = await upload(vendor, Buffer.from("%PDF-1.4\n%%EOF\n"), { purpose: "DOCUMENT", name: "q.pdf", type: "application/pdf" });
    const v = await testDb.vendor.create({ data: { contactName: "c", companyName: "Cleanup Co" } });
    await testDb.vendorInvoice.create({ data: { vendorId: v.id, invoiceNumber: "C-1", invoiceDate: new Date(), taxableAmount: 1, total: 1, fileId: used.id } });
    const old = new Date(Date.now() - 3 * 24 * 3600_000);
    await testDb.file.updateMany({ where: { id: { in: [unused.id, used.id] } }, data: { createdAt: old } });

    await cleanupAbandonedUploads(testDb);
    expect(await testDb.file.findUnique({ where: { id: unused.id } })).toBeNull();
    expect(await testDb.file.findUnique({ where: { id: used.id } })).not.toBeNull();
    await expect(discardUpload(testDb, vendor, used.id)).rejects.toThrow(/in use/);
  });
});

async function writeTemp(data: Buffer): Promise<string> {
  const { writeFile, mkdtemp } = await import("node:fs/promises");
  const os = await import("node:os");
  const dir = await mkdtemp(path.join(os.tmpdir(), "taamara-probe-"));
  const p = path.join(dir, "in.mp4");
  await writeFile(p, data);
  return p;
}
