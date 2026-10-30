import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { AwsClient } from "aws4fetch";
import type { Config } from "../config.js";

/** Private object storage. Keys are server-generated UUIDs; never user-controlled paths. */
export interface FileStorage {
  put(key: string, data: Buffer): Promise<void>;
  read(key: string): Promise<Readable>;
  remove(key: string): Promise<void>;
}

const KEY_RE = /^[0-9a-f-]{36}$/;

export class LocalDiskStorage implements FileStorage {
  constructor(private readonly root: string) {}

  private pathFor(key: string): string {
    if (!KEY_RE.test(key)) throw new Error("Invalid storage key");
    // Two-level fan-out keeps directories small.
    return path.join(this.root, key.slice(0, 2), key);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const p = this.pathFor(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data, { flag: "wx", mode: 0o600 });
  }

  async read(key: string): Promise<Readable> {
    const p = this.pathFor(key);
    await stat(p); // throws ENOENT if missing
    return createReadStream(p);
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}

export interface S3Options {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

/** S3-compatible object storage (Cloudflare R2, Supabase Storage, Amazon S3, MinIO…). The bucket stays private. */
export class S3Storage implements FileStorage {
  private readonly client: AwsClient;

  constructor(private readonly opts: S3Options) {
    this.client = new AwsClient({ accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey, service: "s3", region: opts.region, retries: 2 });
  }

  private urlFor(key: string): string {
    if (!KEY_RE.test(key)) throw new Error("Invalid storage key");
    return `${this.opts.endpoint.replace(/\/+$/, "")}/${encodeURIComponent(this.opts.bucket)}/uploads/${key.slice(0, 2)}/${key}`;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const res = await this.client.fetch(this.urlFor(key), {
      method: "PUT",
      body: new Uint8Array(data),
      headers: { "Content-Type": "application/octet-stream", "X-Amz-Content-Sha256": createHash("sha256").update(data).digest("hex") },
    });
    if (!res.ok) throw new Error(`Object storage upload failed with status ${res.status}`);
  }

  async read(key: string): Promise<Readable> {
    const res = await this.client.fetch(this.urlFor(key));
    if (res.status === 404) throw Object.assign(new Error("not found"), { code: "ENOENT" });
    if (!res.ok || !res.body) throw new Error(`Object storage download failed with status ${res.status}`);
    return Readable.fromWeb(res.body as WebReadableStream);
  }

  async remove(key: string): Promise<void> {
    const res = await this.client.fetch(this.urlFor(key), { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`Object storage delete failed with status ${res.status}`);
  }
}

/** Object storage when S3_* is configured, otherwise the local private directory. */
export function createStorage(config: Config): FileStorage {
  return config.s3 ? new S3Storage(config.s3) : new LocalDiskStorage(config.FILE_STORAGE_DIR);
}

/** In-memory storage for tests. */
export class MemoryStorage implements FileStorage {
  readonly files = new Map<string, Buffer>();
  async put(key: string, data: Buffer) {
    this.files.set(key, data);
  }
  async read(key: string) {
    const data = this.files.get(key);
    if (!data) throw Object.assign(new Error("not found"), { code: "ENOENT" });
    return Readable.from(data);
  }
  async remove(key: string) {
    this.files.delete(key);
  }
}
