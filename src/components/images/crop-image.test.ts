// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_SOURCE_BYTES, openPickedImage, PICKER_ACCEPT } from "./crop-image";

/**
 * Picking a picture on a phone: HEIC photos and files with an empty type
 * (Android photo and cloud pickers) must reach the crop dialog when the
 * browser can decode them. Decoding is faked: jsdom loads no images.
 */

let decodes = true;
const revoke = vi.fn();

beforeEach(() => {
  decodes = true;
  revoke.mockClear();
  vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:picked", revokeObjectURL: revoke });
  vi.stubGlobal(
    "Image",
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      decoding = "";
      set src(_value: string) {
        queueMicrotask(() => (decodes ? this.onload?.() : this.onerror?.()));
      }
    },
  );
});

afterEach(() => vi.unstubAllGlobals());

function file(type: string, bytes = 10): File {
  const picked = new File([new Uint8Array(1)], "IMG_0001", { type });
  Object.defineProperty(picked, "size", { value: bytes });
  return picked;
}

describe("openPickedImage", () => {
  it("lets the phone offer every photo", () => {
    expect(PICKER_ACCEPT).toBe("image/*");
  });

  it.each(["image/jpeg", "image/heic", "image/heif", ""])(
    "opens a decodable %s file",
    async (type) => {
      expect(await openPickedImage(file(type))).toEqual({ src: "blob:picked" });
      expect(revoke).not.toHaveBeenCalled();
    },
  );

  it("explains an image this browser can't decode and frees the URL", async () => {
    decodes = false;
    const result = await openPickedImage(file("image/heic"));
    expect(result).toEqual({ error: expect.stringMatching(/couldn't be opened/) });
    expect(revoke).toHaveBeenCalledWith("blob:picked");
  });

  it("refuses something that isn't an image, and files over 25 MB", async () => {
    expect(await openPickedImage(file("application/pdf"))).toEqual({ error: expect.any(String) });
    expect(await openPickedImage(file("image/jpeg", MAX_SOURCE_BYTES + 1))).toEqual({
      error: expect.stringMatching(/25 MB/),
    });
  });
});
