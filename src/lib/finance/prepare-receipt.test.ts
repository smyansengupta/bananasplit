import { describe, expect, it, vi } from "vitest";

import {
  fitWithin,
  MAX_UPLOAD_BYTES,
  prepareReceiptForUpload,
  type ImageCodec,
} from "./prepare-receipt";

function fileOfSize(bytes: number, name: string, type: string) {
  return new File([new Uint8Array(bytes)], name, { type });
}

function fakeCodec(encodedSizes: number[]): ImageCodec & { encodeJpeg: ReturnType<typeof vi.fn> } {
  const sizes = [...encodedSizes];
  return {
    decode: vi.fn(async () => ({ width: 4032, height: 3024, source: {} as CanvasImageSource })),
    encodeJpeg: vi.fn(
      async () => new Blob([new Uint8Array(sizes.shift() ?? 1000)], { type: "image/jpeg" }),
    ),
  };
}

describe("fitWithin", () => {
  it("scales the longest edge down to the limit and keeps the aspect ratio", () => {
    expect(fitWithin(4032, 3024, 2400)).toEqual({ width: 2400, height: 1800 });
    expect(fitWithin(3024, 4032, 2400)).toEqual({ width: 1800, height: 2400 });
  });

  it("never upscales", () => {
    expect(fitWithin(800, 600, 2400)).toEqual({ width: 800, height: 600 });
  });
});

describe("prepareReceiptForUpload (0A Fix 15)", () => {
  it("uploads a file under the cap untouched", async () => {
    const codec = fakeCodec([]);
    const file = fileOfSize(3.5 * 1024 * 1024, "receipt.jpg", "image/jpeg");
    expect(await prepareReceiptForUpload(file, codec)).toBe(file);
    expect(codec.decode).not.toHaveBeenCalled();
  });

  it("never re-encodes a PDF, however large", async () => {
    const codec = fakeCodec([]);
    const file = fileOfSize(6 * 1024 * 1024, "statement.pdf", "application/pdf");
    expect(await prepareReceiptForUpload(file, codec)).toBe(file);
  });

  it("re-encodes a large photo as a JPEG at most 2400px on its longest edge", async () => {
    const codec = fakeCodec([2 * 1024 * 1024]);
    const file = fileOfSize(9 * 1024 * 1024, "IMG_0042.HEIC.png", "image/png");

    const prepared = await prepareReceiptForUpload(file, codec);

    expect(prepared.type).toBe("image/jpeg");
    expect(prepared.name).toBe("IMG_0042.HEIC.jpg");
    expect(prepared.size).toBeLessThanOrEqual(MAX_UPLOAD_BYTES);
    expect(codec.encodeJpeg).toHaveBeenCalledWith(
      expect.anything(),
      { width: 2400, height: 1800 },
      0.85,
    );
  });

  it("steps quality and size down until the photo fits", async () => {
    const codec = fakeCodec([5 * 1024 * 1024, 4.5 * 1024 * 1024, 3 * 1024 * 1024]);
    const file = fileOfSize(12 * 1024 * 1024, "big.jpg", "image/jpeg");

    const prepared = await prepareReceiptForUpload(file, codec);

    expect(codec.encodeJpeg).toHaveBeenCalledTimes(3);
    expect(codec.encodeJpeg.mock.calls[2]?.[1]).toEqual({ width: 1800, height: 1350 });
    expect(prepared.size).toBe(3 * 1024 * 1024);
  });
});
