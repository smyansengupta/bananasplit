// @vitest-environment node
import { crc32 } from "node:zlib";

import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));

import { ImageRejectedError, processImage, sniffImageType } from "./index";

function pngHeaderOnly(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  // A tiny (empty) zlib stream: the file is a few bytes, the header claims 400MP.
  const idat = Buffer.from([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01]);
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

describe("image pipeline", () => {
  it("strips EXIF (including GPS) and writes WebP variants of the preset sizes", async () => {
    const withGps = await sharp({
      create: { width: 400, height: 300, channels: 3, background: "#c96442" },
    })
      .jpeg()
      .withExif({
        IFD0: { Copyright: "someone" },
        IFD3: { GPSLatitudeRef: "N", GPSLatitude: "42/1 20/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "71/1 5/1 0/1" },
      })
      .toBuffer();
    expect((await sharp(withGps).metadata()).exif).toBeDefined();

    const out = await processImage(withGps, "avatar");
    expect(Object.keys(out.variants).sort()).toEqual(["s128", "s256", "s64"]);
    for (const [name, body] of Object.entries(out.variants)) {
      const meta = await sharp(body).metadata();
      expect(meta.format).toBe("webp");
      expect(meta.exif).toBeUndefined();
      expect(meta.width).toBe(Number(name.slice(1)));
      expect(meta.height).toBe(Number(name.slice(1)));
    }
  });

  it("applies the EXIF orientation before dropping it (logos keep their aspect ratio)", async () => {
    const rotated = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#000" } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const out = await processImage(rotated, "logo");
    const meta = await sharp(out.variants.s64!).metadata();
    expect(meta.width).toBe(32);
    expect(meta.height).toBe(64);
    expect(meta.orientation).toBeUndefined();
    // Never enlarged: the 512 variant of a 200px image stays 200px tall.
    expect((await sharp(out.variants.s512!).metadata()).height).toBe(200);
  });

  it("refuses a pixel bomb before decoding it", async () => {
    const bomb = pngHeaderOnly(20_000, 20_000);
    const error = await processImage(bomb, "avatar").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImageRejectedError);
    expect((error as ImageRejectedError).reason).toBe("pixels");
  });

  it("refuses SVG, GIF and anything that is not JPEG, PNG or WebP by its bytes", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const gif = Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "binary");
    for (const bytes of [svg, gif, Buffer.from("%PDF-1.7")]) {
      const error = await processImage(bytes, "avatar").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ImageRejectedError);
      expect((error as ImageRejectedError).reason).toBe("type");
    }
    expect(sniffImageType(await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } }).png().toBuffer())).toBe(
      "image/png",
    );
  });

  it("refuses a corrupt image with a valid signature", async () => {
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
    const error = await processImage(broken, "avatar").catch((e: unknown) => e);
    expect((error as ImageRejectedError).reason).toBe("corrupt");
  });
});
