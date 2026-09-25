import { describe, expect, it } from "vitest";

import { describeError, redactText, redactValue } from "./redact";

describe("redactText", () => {
  it("removes email addresses", () => {
    expect(redactText("sent to jackson@example.edu ok")).toBe("sent to [email] ok");
  });

  it("removes bearer tokens and provider key shapes", () => {
    const out = redactText(
      "Authorization: Bearer abc.def-ghi_123 key sk-ant-api03-AbCdEf123456 re_123456789abc AIzaSyA1234567890abcdefghijklmn ya29.a0AfH6SMBxyz12345 ghp_abcdefghijklmnop1234",
    );
    expect(out).not.toMatch(/abc\.def-ghi_123|sk-ant|re_1234|AIzaSy|ya29\.a0|ghp_abcd/);
  });

  it("strips query strings and the app's token paths", () => {
    expect(redactText("GET https://api.example.com/x?code=secret&state=1 failed")).toBe(
      "GET https://api.example.com/x?[redacted] failed",
    );
    expect(
      redactText("/invite/AbCdEf123_token and /verify-email/zzz and /api/calendar/feed/tok"),
    ).toBe("/invite/[redacted] and /verify-email/[redacted] and /api/calendar/feed/[redacted]");
    expect(redactText("POST https://api.netlify.com/build_hooks/abc123def")).toContain(
      "build_hooks/[redacted]",
    );
  });

  it("removes credentials inside connection URLs", () => {
    expect(redactText("postgresql://app_user:hunter2@db.neon.tech/x")).toBe(
      "postgresql://[redacted]@db.neon.tech/x",
    );
  });

  it("redacts key=value pairs that name secrets", () => {
    expect(redactText("password=hunter2 apiKey: abc123 token=xyz")).toBe(
      "password=[redacted] apiKey: [redacted] token=[redacted]",
    );
  });

  it("removes long hex digests and random base64 but keeps file paths", () => {
    const hex = "a".repeat(64);
    expect(redactText(`hash ${hex}`)).toBe("hash [redacted]");
    const path = "/home/runner/work/project/node_modules/some-package/dist/index.js";
    expect(redactText(path)).toBe(path);
    expect(redactText("k=Zx9Qm2Lp8Rt4Vn6Bc1Df3Gh5Jk7Lm9Np0Qr2St4Uv6")).toContain("[redacted]");
  });
});

describe("redactValue", () => {
  it("drops sensitive keys and redacts nested strings, bounded", () => {
    const value = redactValue({
      headers: { authorization: "Bearer x", cookie: "a=b", "user-agent": "curl" },
      message: "failed for a@b.co",
      nested: [{ apiKey: "k", ok: 1 }],
    }) as Record<string, unknown>;
    expect(value).toEqual({
      headers: { authorization: "[redacted]", cookie: "[redacted]", "user-agent": "curl" },
      message: "failed for [email]",
      nested: [{ apiKey: "[redacted]", ok: 1 }],
    });
  });

  it("survives cycles", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    expect(redactValue(a)).toEqual({ name: "a", self: "[cycle]" });
  });
});

describe("describeError", () => {
  it("is one redacted line, bounded", () => {
    const error = new TypeError("fetch https://x.io/a?token=1 for u@x.io\nat line 2");
    const text = describeError(error, 60);
    expect(text).not.toContain("\n");
    expect(text).not.toContain("u@x.io");
    expect(text.length).toBeLessThanOrEqual(60);
    expect(text.startsWith("TypeError:")).toBe(true);
  });
});
