import { describe, expect, it } from "vitest";

import { orgInitials, orgLogoSource } from "./logo";

const LOGO = {
  key: "logos/org1/abc",
  s64: "/api/dev/blob/logos/org1/abc/s64.webp",
  s256: "/api/dev/blob/logos/org1/abc/s256.webp",
  s512: "/api/dev/blob/logos/org1/abc/s512.webp",
  updatedAt: "2026-09-23T00:00:00.000Z",
};

describe("orgLogoSource", () => {
  it("picks the smallest variant that covers the box, with a srcSet", () => {
    expect(orgLogoSource(LOGO, 32)).toEqual({
      src: LOGO.s64,
      srcSet: `${LOGO.s64} 2x, ${LOGO.s256} 8x, ${LOGO.s512} 16x`,
    });
    expect(orgLogoSource(LOGO, 200)?.src).toBe(LOGO.s256);
    expect(orgLogoSource(LOGO, 1000)?.src).toBe(LOGO.s512);
  });

  it("accepts https blob URLs and ignores anything that is not an image URL", () => {
    const https = { s64: "https://x.public.blob.vercel-storage.com/logos/o/a/s64.webp" };
    expect(orgLogoSource(https, 32)?.src).toBe(https.s64);
    for (const bad of [
      "javascript:alert(1)",
      "//evil.example/x.webp",
      "data:image/png;base64,AA",
      42,
    ]) {
      expect(orgLogoSource({ s64: bad }, 32)).toBeNull();
    }
    expect(orgLogoSource(null, 32)).toBeNull();
    expect(orgLogoSource("logo.webp", 32)).toBeNull();
  });
});

describe("orgInitials", () => {
  it("uses the first letters of the first two words", () => {
    expect(orgInitials("Claude Builders Club")).toBe("CB");
    expect(orgInitials("robotics")).toBe("RO");
    expect(orgInitials("  (Debate) society ")).toBe("DS");
    expect(orgInitials("")).toBe("?");
  });
});
