import { describe, expect, it } from "vitest";

import { generateShareToken, hashShareToken, isShareToken } from "./share-token";

describe("report link tokens", () => {
  it("are 32 random bytes as base64url (43 characters), different every time", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateShareToken()));
    expect(tokens.size).toBe(200);
    for (const t of tokens) {
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(t, "base64url")).toHaveLength(32);
      expect(isShareToken(t)).toBe(true);
    }
  });

  it("are stored as sha256 hex, the format the database CHECK accepts", () => {
    const token = generateShareToken();
    const hash = hashShareToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashShareToken(token)).toBe(hash);
    expect(hashShareToken(generateShareToken())).not.toBe(hash);
    expect(hash).not.toContain(token);
  });

  it("refuses anything not shaped like one before it's looked up", () => {
    expect(isShareToken("")).toBe(false);
    expect(isShareToken("abc")).toBe(false);
    expect(isShareToken(`${generateShareToken()}x`)).toBe(false);
    expect(isShareToken("a".repeat(42) + "=")).toBe(false);
    expect(isShareToken("../".repeat(14) + "a")).toBe(false);
  });
});
