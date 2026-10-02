import { driverFor } from "@/server/storage/drivers";
import { parseStorageKey, STORAGE_KINDS, StorageKeyError } from "@/server/storage/kinds";

/**
 * /api/media/[...key]: PUBLIC-kind blobs (avatars, logos) that are not on a
 * public Vercel Blob store: kept in the private store (only
 * BLOB_READ_WRITE_TOKEN is set) or in the database (no Blob store, or the
 * store refused the upload). See src/server/storage/drivers.ts. It serves
 * nothing else: a key of any private kind (receipts, exports, Notes files,
 * org-chart sources) is a 404 whatever is stored under it.
 */
export const dynamic = "force-dynamic";

const NOT_FOUND = () =>
  new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await params;
  const key = parts.join("/");
  let kind;
  try {
    kind = parseStorageKey(key).kind;
  } catch (error) {
    if (error instanceof StorageKeyError) return NOT_FOUND();
    throw error;
  }
  if (STORAGE_KINDS[kind].store !== "public") return NOT_FOUND();

  const blob = await driverFor("public").get("public", key);
  if (!blob) return NOT_FOUND();
  return new Response(new Uint8Array(blob.body), {
    headers: {
      "Content-Type": blob.contentType,
      "Content-Length": String(blob.body.length),
      // Keys are random and never rewritten.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
