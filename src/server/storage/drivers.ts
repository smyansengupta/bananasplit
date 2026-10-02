import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { BlobExistsError, databaseDriver, MEDIA_PREFIX } from "./database-driver";
import type { StoreName } from "./kinds";

/**
 * Blob drivers, picked per store by driverFor():
 *
 * - Vercel Blob when the store's token is set (BLOB_READ_WRITE_TOKEN for
 *   private, BLOB_PUBLIC_READ_WRITE_TOKEN for public). With only the private
 *   token, public blobs live in the private store and are served by
 *   /api/media/[...key] (proxiedPublicDriver).
 * - The database (StoredBlob, ./database-driver.ts) on Vercel with no Blob
 *   store, so uploads work on a fresh deployment, and as the fallback behind
 *   Vercel Blob: an upload the store refuses (wrong store type, suspended,
 *   down) is kept in the database, and reads that miss the store look there.
 *   FILE_STORAGE=database picks it everywhere (local runs, or by choice).
 * - Otherwise the local filesystem under .data/blob/{store}/ (development);
 *   public local files are served by the dev-only /api/dev/blob/[...key].
 */

export interface PutOptions {
  contentType: string;
  /** Browser/CDN cache lifetime in seconds (public store). */
  cacheControlMaxAge?: number;
  signal?: AbortSignal;
  /**
   * The server made these bytes (an export part, a re-encoded image
   * variant), so the kind's user-upload size cap does not apply. Its
   * content types still do. Never set it for bytes that came from a
   * request body.
   */
  serverGenerated?: boolean;
}

export interface StoredBlob {
  key: string;
  /** Public URL (public store), or null (private store). */
  url: string | null;
}

export interface BlobDriver {
  readonly name: "vercel-blob" | "local" | "database";
  put(store: StoreName, key: string, body: Buffer, options: PutOptions): Promise<StoredBlob>;
  get(store: StoreName, key: string): Promise<{ body: Buffer; contentType: string } | null>;
  delete(store: StoreName, keys: readonly string[]): Promise<void>;
  list(store: StoreName, prefix: string, cursor?: string): Promise<{ keys: string[]; cursor?: string }>;
}

export class StorageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageConfigError";
  }
}

type Env = Record<string, string | undefined>;

export function storeToken(store: StoreName, env: Env = process.env): string | undefined {
  const token = store === "private" ? env.BLOB_READ_WRITE_TOKEN : env.BLOB_PUBLIC_READ_WRITE_TOKEN;
  return token?.trim() || undefined;
}

/** The store id inside a Vercel Blob read-write token (vercel_blob_rw_<storeId>_<secret>). */
export function blobStoreIdFromToken(token: string | undefined): string | null {
  if (!token) return null;
  const m = /^vercel_blob_rw_([A-Za-z0-9]+)_/.exec(token.trim());
  return m ? m[1] : null;
}

// ---------------------------------------------------------------- Vercel Blob

export function vercelBlobDriver(env: Env = process.env): BlobDriver {
  const token = (store: StoreName) => {
    const t = storeToken(store, env);
    if (!t) throw new StorageConfigError(`no Blob token for the ${store} store`);
    return t;
  };
  return {
    name: "vercel-blob",
    async put(store, key, body, options) {
      const { put } = await import("@vercel/blob");
      const result = await put(key, body, {
        access: store === "public" ? "public" : "private",
        token: token(store),
        contentType: options.contentType,
        addRandomSuffix: false,
        allowOverwrite: false,
        cacheControlMaxAge: options.cacheControlMaxAge,
        abortSignal: options.signal,
      });
      return { key: result.pathname, url: store === "public" ? result.url : null };
    },
    async get(store, key) {
      const { get } = await import("@vercel/blob");
      const result = await get(key, { access: store === "public" ? "public" : "private", token: token(store) });
      if (!result || result.statusCode !== 200 || !result.stream) return null;
      const chunks: Buffer[] = [];
      for await (const chunk of result.stream as unknown as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk));
      }
      return { body: Buffer.concat(chunks), contentType: result.blob.contentType };
    },
    async delete(store, keys) {
      if (keys.length === 0) return;
      const { del } = await import("@vercel/blob");
      for (let i = 0; i < keys.length; i += 500) {
        await del(keys.slice(i, i + 500) as string[], { token: token(store) });
      }
    },
    async list(store, prefix, cursor) {
      const { list } = await import("@vercel/blob");
      const result = await list({ prefix, cursor, limit: 1000, token: token(store) });
      return { keys: result.blobs.map((b) => b.pathname), cursor: result.hasMore ? result.cursor : undefined };
    },
  };
}

// ---------------------------------------------------------------- Local disk

export const LOCAL_BLOB_ROOT = path.join(process.cwd(), ".data", "blob");

/** The dev route that serves local public blobs. */
export const LOCAL_PUBLIC_PREFIX = "/api/dev/blob/";

function localPath(root: string, store: StoreName, key: string): string {
  const base = path.resolve(root, store);
  const full = path.resolve(base, ...key.split("/"));
  if (!full.startsWith(base + path.sep)) throw new StorageConfigError("key escapes the blob root");
  return full;
}

async function walk(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (!entry.name.endsWith(".meta.json")) out.push(full);
  }
  return out;
}

