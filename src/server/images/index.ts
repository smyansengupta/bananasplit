import { sniffMimeType } from "@/lib/finance/file-sniff";
import { deleteBlobs, listBlobs, putBlob, randomKeyId } from "@/server/storage";
import { parseStorageKey, type StorageKindName } from "@/server/storage/kinds";

/**
 * Server-side image processing for avatars and logos ('File storage and
 * images' decision). Re-encoding is the real control: it strips EXIF (GPS),
 * normalizes orientation and neutralizes crafted images.
 *
 * - Input: JPEG, PNG or WebP only, by magic bytes (never SVG, never the
 *   client's declared type). At most 40 megapixels (a pixel bomb is refused
 *   before decoding).
 * - Output: WebP variants per preset (avatar 64/128/256 square crops, logo
 *   64/256/512 fitted inside the box), no metadata.
 * - storeImage writes the variants under a random, immutable prefix in the
 *   public store and returns the JSON stored on the row
 *   ({ key, s64, s128, ... , updatedAt }); replace the row first, then
 *   delete the old variants after commit with deleteStoredImage.
 */

export const IMAGE_PRESETS = {
  avatar: { sizes: [64, 128, 256], fit: "cover" },
  logo: { sizes: [64, 256, 512], fit: "inside" },
} as const satisfies Record<string, { sizes: readonly number[]; fit: "cover" | "inside" }>;

export type ImagePreset = keyof typeof IMAGE_PRESETS;

export const MAX_INPUT_PIXELS = 40_000_000;

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

export class ImageRejectedError extends Error {
  readonly reason: "type" | "pixels" | "corrupt";
  constructor(reason: "type" | "pixels" | "corrupt", message: string) {
    super(message);
    this.name = "ImageRejectedError";
    this.reason = reason;
  }
}

/** The image type from magic bytes, or null when it is not JPEG, PNG or WebP. */
export function sniffImageType(bytes: Buffer): AllowedImageType | null {
  const type = sniffMimeType(bytes);
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(type ?? "")
    ? (type as AllowedImageType)
    : null;
}

export interface ProcessedImage {
  /** Variant name ("s64") -> WebP bytes. */
  variants: Record<string, Buffer>;
  sourceType: AllowedImageType;
  width: number;
  height: number;
}

export async function processImage(bytes: Buffer, preset: ImagePreset): Promise<ProcessedImage> {
  const sourceType = sniffImageType(bytes);
  if (!sourceType) {
    throw new ImageRejectedError("type", "Upload a JPEG, PNG or WebP image.");
  }
  const { default: sharp } = await import("sharp");
  const options = { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" as const };

  let width = 0;
  let height = 0;
  try {
    const meta = await sharp(bytes, options).metadata();
    width = meta.width ?? 0;
    height = meta.height ?? 0;
  } catch (error) {
    if (error instanceof Error && /pixel limit/i.test(error.message)) {
      throw new ImageRejectedError("pixels", "That image is too large (over 40 megapixels).");
    }
    throw new ImageRejectedError("corrupt", "That image could not be read.");
  }
  if (!width || !height) throw new ImageRejectedError("corrupt", "That image could not be read.");
  if (width * height > MAX_INPUT_PIXELS) {
    throw new ImageRejectedError("pixels", "That image is too large (over 40 megapixels).");
  }

  const { sizes, fit } = IMAGE_PRESETS[preset];
  const variants: Record<string, Buffer> = {};
  try {
    for (const size of sizes) {
      variants[`s${size}`] = await sharp(bytes, options)
        .rotate() // apply EXIF orientation, then drop it with the rest of the metadata
        .resize({
          width: size,
          height: size,
          fit,
          withoutEnlargement: fit === "inside",
        })
        .webp({ quality: 82, effort: 4 })
        .toBuffer();
    }
  } catch {
    throw new ImageRejectedError("corrupt", "That image could not be processed.");
  }
  return { variants, sourceType, width, height };
}

/** What a row stores for an uploaded image (User.avatar, Organization.logo). */
export interface StoredImage {
  /** The blob key prefix holding the variants, e.g. avatars/{userId}/{id}. */
  key: string;
  /** Variant name -> public URL. */
  [variant: `s${number}`]: string;
  updatedAt: string;
}

/** Processes `bytes` and writes the variants to the public store. Outside any transaction. */
export async function storeImage(
  kind: Extract<StorageKindName, "avatars" | "logos">,
  scopeId: string,
  preset: ImagePreset,
  bytes: Buffer,
): Promise<StoredImage> {
  const processed = await processImage(bytes, preset);
  const id = randomKeyId();
  const written: string[] = [];
  const stored: StoredImage = {
    key: `${kind}/${scopeId}/${id}`,
    updatedAt: new Date().toISOString(),
  };
  try {
    for (const [name, body] of Object.entries(processed.variants)) {
      const blob = await putBlob(kind, scopeId, [id, `${name}.webp`], body, {
        contentType: "image/webp",
        // Re-encoded by processImage, not the uploaded bytes.
        serverGenerated: true,
      });
      written.push(blob.key);
      stored[name as `s${number}`] = blob.url ?? "";
    }
  } catch (error) {
    await deleteBlobs(written).catch(() => undefined);
    throw error;
  }
  return stored;
}

/** Deletes every variant of a stored image (call after the row no longer references it). */
export async function deleteStoredImage(image: unknown): Promise<void> {
  if (!image || typeof image !== "object") return;
  const key = (image as { key?: unknown }).key;
  if (typeof key !== "string") return;
  const { kind } = parseStorageKey(`${key}/x`);
  const keys = await listBlobs(kind, `${key}/`);
  await deleteBlobs(keys);
}
