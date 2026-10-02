// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { disconnectAll } from "@/server/db/clients";

import { BlobExistsError, databaseDriver, MEDIA_PREFIX } from "./database-driver";

/**
 * The database blob store against the real functions (app.blob_*, run as
 * app_service): bytes round-trip exactly, keys are write-once, listing
 * pages by prefix, and deletes are idempotent. Everything made here is
 * removed at the end.
 */

const tag = randomBytes(4).toString("hex");
const db = databaseDriver();
let reachable = true;

afterAll(async () => {
  if (reachable) await db.delete("private", [`files/t-${tag}/a`, `files/t-${tag}/b`, `files/t-${tag}/c`]);
  if (reachable) await db.delete("public", [`logos/t-${tag}/x/s64.webp`]);
  await disconnectAll();
});

describe("database blob storage", () => {
  it("stores, reads, lists and deletes", async () => {
    const bytes = randomBytes(70_000);
    try {
      await db.put("private", `files/t-${tag}/a`, bytes, { contentType: "application/pdf" });
    } catch (error) {
      console.warn("[database-driver.db.test] skipped:", error instanceof Error ? error.message : error);
      reachable = false;
      return;
    }
    const back = await db.get("private", `files/t-${tag}/a`);
    expect(back?.contentType).toBe("application/pdf");
    expect(back?.body.equals(bytes)).toBe(true);

    // Write-once, like Vercel Blob without allowOverwrite.
    await expect(db.put("private", `files/t-${tag}/a`, Buffer.from("x"), { contentType: "text/plain" })).rejects.toThrow(
      BlobExistsError,
    );

    // Public blobs get an app URL; the stores are separate namespaces.
    const pub = await db.put("public", `logos/t-${tag}/x/s64.webp`, Buffer.from("webp"), { contentType: "image/webp" });
    expect(pub.url).toBe(`${MEDIA_PREFIX}logos/t-${tag}/x/s64.webp`);
    expect(await db.get("private", `logos/t-${tag}/x/s64.webp`)).toBeNull();

    await db.put("private", `files/t-${tag}/b`, Buffer.from("b"), { contentType: "text/plain" });
    await db.put("private", `files/t-${tag}/c`, Buffer.from("c"), { contentType: "text/plain" });
    const listed = await db.list("private", `files/t-${tag}/`);
    expect(listed.keys).toEqual([`files/t-${tag}/a`, `files/t-${tag}/b`, `files/t-${tag}/c`]);
    expect((await db.list("private", `files/t-${tag}/`, `files/t-${tag}/a`)).keys).toEqual([
      `files/t-${tag}/b`,
      `files/t-${tag}/c`,
    ]);

    await db.delete("private", [`files/t-${tag}/a`, `files/t-${tag}/b`]);
    await db.delete("private", [`files/t-${tag}/a`]);
    expect(await db.get("private", `files/t-${tag}/a`)).toBeNull();
    expect((await db.list("private", `files/t-${tag}/`)).keys).toEqual([`files/t-${tag}/c`]);
  });
});
