import { localDriver, isLocalStore } from "@/server/storage/drivers";
import { parseStorageKey, STORAGE_KINDS, StorageKeyError } from "@/server/storage/kinds";

/**
 * Development only: serves PUBLIC-store blobs (avatars, logos) written by the
 * local filesystem driver under .data/blob/public/. It answers 404 whenever
 * the public store is Vercel Blob (a token is set) or the app runs on
 * Vercel, and it never serves the private store (receipts, exports,
 * org-chart sources), which is read only through permission-checked routes.
 */
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  if (!isLocalStore("public")) return NOT_FOUND();

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

  const blob = await localDriver().get("public", key);
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
