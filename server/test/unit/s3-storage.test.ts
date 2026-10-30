import { createHash, createHmac, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { text } from "node:stream/consumers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { createStorage, LocalDiskStorage, S3Storage } from "../../src/services/storage.js";

const s3Env = { S3_ENDPOINT: "https://acct.r2.cloudflarestorage.com", S3_BUCKET: "lms", S3_ACCESS_KEY_ID: "id", S3_SECRET_ACCESS_KEY: "secret" };

/** Recompute the AWS Signature V4 for a received request, independently of the signing library. */
function signatureIsValid(req: IncomingMessage, secret: string): boolean {
  const m = /^AWS4-HMAC-SHA256 Credential=[^/]+\/(\d{8})\/([^/]+)\/s3\/aws4_request, ?SignedHeaders=([^,]+), ?Signature=([0-9a-f]{64})$/.exec(req.headers.authorization ?? "");
  if (!m) return false;
  const [, date, region, signedHeaders, signature] = m as unknown as [string, string, string, string, string];
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  const hmac = (key: string | Buffer, s: string) => createHmac("sha256", key).update(s).digest();
  const canonicalHeaders = signedHeaders
    .split(";")
    .map((h) => `${h}:${String(req.headers[h]).trim()}\n`)
    .join("");
  const canonicalRequest = [req.method, req.url, "", canonicalHeaders, signedHeaders, req.headers["x-amz-content-sha256"]].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", req.headers["x-amz-date"], `${date}/${region}/s3/aws4_request`, sha(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), "s3"), "aws4_request");
  return hmac(signingKey, stringToSign).toString("hex") === signature;
}

describe("S3Storage", () => {
  const objects = new Map<string, Buffer>();
  const requests: { method: string; url: string; auth: string; sha: string | undefined; valid: boolean }[] = [];
  let failWith: number | null = null;
  let server: Server;
  let storage: S3Storage;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const url = req.url ?? "";
        requests.push({ method: req.method ?? "", url, auth: req.headers.authorization ?? "", sha: req.headers["x-amz-content-sha256"] as string | undefined, valid: signatureIsValid(req, "test-secret") });
        if (failWith) return void res.writeHead(failWith).end();
        if (req.method === "PUT") objects.set(url, Buffer.concat(chunks));
        if (req.method === "DELETE") {
          objects.delete(url);
          return void res.writeHead(204).end();
        }
        if (req.method === "GET") {
          const body = objects.get(url);
          if (!body) return void res.writeHead(404).end();
          return void res.writeHead(200).end(body);
        }
        res.writeHead(200).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    storage = new S3Storage({ endpoint: `http://127.0.0.1:${port}/`, bucket: "lms", accessKeyId: "test-id", secretAccessKey: "test-secret", region: "auto" });
  });
  afterAll(() => server.close());

  it("stores, reads and removes an object with signed requests", async () => {
    const key = randomUUID();
    const data = Buffer.from("hello object storage");
    await storage.put(key, data);

    const put = requests.at(-1)!;
    expect(put.method).toBe("PUT");
    expect(put.url).toBe(`/lms/uploads/${key.slice(0, 2)}/${key}`);
    expect(put.auth).toMatch(/^AWS4-HMAC-SHA256 Credential=test-id\/\d{8}\/auto\/s3\/aws4_request/);
    expect(put.auth).not.toContain("test-secret");
    expect(put.sha).toBe(createHash("sha256").update(data).digest("hex"));

    expect(await text(await storage.read(key))).toBe("hello object storage");

    await storage.remove(key);
    await expect(storage.read(key)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("signs every request with a valid AWS Signature V4", async () => {
    const key = randomUUID();
    requests.length = 0;
    await storage.put(key, Buffer.from("signed"));
    await (await storage.read(key)).toArray();
    await storage.remove(key);
    expect(requests.map((r) => [r.method, r.valid])).toEqual([["PUT", true], ["GET", true], ["DELETE", true]]);
  });

  it("produces a signature the verifier rejects when the secret is wrong", async () => {
    const { port } = server.address() as AddressInfo;
    const wrong = new S3Storage({ endpoint: `http://127.0.0.1:${port}`, bucket: "lms", accessKeyId: "test-id", secretAccessKey: "wrong-secret", region: "auto" });
    await wrong.put(randomUUID(), Buffer.from("x"));
    expect(requests.at(-1)!.valid).toBe(false);
  });

  it("treats removing a missing object as success", async () => {
    await expect(storage.remove(randomUUID())).resolves.toBeUndefined();
  });

  it("reports a failed upload without exposing credentials", async () => {
    failWith = 403;
    try {
      const err = await storage.put(randomUUID(), Buffer.from("x")).catch((e: Error) => e);
      expect((err as Error).message).toBe("Object storage upload failed with status 403");
    } finally {
      failWith = null;
    }
  });

  it("refuses keys that are not server-generated UUIDs", async () => {
    await expect(storage.read("../../secret")).rejects.toThrow("Invalid storage key");
  });
});

describe("storage configuration", () => {
  it("uses local disk when S3 is not configured, including blank values", () => {
    expect(createStorage(loadConfig({}))).toBeInstanceOf(LocalDiskStorage);
    expect(createStorage(loadConfig({ S3_ENDPOINT: "", S3_BUCKET: "", S3_ACCESS_KEY_ID: "", S3_SECRET_ACCESS_KEY: "" }))).toBeInstanceOf(LocalDiskStorage);
  });

  it("uses object storage when fully configured", () => {
    const config = loadConfig(s3Env);
    expect(config.s3?.region).toBe("auto");
    expect(createStorage(config)).toBeInstanceOf(S3Storage);
  });

  it("refuses to start with a partial or invalid setup", () => {
    expect(() => loadConfig({ ...s3Env, S3_SECRET_ACCESS_KEY: "" })).toThrow(/must all be set together/);
    expect(() => loadConfig({ ...s3Env, S3_ENDPOINT: "not a url" })).toThrow(/must be a URL/);
  });
});
