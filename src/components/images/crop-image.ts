/**
 * Browser-side crop for the profile picture: draws the chosen square of the
 * image onto a 512x512 canvas and exports WebP (JPEG where the browser
 * cannot encode WebP). The server re-encodes it again with sharp, so this
 * step is only about sending a small file (typically well under 300 KB).
 */

export const CROP_OUTPUT_SIZE = 512;

/**
 * The picker's `accept`. A broad "image/*" rather than a MIME list: phones
 * hand over HEIC/HEIF photos, and Android photo and cloud pickers often give
 * files an empty or unexpected type, which a strict list (and a strict
 * `file.type` check) turned away. Whatever the browser can decode is fine:
 * only the cropped canvas output (WebP or JPEG) is uploaded.
 */
export const PICKER_ACCEPT = "image/*";

/** The original may be large (it never leaves the browser); cap it for memory. */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

export interface PixelArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("That image could not be read."));
    image.src = src;
  });
}

/**
 * Checks a picked file and opens it for the crop dialog: returns an object
 * URL the browser has actually decoded (the caller revokes it), or a message
 * to show. Decoding, not the declared type, decides: iOS Safari reads HEIC,
 * and a file with an empty type is often a perfectly good JPEG.
 */
export async function openPickedImage(file: File): Promise<{ src: string } | { error: string }> {
  if (file.type && !file.type.startsWith("image/")) {
    return { error: "Choose a photo or image file." };
  }
  if (file.size > MAX_SOURCE_BYTES) {
    return { error: "That file is too large. Choose one under 25 MB." };
  }
  const src = URL.createObjectURL(file);
  try {
    await loadImage(src);
    return { src };
  } catch {
    URL.revokeObjectURL(src);
    return { error: "That image couldn't be opened here. Try a JPEG or PNG." };
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function cropToSquare(
  src: string,
  area: PixelArea,
  size: number = CROP_OUTPUT_SIZE,
): Promise<Blob> {
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser can't crop images.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // Transparent PNGs get a white background (the variants are opaque WebP).
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, size, size);

  const webp = await canvasToBlob(canvas, "image/webp", 0.9);
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await canvasToBlob(canvas, "image/jpeg", 0.9);
  if (!jpeg) throw new Error("Your browser can't crop images.");
  return jpeg;
}
