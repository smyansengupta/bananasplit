import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/clients", () => ({ authDb: {}, serviceDb: {} }));

import {
  checkRateLimit,
  MAX_WINDOW_SECONDS,
  rateLimitBackend,
  rateLimitKey,
  retryAfterText,
} from "./rate-limit";
import { clientIpFrom } from "./request-ip";

afterEach(() => vi.restoreAllMocks());

describe("rateLimitKey", () => {
  it("hashes identifying parts so no email, IP or token is stored in clear", () => {
    const key = rateLimitKey("signin-email", "jackson@example.edu");
    expect(key).toMatch(/^signin-email:[0-9a-f]{24}$/);
    expect(key).not.toContain("jackson");
    expect(rateLimitKey("signin-email", " jackson@example.edu ")).toBe(key);
    expect(rateLimitKey("ics-feed", "AbC")).not.toBe(rateLimitKey("ics-feed", "abc"));
  });

  it("refuses odd scopes", () => {
    expect(() => rateLimitKey("Sign In", "x")).toThrow();
  });
});

describe("checkRateLimit", () => {
  it("counts through the database function on the chosen role", async () => {
    const hit = vi
      .spyOn(rateLimitBackend, "hit")
      .mockResolvedValueOnce({ allowed: true, retryAfterMs: 0 })
      .mockResolvedValueOnce({ allowed: false, retryAfterMs: 42_000 });
    await expect(checkRateLimit("k", 1, 60)).resolves.toEqual({ allowed: true });
    await expect(checkRateLimit("k", 1, 60, { via: "auth" })).resolves.toEqual({
      allowed: false,
      retryAfterMs: 42_000,
    });
    expect(hit).toHaveBeenNthCalledWith(1, "k", 1, 60, "service");
    expect(hit).toHaveBeenNthCalledWith(2, "k", 1, 60, "auth");
  });

  it("fails open (and logs) when the limiter is unavailable", async () => {
    vi.spyOn(rateLimitBackend, "hit").mockRejectedValue(new Error("connection refused"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(checkRateLimit("signin:x", 1, 60)).resolves.toEqual({ allowed: true });
    expect(log).toHaveBeenCalled();
  });

  it("validates its arguments", async () => {
    await expect(checkRateLimit("k", 0, 60)).rejects.toThrow(RangeError);
    await expect(checkRateLimit("k", 1, 0)).rejects.toThrow(RangeError);
    await expect(checkRateLimit("k", 1, MAX_WINDOW_SECONDS + 1)).rejects.toThrow(RangeError);
    await expect(checkRateLimit("x".repeat(201), 1, 60)).rejects.toThrow(RangeError);
  });

  it("words the retry time", () => {
    expect(retryAfterText({ allowed: false, retryAfterMs: 30_000 })).toBe("in a minute");
    expect(retryAfterText({ allowed: false, retryAfterMs: 10 * 60_000 })).toBe("in 10 minutes");
    expect(retryAfterText({ allowed: false, retryAfterMs: 5 * 3_600_000 })).toBe("in 5 hours");
    expect(retryAfterText({ allowed: false, retryAfterMs: 3 * 86_400_000 })).toBe("in 3 days");
  });
});

describe("clientIpFrom", () => {
  it("prefers x-real-ip and never trusts the first forwarded hop", () => {
    expect(clientIpFrom(new Headers({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" }))).toBe(
      "1.2.3.4",
    );
    expect(clientIpFrom(new Headers({ "x-forwarded-for": "6.6.6.6, 10.0.0.1" }))).toBe("10.0.0.1");
    expect(clientIpFrom(new Headers())).toBe("unknown");
  });
});
