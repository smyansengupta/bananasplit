/**
 * The storage kind registry ('File storage and images' decision). Every
 * stored file belongs to exactly one kind, and every key starts with it:
 *
 *   {kind}/{orgId}/...    org files (receipts, logos, exports, org-chart)
 *   avatars/{userId}/...  user files
 *
 * putBlob() accepts only a registered kind, and the org purge enumerates the
 * org-scoped kinds from ORG_SCOPED_KINDS, so nothing an org uploads can be
 * orphaned by a layout the purge does not know.
 *
 * Stores: `private` (BLOB_READ_WRITE_TOKEN; read back only server-side,
 * after a permission check) and `public` (BLOB_PUBLIC_READ_WRITE_TOKEN;
 * served by URL, for re-encoded images only). Access mode is fixed per
 * Vercel Blob store, hence two stores.
 */

export type StoreName = "private" | "public";

export interface StorageKind {
  store: StoreName;
  scope: "org" | "user";
  /** Upload cap for user uploads of this kind (bytes); server-made files are exempt. */
  maxUploadBytes: number;
  /** Content types accepted for this kind (after magic-byte sniffing). */
  contentTypes: readonly string[];
  description: string;
}

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export const STORAGE_KINDS = {
  receipts: {
    store: "private",
    scope: "org",
    maxUploadBytes: MAX_UPLOAD_BYTES,
    contentTypes: ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"],
    description: "Expense receipts: receipts/{orgId}/{transactionId}/{randomId}.{ext}",
  },
  "org-chart": {
    store: "private",
    scope: "org",
    maxUploadBytes: MAX_UPLOAD_BYTES,
    contentTypes: [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
      "text/markdown",
    ],
    description: "Org chart source documents: org-chart/{orgId}/{versionId}/{randomId}.{ext}",
  },
  exports: {
    store: "private",
    scope: "org",
    maxUploadBytes: 0,
    contentTypes: ["application/zip"],
    description: "OWNER data exports: exports/{orgId}/{exportId}.zip (server-made)",
  },
  logos: {
    store: "public",
    scope: "org",
    maxUploadBytes: MAX_UPLOAD_BYTES,
    contentTypes: IMAGE_TYPES,
    description: "Org logos, re-encoded WebP variants: logos/{orgId}/{randomId}/s{size}.webp",
  },
  avatars: {
    store: "public",
    scope: "user",
    maxUploadBytes: MAX_UPLOAD_BYTES,
    contentTypes: IMAGE_TYPES,
    description: "Profile pictures, re-encoded WebP variants: avatars/{userId}/{randomId}/s{size}.webp",
  },
} as const satisfies Record<string, StorageKind>;

export type StorageKindName = keyof typeof STORAGE_KINDS;

export const ORG_SCOPED_KINDS = (Object.keys(STORAGE_KINDS) as StorageKindName[]).filter(
  (k) => STORAGE_KINDS[k].scope === "org",
);

export function isStorageKind(value: string): value is StorageKindName {
  return Object.prototype.hasOwnProperty.call(STORAGE_KINDS, value);
}

const SCOPE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/;

export class StorageKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageKeyError";
  }
}

/**
 * Builds `{kind}/{scopeId}/{...segments}`. Segments are single path parts
 * (no slashes, no "..", no leading dot); client file names never go into a
 * key (store them in the database instead).
 */
export function storageKey(kind: StorageKindName, scopeId: string, ...segments: string[]): string {
  if (!isStorageKind(kind)) throw new StorageKeyError(`unregistered storage kind ${String(kind)}`);
  if (!SCOPE_ID.test(scopeId)) throw new StorageKeyError("invalid scope id");
  if (segments.length === 0) throw new StorageKeyError("a key needs at least one segment");
  for (const s of segments) {
    if (!SEGMENT.test(s) || s.includes("..")) throw new StorageKeyError(`invalid key segment ${s}`);
  }
  return [kind, scopeId, ...segments].join("/");
}

export interface ParsedStorageKey {
  kind: StorageKindName;
  scopeId: string;
  segments: string[];
}

/** Parses and validates a key; throws StorageKeyError for anything malformed. */
export function parseStorageKey(key: string): ParsedStorageKey {
  const [kind, scopeId, ...segments] = key.split("/");
  if (!kind || !isStorageKind(kind)) throw new StorageKeyError("unregistered storage kind");
  if (!scopeId || !SCOPE_ID.test(scopeId)) throw new StorageKeyError("invalid scope id");
  if (segments.length === 0) throw new StorageKeyError("a key needs at least one segment");
  for (const s of segments) {
    if (!SEGMENT.test(s) || s.includes("..")) throw new StorageKeyError("invalid key segment");
  }
  return { kind, scopeId, segments };
}

/** The key prefix that holds every file of `kind` for one org or user. */
export function scopePrefix(kind: StorageKindName, scopeId: string): string {
  if (!SCOPE_ID.test(scopeId)) throw new StorageKeyError("invalid scope id");
  return `${kind}/${scopeId}/`;
}
