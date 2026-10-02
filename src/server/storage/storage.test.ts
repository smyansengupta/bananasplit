// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  blobStoreIdFromToken,
  driverFor,
  isLocalStore,
  localDriver,
  publicIsProxied,
  withDatabaseFallback,
  type BlobDriver,
} from "./drivers";
import {
  assertBlobAllowed,
  MAX_UPLOAD_BYTES,
  ORG_SCOPED_KINDS,
  parseStorageKey,
  scopePrefix,
  storageKey,
  StorageKeyError,
  StorageLimitError,
  STORAGE_KINDS,
} from "./kinds";
import { readUpload, UploadError, uploadErrorResponse } from "./upload";

describe("storage kinds and keys", () => {
  it("every org-scoped kind is enumerated for the purge", () => {
    expect([...ORG_SCOPED_KINDS].sort()).toEqual(["exports", "files", "logos", "org-chart", "receipts"]);
    expect(STORAGE_KINDS.avatars.scope).toBe("user");
    expect(STORAGE_KINDS.receipts.store).toBe("private");
    expect(STORAGE_KINDS.logos.store).toBe("public");
  });

  it("builds {kind}/{scopeId}/... keys and refuses traversal or unregistered kinds", () => {
    expect(storageKey("receipts", "org_1", "tx_1", "abc.pdf")).toBe("receipts/org_1/tx_1/abc.pdf");
    expect(() => storageKey("receipts", "org_1", "..", "x")).toThrow(StorageKeyError);
    expect(() => storageKey("receipts", "org_1", "a/b")).toThrow(StorageKeyError);
    expect(() => storageKey("receipts", "../org", "x")).toThrow(StorageKeyError);
    expect(() => storageKey("receipts", "org_1")).toThrow(StorageKeyError);
    // @ts-expect-error unregistered kind
    expect(() => storageKey("uploads", "org_1", "x")).toThrow(StorageKeyError);
    expect(parseStorageKey("avatars/u1/abc/s64.webp")).toEqual({
      kind: "avatars",
      scopeId: "u1",
      segments: ["abc", "s64.webp"],
    });
    expect(() => parseStorageKey("avatars/u1/../../etc/passwd")).toThrow(StorageKeyError);
    expect(scopePrefix("logos", "org_1")).toBe("logos/org_1/");
  });

  /**
   * maxUploadBytes and contentTypes were declared per kind and read by
   * nothing: each route happened to cap and sniff on its own, so a new
   * caller inherited no limit and the declarations could drift from what
   * the code actually allowed.
   */
  describe("per-kind limits", () => {
    const ok = Buffer.alloc(16);

    it("refuses a content type the kind does not declare", () => {
      expect(() => assertBlobAllowed("receipts", "image/svg+xml", ok.length)).toThrow(
        StorageLimitError,
      );
      expect(() => assertBlobAllowed("avatars", "application/pdf", ok.length)).toThrow(
        /avatars does not accept application\/pdf/,
      );
      // The type is checked for server-made files too.
      expect(() =>
        assertBlobAllowed("exports", "text/html", ok.length, { serverGenerated: true }),
      ).toThrow(StorageLimitError);
      expect(() => assertBlobAllowed("receipts", "application/pdf", ok.length)).not.toThrow();
    });

    it("refuses an upload over the kind's cap", () => {
      const cap = STORAGE_KINDS.receipts.maxUploadBytes;
      expect(() => assertBlobAllowed("receipts", "application/pdf", cap)).not.toThrow();
      expect(() => assertBlobAllowed("receipts", "application/pdf", cap + 1)).toThrow(
        /limited to 4194304 bytes/,
      );
      expect(() => assertBlobAllowed("org-chart", "application/pdf", cap + 1)).toThrow(
        StorageLimitError,
      );
    });

    it("lets server-made files past the size cap, including the upload-free kind", () => {
      const huge = STORAGE_KINDS.receipts.maxUploadBytes * 4;
      // exports takes no user upload at all (maxUploadBytes 0)...
      expect(() => assertBlobAllowed("exports", "application/zip", 10)).toThrow(/takes no uploads/);
      // ...but the export job writes the zip and the per-table parts.
      for (const type of ["application/zip", "application/x-ndjson", "text/csv"]) {
        expect(() =>
          assertBlobAllowed("exports", type, huge, { serverGenerated: true }),
        ).not.toThrow();
      }
      // Re-encoded image variants are server-made as well.
      expect(() =>
        assertBlobAllowed("logos", "image/webp", huge, { serverGenerated: true }),
      ).not.toThrow();
    });

    it("every declared content type is a plain media type and every cap is sane", () => {
      for (const [kind, spec] of Object.entries(STORAGE_KINDS)) {
        expect(spec.contentTypes.length, kind).toBeGreaterThan(0);
        for (const type of spec.contentTypes) expect(type, kind).toMatch(/^[a-z]+\/[a-z0-9.+-]+$/);
        expect(spec.maxUploadBytes, kind).toBeLessThanOrEqual(MAX_UPLOAD_BYTES);
      }
    });
  });

  it("reads the store id out of a Blob token", () => {
    expect(blobStoreIdFromToken("vercel_blob_rw_AbC123xyz_secretpart")).toBe("AbC123xyz");
    expect(blobStoreIdFromToken("nope")).toBeNull();
    expect(blobStoreIdFromToken(undefined)).toBeNull();
  });

  it("uses the local driver without tokens, and the database on Vercel", () => {
    expect(driverFor("private", {}).name).toBe("local");
    expect(driverFor("public", { BLOB_PUBLIC_READ_WRITE_TOKEN: "vercel_blob_rw_x_y" }).name).toBe("vercel-blob");
    // Vercel's filesystem is read-only: no Blob store means Postgres, not an error.
    expect(driverFor("private", { VERCEL: "1" }).name).toBe("database");
    expect(driverFor("public", { VERCEL: "1" }).name).toBe("database");
    expect(isLocalStore("public", { VERCEL: "1" })).toBe(false);
    // FILE_STORAGE=database wins everywhere, even over a token.
    const forced = { FILE_STORAGE: "database", BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_x_y" };
    expect(driverFor("private", forced).name).toBe("database");
    expect(isLocalStore("private", { FILE_STORAGE: "database" })).toBe(false);
  });

  it("keeps public blobs in the private store when that is the only one", () => {
    const oneStore = { VERCEL: "1", BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_x_y" };
    expect(publicIsProxied(oneStore)).toBe(true);
    expect(driverFor("public", oneStore).name).toBe("vercel-blob");
    expect(publicIsProxied({ ...oneStore, BLOB_PUBLIC_READ_WRITE_TOKEN: "vercel_blob_rw_p_q" })).toBe(false);
    expect(publicIsProxied({})).toBe(false);
  });
});

describe("Vercel Blob with the database behind it", () => {
  function memoryDriver(name: BlobDriver["name"], opts: { failPuts?: boolean; failReads?: boolean } = {}) {
    const blobs = new Map<string, { body: Buffer; contentType: string }>();
    const driver: BlobDriver = {
      name,
      async put(store, key, body, options) {
        if (opts.failPuts) throw new Error("Vercel Blob: Cannot use private access on a public store");
        if (blobs.has(key)) throw new Error("This blob already exists");
        blobs.set(key, { body, contentType: options.contentType });
        return { key, url: store === "public" ? `https://store.example/${key}` : null };
      },
      async get(_store, key) {
        if (opts.failReads) throw new Error("store suspended");
        return blobs.get(key) ?? null;
      },
      async delete(_store, keys) {
        for (const k of keys) blobs.delete(k);
      },
      async list(_store, prefix, cursor) {
        const all = [...blobs.keys()].filter((k) => k.startsWith(prefix)).sort();
        const start = cursor ? all.indexOf(cursor) + 1 : 0;
        const keys = all.slice(start, start + 2);
        return { keys, cursor: start + 2 < all.length ? keys[keys.length - 1] : undefined };
      },
    };
    return { driver, blobs };
  }
  const opts = { contentType: "image/webp" };

  it("puts in the store, and in the database only when the store refuses", async () => {
    const store = memoryDriver("vercel-blob");
    const db = memoryDriver("database");
    const both = withDatabaseFallback(store.driver, db.driver);
    await both.put("public", "logos/o1/a/s64.webp", Buffer.from("a"), opts);
    expect(store.blobs.has("logos/o1/a/s64.webp")).toBe(true);
    expect(db.blobs.size).toBe(0);
    // An existing key is a real error, never a reason to write elsewhere.
    await expect(both.put("public", "logos/o1/a/s64.webp", Buffer.from("b"), opts)).rejects.toThrow(/already exists/);

    const refusing = withDatabaseFallback(memoryDriver("vercel-blob", { failPuts: true }).driver, db.driver);
    await refusing.put("private", "files/o1/f1", Buffer.from("pdf"), { contentType: "application/pdf" });
    expect(db.blobs.get("files/o1/f1")?.body.toString()).toBe("pdf");
  });

  it("reads the database when the store misses or fails, and deletes from both", async () => {
    const store = memoryDriver("vercel-blob");
    const db = memoryDriver("database");
    db.blobs.set("avatars/u1/x/s64.webp", { body: Buffer.from("old"), contentType: "image/webp" });
    store.blobs.set("avatars/u1/y/s64.webp", { body: Buffer.from("new"), contentType: "image/webp" });
    const both = withDatabaseFallback(store.driver, db.driver);
    expect((await both.get("public", "avatars/u1/x/s64.webp"))?.body.toString()).toBe("old");
    expect((await both.get("public", "avatars/u1/y/s64.webp"))?.body.toString()).toBe("new");
    expect(await both.get("public", "avatars/u1/z/s64.webp")).toBeNull();
    const failing = withDatabaseFallback(memoryDriver("vercel-blob", { failReads: true }).driver, db.driver);
    expect((await failing.get("public", "avatars/u1/x/s64.webp"))?.body.toString()).toBe("old");

    await both.delete("public", ["avatars/u1/x/s64.webp", "avatars/u1/y/s64.webp"]);
    expect(store.blobs.size + db.blobs.size).toBe(0);
  });

  it("lists the store, then the database, page by page", async () => {
    const store = memoryDriver("vercel-blob");
    const db = memoryDriver("database");
    for (const k of ["files/o1/a", "files/o1/b", "files/o1/c"]) store.blobs.set(k, { body: Buffer.from(k), contentType: "text/plain" });
    for (const k of ["files/o1/d", "files/o1/e", "files/o2/z"]) db.blobs.set(k, { body: Buffer.from(k), contentType: "text/plain" });
    const both = withDatabaseFallback(store.driver, db.driver);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const page = await both.list("private", "files/o1/", cursor);
      seen.push(...page.keys);
      cursor = page.cursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(["files/o1/a", "files/o1/b", "files/o1/c", "files/o1/d", "files/o1/e"]);
  });
});

describe("local driver", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "cbc-blob-"));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("puts, gets, lists and deletes, with a dev URL for public blobs only", async () => {
    const driver = localDriver(root);
    const pub = await driver.put("public", "logos/org_1/k1/s64.webp", Buffer.from("img"), {
      contentType: "image/webp",
    });
    expect(pub.url).toBe("/api/dev/blob/logos/org_1/k1/s64.webp");
    const priv = await driver.put("private", "receipts/org_1/tx/r.pdf", Buffer.from("%PDF-"), {
      contentType: "application/pdf",
    });
    expect(priv.url).toBeNull();
    await expect(
      driver.put("private", "receipts/org_1/tx/r.pdf", Buffer.from("again"), { contentType: "x" }),
    ).rejects.toThrow(/exists/);

    const got = await driver.get("private", "receipts/org_1/tx/r.pdf");
    expect(got?.contentType).toBe("application/pdf");
    expect(got?.body.toString()).toBe("%PDF-");
    expect((await driver.list("public", "logos/org_1/")).keys).toEqual(["logos/org_1/k1/s64.webp"]);
    await driver.delete("public", ["logos/org_1/k1/s64.webp"]);
    expect((await driver.list("public", "logos/org_1/")).keys).toEqual([]);
    expect(await driver.get("public", "logos/org_1/k1/s64.webp")).toBeNull();
  });
});

