import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const LOCAL_DIR = path.join(process.cwd(), ".data", "receipts");

/**
 * Vercel Blob (private access) when a token is configured, otherwise local
 * disk. The local backend only works for a single long-lived dev server —
 * Vercel's production filesystem is ephemeral/read-only, so real deployments
 * need BLOB_READ_WRITE_TOKEN set. Mirrors how email/OAuth degrade
 * gracefully without credentials elsewhere in this app.
 *
 * Blobs are always stored `private`: Vercel never hands out a public URL for
 * them, so the only way to read one back is server-side via `get()` with
 * our own token — which only ever happens after the route handler re-checks
 * the same permission as the parent transaction.
 */
const useVercelBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

export async function putReceipt(
  key: string,
  bytes: Buffer,
  mimeType: string,
): Promise<{ blobKey: string }> {
  if (useVercelBlob) {
    const { put } = await import("@vercel/blob");
    const blob = await put(key, bytes, {
      access: "private",
      contentType: mimeType,
      addRandomSuffix: true,
    });
    return { blobKey: blob.pathname };
  }

  await mkdir(LOCAL_DIR, { recursive: true });
  const localKey = key.replace(/[/\\]/g, "_");
  await writeFile(path.join(LOCAL_DIR, localKey), bytes);
  return { blobKey: `local:${localKey}` };
}

export async function getReceiptBytes(blobKey: string): Promise<Buffer> {
  if (blobKey.startsWith("local:")) {
    const localPath = path.join(LOCAL_DIR, blobKey.slice("local:".length));
    return readFile(localPath);
  }
  const { get } = await import("@vercel/blob");
  const result = await get(blobKey, { access: "private" });
  if (!result?.stream) throw new Error("Receipt blob not found.");
  const chunks: Buffer[] = [];
  for await (const chunk of result.stream as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function deleteReceipt(blobKey: string): Promise<void> {
  if (blobKey.startsWith("local:")) {
    const localPath = path.join(LOCAL_DIR, blobKey.slice("local:".length));
    await unlink(localPath).catch(() => undefined);
    return;
  }
  const { del } = await import("@vercel/blob");
  await del(blobKey).catch(() => undefined);
}
