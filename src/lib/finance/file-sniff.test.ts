import { describe, expect, it } from "vitest";

import { sniffMimeType } from "./file-sniff";

describe("sniffMimeType — trusts magic bytes, not the filename (spec 5.5)", () => {
  it("detects a JPEG regardless of what it's named", () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(sniffMimeType(bytes)).toBe("image/jpeg");
  });

  it("detects a PNG", () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(sniffMimeType(bytes)).toBe("image/png");
  });

  it("detects a PDF", () => {
    const bytes = Buffer.from("%PDF-1.7\n...", "ascii");
    expect(sniffMimeType(bytes)).toBe("application/pdf");
  });

  it("returns null for a script masquerading as an image by extension alone", () => {
    const bytes = Buffer.from("#!/bin/sh\nrm -rf /\n", "ascii");
    expect(sniffMimeType(bytes)).toBeNull();
  });

  it("returns null for an empty or truncated file", () => {
    expect(sniffMimeType(Buffer.from([]))).toBeNull();
    expect(sniffMimeType(Buffer.from([0xff]))).toBeNull();
  });
});
