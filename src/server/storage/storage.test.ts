// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  blobStoreIdFromToken,
  driverFor,
  localDriver,
  publicIsProxied,
  StorageConfigError,
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
    expect([...ORG_SCOPED_KINDS].sort()).toEqual(["exports", "logos", "org-chart", "receipts"]);
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

  it("uses the local driver without tokens, and refuses to on Vercel", () => {
    expect(driverFor("private", {}).name).toBe("local");
    expect(driverFor("public", { BLOB_PUBLIC_READ_WRITE_TOKEN: "vercel_blob_rw_x_y" }).name).toBe("vercel-blob");
    expect(() => driverFor("private", { VERCEL: "1" })).toThrow(StorageConfigError);
  });

  it("keeps public blobs in the private store when that is the only one", () => {
    const oneStore = { VERCEL: "1", BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_x_y" };
    expect(publicIsProxied(oneStore)).toBe(true);
    expect(driverFor("public", oneStore).name).toBe("vercel-blob");
    expect(publicIsProxied({ ...oneStore, BLOB_PUBLIC_READ_WRITE_TOKEN: "vercel_blob_rw_p_q" })).toBe(false);
    expect(publicIsProxied({})).toBe(false);
    expect(() => driverFor("public", { VERCEL: "1" })).toThrow(StorageConfigError);
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
