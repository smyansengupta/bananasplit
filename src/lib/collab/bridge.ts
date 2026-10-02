import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

/**
 * The collaboration bridge (docs/features/collaboration.md): the
 * collaboration server's calls into the app (load a note's document, store
 * it) and the app's call into the collaboration server (revoke: close every
 * connection to a document). Server to server only, never from a browser.
 *
 * Each call is a JSON POST signed with a key derived from COLLAB_SECRET
 * (domain-separated from the token key):
 *
 *   x-collab-timestamp: <ms>
 *   x-collab-signature: base64url(HMAC-SHA256(key, "<ts>.<operation>.<body>"))
 *
 * The receiver refuses a signature more than 5 minutes off its clock, one
 * made for another operation, and any change to the body. The operation
 * name, not the URL path, is signed, so a proxy that rewrites paths does not
 * break it. Replaying a request inside the window is harmless: a load only
 * reads, a store merges (the same state twice changes nothing) and a revoke
 * only makes clients reconnect.
 *
 * The user id in a load or store is the one the collaboration server took
 * from that user's verified token (the last writer, for a store). The app
 * trusts the collaboration server for that and nothing more: it opens the
 * user's own RLS context (withOrgTxAs), so the database applies the note
 * rules to that user exactly as it does to an autosave.
 */

export type BridgeOperation = "load" | "store" | "revoke";

/** Where each operation is served: the app's routes and the collaboration server's endpoint. */
export const BRIDGE_PATHS: Record<BridgeOperation, string> = {
  load: "/api/collab/load",
  store: "/api/collab/store",
  revoke: "/revoke",
};

export const TIMESTAMP_HEADER = "x-collab-timestamp";
export const SIGNATURE_HEADER = "x-collab-signature";

/** Largest Yjs state the bridge moves (under Vercel's ~4.5 MB request body once base64-encoded). */
export const MAX_STATE_BYTES = 3 * 1024 * 1024;
/** The body cap that follows from it (base64 is 4/3 the size, plus the JSON around it). */
export const MAX_BODY_BYTES = Math.ceil((MAX_STATE_BYTES * 4) / 3) + 16 * 1024;

const WINDOW_MS = 5 * 60 * 1000;

function key(secret: string): Buffer {
  return createHmac("sha256", secret).update("cbc-collab-bridge:v1").digest();
}

function mac(secret: string, timestamp: string, operation: BridgeOperation, body: string): string {
  return createHmac("sha256", key(secret))
    .update(`${timestamp}.${operation}.${body}`)
    .digest("base64url");
}

/** Headers for a signed bridge request carrying `body`. */
export function signBridgeRequest(
  operation: BridgeOperation,
  body: string,
  secret: string,
  now = Date.now(),
): Record<string, string> {
  const timestamp = String(now);
  return {
    "content-type": "application/json",
    [TIMESTAMP_HEADER]: timestamp,
    [SIGNATURE_HEADER]: mac(secret, timestamp, operation, body),
  };
}

/** Whether `body` arrived with a valid, current signature for `operation`. */
export function verifyBridgeRequest(
  operation: BridgeOperation,
  body: string,
  header: (name: string) => string | null | undefined,
  secret: string,
  now = Date.now(),
): boolean {
  const timestamp = header(TIMESTAMP_HEADER) ?? "";
  const signature = header(SIGNATURE_HEADER) ?? "";
  if (!/^\d{1,16}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > WINDOW_MS) return false;
  if (!signature || signature.length > 100) return false;
  const expected = Buffer.from(mac(secret, timestamp, operation, body));
  const provided = Buffer.from(signature);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

const documentName = z.string().min(1).max(200);
const userId = z.string().min(1).max(64);

export const loadRequestSchema = z.object({ documentName, userId });
export const storeRequestSchema = z.object({
  documentName,
  userId,
  /** base64 Y.encodeStateAsUpdate of the whole live document. */
  state: z.string().min(1).max(MAX_BODY_BYTES),
});
export const revokeRequestSchema = z.object({
  documentName,
  /**
   * The app's clock (ms) at the revoke: tokens it minted before then no
   * longer open the document (compared on the app's own clock, so skew
   * between the two hosts does not matter).
   */
  notBefore: z.number().int().nonnegative(),
});

export type LoadRequest = z.infer<typeof loadRequestSchema>;
export type StoreRequest = z.infer<typeof storeRequestSchema>;

export interface LoadResponse {
  /** base64 Yjs update to apply to the empty server document. */
  state: string;
}

export interface StoreResponse {
  /** The note's version after the save, or null when nothing changed. */
  version: number | null;
  /**
   * base64 Yjs update the live document is missing (an autosave that landed
   * in between, merged in by the app), or null.
   */
  update: string | null;
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

export function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}
