import { readFile, unlink } from "node:fs/promises";
import path from "node:path";

import { deleteBlobs, getBlob } from "@/server/storage";

/**
 * Receipt files live in the `receipts` storage kind (src/server/storage,
 * private store): receipts/{orgId}/{transactionId}/{randomId}.{ext}. New
 * uploads go through putBlob in the upload route; this module only reads and
 * deletes by the key stored in Receipt.blobKey.
 *
 * Keys written before the move to src/server/storage:
 * - Vercel Blob pathnames (receipts/{orgId}/{transactionId}/{uuid}-{suffix}.{ext})
 *   are valid storage keys of the same private store, so getBlob reads them.
 * - `local:{flattened key}` files under .data/receipts/ (local development
 *   only, before the local driver existed) are read and deleted here.
 *
 * Blob I/O is network I/O: call these outside any transaction (asserted by
 * src/server/storage), after the caller re-checked the row's permission.
 */

const LEGACY_LOCAL_PREFIX = "local:";
const LEGACY_LOCAL_DIR = path.join(process.cwd(), ".data", "receipts");

function legacyLocalPath(blobKey: string): string {
  // The legacy key was the storage key with every separator flattened to "_".
  const name = path.basename(blobKey.slice(LEGACY_LOCAL_PREFIX.length));
  return path.join(LEGACY_LOCAL_DIR, name);
}

/** The receipt's bytes, or null when the file is gone. */
export async function readReceiptBlob(blobKey: string): Promise<Buffer | null> {
  if (blobKey.startsWith(LEGACY_LOCAL_PREFIX)) {
    return readFile(legacyLocalPath(blobKey)).catch(() => null);
  }
  const blob = await getBlob(blobKey);
  return blob?.body ?? null;
}

/** Deletes receipt files (idempotent). A failure is logged, never thrown. */
export async function deleteReceiptBlobs(blobKeys: readonly string[]): Promise<void> {
  const legacy = blobKeys.filter((k) => k.startsWith(LEGACY_LOCAL_PREFIX));
  const current = blobKeys.filter((k) => !k.startsWith(LEGACY_LOCAL_PREFIX));
  for (const key of legacy) {
    await unlink(legacyLocalPath(key)).catch(() => undefined);
  }
  if (current.length > 0) {
    await deleteBlobs(current).catch((error) => {
      console.error("[receipts] deleting a receipt blob failed", error);
    });
  }
}
