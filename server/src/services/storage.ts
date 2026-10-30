import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";

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

/** In-memory storage for tests. */
export class MemoryStorage implements FileStorage {
  readonly files = new Map<string, Buffer>();
  async put(key: string, data: Buffer) {
    this.files.set(key, data);
  }
  async read(key: string) {
    const data = this.files.get(key);
    if (!data) throw Object.assign(new Error("not found"), { code: "ENOENT" });
    const { Readable } = await import("node:stream");
    return Readable.from(data);
  }
  async remove(key: string) {
    this.files.delete(key);
  }
}