function multipart(parts: { name: string; filename?: string; type?: string; body: Buffer | string }[]) {
  const boundary = "----cbc-test-boundary";
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const disposition = part.filename
      ? `form-data; name="${part.name}"; filename="${part.filename}"`
      : `form-data; name="${part.name}"`;
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: ${disposition}\r\n`));
    if (part.type) chunks.push(Buffer.from(`Content-Type: ${part.type}\r\n`));
    chunks.push(Buffer.from("\r\n"), Buffer.from(part.body), Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), type: `multipart/form-data; boundary=${boundary}` };
}

describe("readUpload", () => {
  it("reads the file and the other fields", async () => {
    const mp = multipart([
      { name: "transactionId", body: "tx_1" },
      { name: "file", filename: "r.pdf", type: "application/pdf", body: "%PDF-1.7 hello" },
    ]);
    const upload = await readUpload(
      new Request("http://x/upload", { method: "POST", body: mp.body, headers: { "content-type": mp.type } }),
    );
    expect(upload.fields).toEqual({ transactionId: "tx_1" });
    expect(upload.file.filename).toBe("r.pdf");
    expect(upload.file.bytes.toString()).toBe("%PDF-1.7 hello");
  });

  it("answers 413 from Content-Length before reading the body", async () => {
    // A body that never delivers: reading it would hang the test.
    const body = new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => undefined),
    });
    const request = new Request("http://x/upload", {
      method: "POST",
      body,
      headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(5 * 1024 * 1024) },
      duplex: "half",
    } as RequestInit);
    const error = await readUpload(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UploadError);
    expect((error as UploadError).status).toBe(413);
  });

  it("stops a body without a length as soon as it passes the cap", async () => {
    const mp = multipart([{ name: "file", filename: "big.bin", body: Buffer.alloc(200_000, 1) }]);
    const request = new Request("http://x/upload", {
      method: "POST",
      body: mp.body,
      headers: { "content-type": mp.type },
    });
    const error = await readUpload(request, { maxBytes: 100_000 }).catch((e: unknown) => e);
    expect((error as UploadError).status).toBe(413);
    const res = uploadErrorResponse(error);
    expect(res.status).toBe(413);
  });

  it("refuses a non-multipart body and a missing file", async () => {
    const json = new Request("http://x", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    expect(((await readUpload(json).catch((e) => e)) as UploadError).status).toBe(415);
    const mp = multipart([{ name: "other", body: "x" }]);
    const empty = new Request("http://x", { method: "POST", body: mp.body, headers: { "content-type": mp.type } });
    expect(((await readUpload(empty).catch((e) => e)) as UploadError).status).toBe(400);
  });
});
