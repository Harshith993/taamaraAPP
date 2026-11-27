/**
 * Amazon S3 storage (Phase 10, D5): a private bucket in Mumbai (ap-south-1), never public. Files are
 * served only through our own signed links (D24), so the bucket needs no public access or CORS.
 *
 *   STORAGE_DRIVER=s3  S3_BUCKET=taamara-files  AWS_REGION=ap-south-1
 *   Credentials come from the server's IAM role (or the usual AWS_* variables). S3_ENDPOINT is only for
 *   tests against a local S3-compatible server.
 *
 * Objects are written with server-side encryption (SSE-S3). Uploads arrive in 4 MB pieces on our own
 * server first (D23) and are moved here whole.
 */
import { createReadStream, createWriteStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import { assertSafeKey, type ByteRange, type StorageDriver } from "./index";

export interface S3Options {
  bucket: string;
  region?: string;
  endpoint?: string;
  /** Path-style URLs (local test servers). */
  forcePathStyle?: boolean;
  credentials?: S3ClientConfig["credentials"];
  /** Server-side encryption; off only for test servers that don't support it. */
  encrypt?: boolean;
}

export class S3Storage implements StorageDriver {
  readonly name = "s3";
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly encrypt: boolean;

  constructor(opts: S3Options) {
    if (!opts.bucket) throw new Error("S3_BUCKET is not set.");
    this.bucket = opts.bucket;
    this.encrypt = opts.encrypt ?? true;
    this.client = new S3Client({
      region: opts.region ?? "ap-south-1",
      endpoint: opts.endpoint,
      forcePathStyle: opts.forcePathStyle,
      credentials: opts.credentials,
      // Plain uploads with a Content-Length: no aws-chunked streaming checksums, which some
      // S3-compatible servers store as part of the file. Integrity is checked by our own sha256.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  static fromEnv(): S3Storage {
    return new S3Storage({
      bucket: process.env.S3_BUCKET ?? "",
      region: process.env.AWS_REGION || "ap-south-1",
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: Boolean(process.env.S3_ENDPOINT),
      encrypt: process.env.S3_ENCRYPT !== "false",
    });
  }

  private put(key: string, body: Buffer | Readable, contentType: string, length: number) {
    assertSafeKey(key);
    return this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, ContentLength: length, ...(this.encrypt ? { ServerSideEncryption: "AES256" } : {}) }),
    );
  }

  async putFromPath(key: string, localPath: string, contentType: string): Promise<void> {
    const { size } = await stat(localPath);
    await this.put(key, createReadStream(localPath), contentType, size);
    await rm(localPath, { force: true });
  }

  async putBuffer(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.put(key, data, contentType, data.length);
  }

  async size(key: string): Promise<number | null> {
    assertSafeKey(key);
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return r.ContentLength ?? 0;
    } catch (err) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === "NotFound" || e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
  }

  async read(key: string, range?: ByteRange): Promise<Readable> {
    assertSafeKey(key);
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: range ? `bytes=${range.start}-${range.end}` : undefined }));
    return r.Body as Readable;
  }

  async copyToPath(key: string, localPath: string): Promise<void> {
    await pipeline(await this.read(key), createWriteStream(localPath));
  }

  async remove(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
