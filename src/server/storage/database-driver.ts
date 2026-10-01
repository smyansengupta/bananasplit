import { serviceDb } from "@/server/db/clients";

import type { StoreName } from "./kinds";

/**
 * Blob storage in Postgres (the StoredBlob table), for a deployment with no
 * Vercel Blob store: club pictures, avatars, receipts, Notes files and
 * exports then work with nothing to set up. With a Blob store it is the
 * fallback, so nothing written before the store existed goes missing, and
 * an upload the store refuses still lands somewhere.
 *
 * The table has no grants; app.blob_put / blob_get / blob_delete /
 * blob_list (SECURITY DEFINER, app_service only) are the only way in. This
 * file is their one caller, and like every storage call it runs after the
 * route or action checked the permission of the row that names the key.
 * Each call is its own statement on the service pool, never inside a
 * request transaction (blob I/O stays out of them, as with Vercel Blob).
 *
 * Public blobs (avatars, logos) are served by /api/media/[...key].
 */

/** Where public blobs kept outside a public Blob store are served from. */
export const MEDIA_PREFIX = "/api/media/";

/** The largest blob the table takes (the CHECK says the same). Uploads stop at 4 MB. */
export const DATABASE_BLOB_MAX_BYTES = 25 * 1024 * 1024;

const LIST_PAGE = 1000;

/** The shape drivers.ts expects (kept structural here to avoid an import cycle). */
export interface DatabaseBlobDriver {
  readonly name: "database";
  put(
    store: StoreName,
    key: string,
    body: Buffer,
    options: { contentType: string },
  ): Promise<{ key: string; url: string | null }>;
  get(store: StoreName, key: string): Promise<{ body: Buffer; contentType: string } | null>;
  delete(store: StoreName, keys: readonly string[]): Promise<void>;
  list(store: StoreName, prefix: string, cursor?: string): Promise<{ keys: string[]; cursor?: string }>;
}

export class BlobExistsError extends Error {
  constructor(key: string) {
    super(`blob already exists: ${key}`);
    this.name = "BlobExistsError";
  }
}

export function databaseDriver(): DatabaseBlobDriver {
  return {
    name: "database",
    async put(store, key, body, options) {
      if (body.length > DATABASE_BLOB_MAX_BYTES) {
        throw new RangeError(`blob too large for database storage (${body.length} bytes)`);
      }
      const rows = await serviceDb.$queryRaw<{ stored: boolean | null }[]>`
        SELECT app.blob_put(${store}, ${key}, ${options.contentType}, ${new Uint8Array(body)}) AS stored`;
      if (!rows[0]?.stored) throw new BlobExistsError(key);
      return { key, url: store === "public" ? `${MEDIA_PREFIX}${key}` : null };
    },
    async get(store, key) {
      const rows = await serviceDb.$queryRaw<{ contentType: string; body: Uint8Array }[]>`
        SELECT "contentType", "body" FROM app.blob_get(${store}, ${key})`;
      const row = rows[0];
      return row ? { body: Buffer.from(row.body), contentType: row.contentType } : null;
    },
    async delete(store, keys) {
      for (let i = 0; i < keys.length; i += 500) {
        const batch = keys.slice(i, i + 500);
        await serviceDb.$queryRaw`SELECT app.blob_delete(${store}, ${batch}::text[])`;
      }
    },
    async list(store, prefix, cursor) {
      const rows = await serviceDb.$queryRaw<{ key: string }[]>`
        SELECT "key" FROM app.blob_list(${store}, ${prefix}, ${cursor ?? null}::text, ${LIST_PAGE}::int)`;
      const keys = rows.map((r) => r.key);
      return { keys, cursor: keys.length === LIST_PAGE ? keys[keys.length - 1] : undefined };
    },
  };
}
