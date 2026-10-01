import { driverFor, publicIsProxied } from "@/server/storage/drivers";
import { parseStorageKey, STORAGE_KINDS, StorageKeyError } from "@/server/storage/kinds";

/**
 * /api/media/[...key]: PUBLIC-kind blobs (avatars, logos) on a deployment
 * that keeps them in the private Vercel Blob store because only
 * BLOB_READ_WRITE_TOKEN is set (src/server/storage/drivers.ts,
 * proxiedPublicDriver). It serves nothing else: a key of any private kind
 * (receipts, exports, org-chart sources) is a 404, and so is every key once
 * a public store is configured (those URLs point at Vercel Blob directly).
 */
export const dynamic = "force-dynamic";

const NOT_FOUND = () =>
  new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  if (!publicIsProxied()) return NOT_FOUND();

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
