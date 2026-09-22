/**
 * Client-side preparation of a receipt before upload (0A Fix 15). Uploads
 * are capped at 4 MB (the route handler's limit, under Vercel's request body
 * limit), and phone photos are often larger. An image over the cap is
 * re-encoded as JPEG with its longest edge at most 2400px (then smaller,
 * and at lower quality, until it fits). PDFs and small files go up as-is.
 *
 * Browser-only at runtime (canvas), but the decode/encode steps are
 * injectable so the logic is unit-tested without a DOM canvas.
 */

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_EDGE_PX = 2400;

/** Scales (width, height) so the longest edge is at most `maxEdge`; never upscales. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface ImageCodec {
  decode(file: Blob): Promise<{ width: number; height: number; source: CanvasImageSource }>;
  encodeJpeg(
    image: { source: CanvasImageSource },
    size: { width: number; height: number },
    quality: number,
  ): Promise<Blob>;
}

const browserCodec: ImageCodec = {
  async decode(file) {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { width: bitmap.width, height: bitmap.height, source: bitmap };
  },
  async encodeJpeg(image, size, quality) {
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is not available.");
    context.drawImage(image.source, 0, 0, size.width, size.height);
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the image."))),
        "image/jpeg",
        quality,
      );
    });
  },
};

/** Re-encodable raster formats (GIF may be animated, so it is left alone). */
function isResizableImage(type: string): boolean {
  return type === "image/jpeg" || type === "image/png" || type === "image/webp";
}

function jpegName(name: string): string {
  const base = name.replace(/\.[^./\\]+$/, "") || "receipt";
  return `${base}.jpg`;
}

/**
 * Returns the file to upload: the original when it already fits (or cannot
 * be re-encoded), otherwise a downscaled JPEG. The caller still checks the
 * result against MAX_UPLOAD_BYTES, since a huge PDF cannot be shrunk here.
 */
export async function prepareReceiptForUpload(
  file: File,
  codec: ImageCodec = browserCodec,
): Promise<File> {
  if (file.size <= MAX_UPLOAD_BYTES || !isResizableImage(file.type)) return file;

  const image = await codec.decode(file);
  const attempts: { edge: number; quality: number }[] = [
    { edge: MAX_EDGE_PX, quality: 0.85 },
    { edge: MAX_EDGE_PX, quality: 0.7 },
    { edge: 1800, quality: 0.7 },
    { edge: 1400, quality: 0.6 },
  ];
  let blob: Blob | null = null;
  for (const attempt of attempts) {
    blob = await codec.encodeJpeg(
      image,
      fitWithin(image.width, image.height, attempt.edge),
      attempt.quality,
    );
    if (blob.size <= MAX_UPLOAD_BYTES) break;
  }
  return new File([blob!], jpegName(file.name), { type: "image/jpeg", lastModified: Date.now() });
}
