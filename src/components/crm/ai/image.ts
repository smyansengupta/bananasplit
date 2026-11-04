/**
 * Pictures for the CRM's AI (a conversation screenshot, a card or badge
 * photo): shrunk in the browser to at most 1600 px on the long side before
 * upload, and sent once to the organization's model; never stored.
 */

const MAX_EDGE = 1600;
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

/** The image at most MAX_EDGE on its long side, in its own format (a GIF, or one small enough, stays as it is). */
export async function shrinkImage(file: File | Blob): Promise<Blob> {
  if (file.type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const g = canvas.getContext("2d");
    if (!g) return file;
    g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const type = file.type === "image/png" || file.type === "image/webp" ? file.type : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.88));
    return blob ?? file;
  } catch {
    return file;
  }
}

/** Sends a picture to the CRM's AI route; the JSON answer, or { error }. */
export async function sendImage(
  orgId: string,
  image: Blob,
  fields: Record<string, string>,
): Promise<Record<string, unknown> & { error?: string; code?: string }> {
  const form = new FormData();
  form.set("file", image, "image");
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  try {
    const res = await fetch(`/api/orgs/${encodeURIComponent(orgId)}/crm/ai/image`, { method: "POST", body: form });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
    return res.ok ? body : { ...body, error: body.error ?? "That didn't work. Try again." };
  } catch {
    return { error: "Couldn't reach Bananasplit. Check your connection and try again." };
  }
}
