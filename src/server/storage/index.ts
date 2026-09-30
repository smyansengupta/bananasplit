import { randomBytes } from "node:crypto";

import { assertNoTx } from "@/server/db/context";

import { driverFor, type PutOptions, type StoredBlob } from "./drivers";
import {
  assertBlobAllowed,
  ORG_SCOPED_KINDS,
  parseStorageKey,
  scopePrefix,
  storageKey,
  STORAGE_KINDS,
  type StorageKindName,
} from "./kinds";

/**
 * File storage for every kind in ./kinds.ts (receipts, org-chart sources,
 * exports, logos, avatars).
 *
 * Rules ('File storage and images' decision):
 * - Blob I/O is network I/O: never inside a database transaction (asserted).
 *   Write the blob first, then the row; if the row write fails, delete the
 *   blob. To replace or delete, change the row first and delete the old
 *   blob after the transaction commits.
 * - Keys are built by storageKey(); the kind decides the store. Client file
 *   names never go into keys.
 * - Private blobs are read back only server-side, after the route re-checks
 *   the permission of the row that references them.
 */

export {
  MAX_UPLOAD_BYTES,
  ORG_SCOPED_KINDS,
  STORAGE_KINDS,
  StorageKeyError,
  StorageLimitError,
  assertBlobAllowed,
  parseStorageKey,
  scopePrefix,
  storageKey,
  type StorageKindName,
} from "./kinds";
export { StorageConfigError, blobStoreIdFromToken, type StoredBlob } from "./drivers";

/** What an upload route tells the user when no Blob store is configured. */
export const STORAGE_NOT_SET_UP =
  "File storage isn't set up on this server yet, so this can't be saved. Ask whoever runs Clubport to add a Vercel Blob store.";

/** A random, URL-safe id for immutable keys. */
export function randomKeyId(bytes = 12): string {
  return randomBytes(bytes).toString("base64url");
}

function storeOf(key: string) {
  return STORAGE_KINDS[parseStorageKey(key).kind].store;
}

/**
 * Stores `body` under `{kind}/{scopeId}/{...segments}`, within the kind's
 * declared contentTypes and maxUploadBytes. Pass `serverGenerated: true`
 * only for bytes the server made itself, which skips the size cap.
 */
export async function putBlob(
  kind: StorageKindName,
  scopeId: string,
  segments: string[],
  body: Buffer,
  options: PutOptions,
): Promise<StoredBlob> {
  assertNoTx("putBlob");
  const key = storageKey(kind, scopeId, ...segments);
  assertBlobAllowed(kind, options.contentType, body.length, {
    serverGenerated: options.serverGenerated,
  });
  const store = STORAGE_KINDS[kind].store;
  return driverFor(store).put(store, key, body, {
    ...options,
    cacheControlMaxAge: options.cacheControlMaxAge ?? (store === "public" ? 31_536_000 : undefined),
  });
}

/** Reads a blob (server-side only; check the permission first). */
export async function getBlob(key: string): Promise<{ body: Buffer; contentType: string } | null> {
  assertNoTx("getBlob");
  const store = storeOf(key);
  return driverFor(store).get(store, key);
}

/** Deletes blobs (idempotent). Keys may span kinds and stores. */
export async function deleteBlobs(keys: readonly string[]): Promise<void> {
  assertNoTx("deleteBlobs");
  const byStore = new Map<"private" | "public", string[]>();
  for (const key of keys) {
    const store = storeOf(key);
    byStore.set(store, [...(byStore.get(store) ?? []), key]);
  }
  for (const [store, list] of byStore) {
    await driverFor(store).delete(store, list);
  }
}

/** Every key under `prefix` in the kind's store (follows pagination). */
export async function listBlobs(kind: StorageKindName, prefix: string): Promise<string[]> {
  assertNoTx("listBlobs");
  if (!prefix.startsWith(`${kind}/`)) throw new TypeError("prefix must start with the kind");
  const store = STORAGE_KINDS[kind].store;
  const driver = driverFor(store);
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await driver.list(store, prefix, cursor);
    keys.push(...page.keys);
    cursor = page.cursor;
  } while (cursor);
  return keys;
}

/**
 * Deletes every blob of one org (or user) for `kind`, listing until empty.
 * Idempotent; the org purge calls it for each of ORG_SCOPED_KINDS.
 */
export async function deleteScope(kind: StorageKindName, scopeId: string): Promise<number> {
  const prefix = scopePrefix(kind, scopeId);
  let deleted = 0;
  for (let round = 0; round < 100; round++) {
    const keys = await listBlobs(kind, prefix);
    if (keys.length === 0) break;
    await deleteBlobs(keys);
    deleted += keys.length;
  }
  return deleted;
}

/** Deletes every org-scoped blob of `orgId` across all org kinds (org purge). */
export async function deleteOrgBlobs(orgId: string): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const kind of ORG_SCOPED_KINDS) {
    result[kind] = await deleteScope(kind, orgId);
  }
  return result;
}