export function localDriver(root: string = LOCAL_BLOB_ROOT): BlobDriver {
  return {
    name: "local",
    async put(store, key, body, options) {
      const file = localPath(root, store, key);
      try {
        await stat(file);
        throw new StorageConfigError("blob already exists");
      } catch (error) {
        if (error instanceof StorageConfigError) throw error;
      }
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body);
      await writeFile(`${file}.meta.json`, JSON.stringify({ contentType: options.contentType }), "utf8");
      return { key, url: store === "public" ? `${LOCAL_PUBLIC_PREFIX}${key}` : null };
    },
    async get(store, key) {
      const file = localPath(root, store, key);
      try {
        const [body, meta] = await Promise.all([
          readFile(file),
          readFile(`${file}.meta.json`, "utf8").catch(() => "{}"),
        ]);
        const contentType = (JSON.parse(meta) as { contentType?: string }).contentType ?? "application/octet-stream";
        return { body, contentType };
      } catch {
        return null;
      }
    },
    async delete(store, keys) {
      for (const key of keys) {
        const file = localPath(root, store, key);
        await rm(file, { force: true });
        await rm(`${file}.meta.json`, { force: true });
      }
    },
    async list(store, prefix) {
      const base = path.resolve(root, store);
      const trimmed = prefix.replace(/\/+$/, "");
      const dir = trimmed ? localPath(root, store, trimmed) : base;
      const files = await walk(dir);
      const keys = files
        .map((f) => path.relative(base, f).split(path.sep).join("/"))
        .filter((k) => k.startsWith(prefix))
        .sort();
      return { keys };
    },
  };
}

// ---------------------------------------------------------------- Selection

/** Where public blobs are served from when they live in the private store (or the database). */
export const PROXIED_PUBLIC_PREFIX = MEDIA_PREFIX;

/**
 * Public blobs (avatars, logos) kept in the PRIVATE Vercel Blob store, for a
 * deployment with only one store (BLOB_READ_WRITE_TOKEN, which is what
 * Vercel's Blob integration sets). They are served by /api/media/[...key],
 * which only ever answers for public-kind keys.
 */
export function proxiedPublicDriver(env: Env = process.env): BlobDriver {
  const inner = vercelBlobDriver(env);
  return {
    name: "vercel-blob",
    async put(_store, key, body, options) {
      const stored = await inner.put("private", key, body, options);
      return { key: stored.key, url: `${PROXIED_PUBLIC_PREFIX}${stored.key}` };
    },
    get: (_store, key) => inner.get("private", key),
    delete: (_store, keys) => inner.delete("private", keys),
    list: (_store, prefix, cursor) => inner.list("private", prefix, cursor),
  };
}

/** Public blobs go to the private store and are served through the app. */
export function publicIsProxied(env: Env = process.env): boolean {
  return !storeToken("public", env) && Boolean(storeToken("private", env));
}

/** FILE_STORAGE=database: keep every blob in Postgres, whatever else is set. */
function databaseForced(env: Env): boolean {
  return env.FILE_STORAGE?.trim().toLowerCase() === "database";
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Vercel Blob first, the database behind it. A put the store refuses goes
 * to the database instead (unless the key exists or the caller gave up);
 * a get that misses, or a store that errors, reads the database; deletes go
 * to both; lists walk the store, then the database.
 */
export function withDatabaseFallback(primary: BlobDriver, fallback: BlobDriver = databaseDriver()): BlobDriver {
  const FALLBACK_CURSOR = "db:";
  return {
    name: primary.name,
    async put(store, key, body, options) {
      try {
        return await primary.put(store, key, body, options);
      } catch (error) {
        if (options.signal?.aborted || error instanceof BlobExistsError || /already exists/i.test(message(error))) {
          throw error;
        }
        console.error(
          `[storage] ${primary.name} refused ${store} blob ${key}; keeping it in the database instead:`,
          message(error),
        );
        return fallback.put(store, key, body, options);
      }
    },
    async get(store, key) {
      let hit: Awaited<ReturnType<BlobDriver["get"]>> = null;
      try {
        hit = await primary.get(store, key);
      } catch (error) {
        console.warn(`[storage] ${primary.name} read failed for ${key}; trying the database:`, message(error));
      }
      return hit ?? fallback.get(store, key);
    },
    async delete(store, keys) {
      if (keys.length === 0) return;
      try {
        await primary.delete(store, keys);
      } catch (error) {
        console.warn(`[storage] ${primary.name} delete failed; the database copies still go:`, message(error));
      }
      await fallback.delete(store, keys);
    },
    async list(store, prefix, cursor) {
      if (cursor?.startsWith(FALLBACK_CURSOR)) {
        const page = await fallback.list(store, prefix, cursor.slice(FALLBACK_CURSOR.length) || undefined);
        return { keys: page.keys, cursor: page.cursor ? `${FALLBACK_CURSOR}${page.cursor}` : undefined };
      }
      try {
        const page = await primary.list(store, prefix, cursor);
        return { keys: page.keys, cursor: page.cursor ?? FALLBACK_CURSOR };
      } catch (error) {
        console.warn(`[storage] ${primary.name} list failed; listing the database:`, message(error));
        return { keys: [], cursor: FALLBACK_CURSOR };
      }
    },
  };
}

/** The driver for `store` in this environment. */
export function driverFor(store: StoreName, env: Env = process.env): BlobDriver {
  if (databaseForced(env)) return databaseDriver();
  if (storeToken(store, env)) return withDatabaseFallback(vercelBlobDriver(env));
  if (store === "public" && publicIsProxied(env)) return withDatabaseFallback(proxiedPublicDriver(env));
  // Vercel's filesystem is read-only: with no Blob store, the database.
  if (env.VERCEL) return databaseDriver();
  return localDriver();
}

/** Whether `store` is served from local disk here (the dev route only serves these). */
export function isLocalStore(store: StoreName, env: Env = process.env): boolean {
  return !storeToken(store, env) && !env.VERCEL && !databaseForced(env);
}
