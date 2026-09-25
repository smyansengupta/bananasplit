import { describe, expect, it, vi } from "vitest";

import {
  consoleScrubberEnabled,
  installConsoleScrubber,
  scrubBreadcrumb,
  scrubSentryEvent,
} from "./scrub";

describe("scrubSentryEvent", () => {
  it("drops credentials, cookies and bodies and redacts what remains", () => {
    const event = scrubSentryEvent({
      message: "sync failed for owner@club.org with Bearer abcdef123456",
      request: {
        url: "https://portal.example.org/invite/SECRET_TOKEN_123?x=1",
        headers: { Authorization: "Bearer t", Cookie: "session=1", "User-Agent": "Firefox" },
        cookies: { session: "1" },
        data: { password: "hunter2" },
        query_string: "code=abc",
      },
      user: { id: "u1", email: "owner@club.org", ip_address: "1.2.3.4" },
      extra: { apiKey: "sk-ant-api03-zzzzzzzzzzzz", note: "ok" },
    }) as unknown as {
      message: string;
      request: {
        url: string;
        headers: unknown;
        cookies?: unknown;
        data?: unknown;
        query_string?: string;
      };
      user: unknown;
      extra: unknown;
    };

    expect(event.message).toBe("sync failed for [email] with Bearer [redacted]");
    expect(event.request.url).toBe("https://portal.example.org/invite/[redacted]?[redacted]");
    expect(event.request.headers).toEqual({ "User-Agent": "Firefox" });
    expect(event.request.cookies).toBeUndefined();
    expect(event.request.data).toBeUndefined();
    expect(event.request.query_string).toBe("[redacted]");
    expect(event.user).toEqual({ id: "u1" });
    expect(event.extra).toEqual({ apiKey: "[redacted]", note: "ok" });
  });

  it("redacts breadcrumbs", () => {
    expect(scrubBreadcrumb({ message: "GET /api/calendar/feed/tok123" })).toEqual({
      message: "GET /api/calendar/feed/[redacted]",
    });
  });
});

describe("console scrubber", () => {
  it("is on in production and switchable with LOG_SCRUB", () => {
    expect(consoleScrubberEnabled({ NODE_ENV: "production" })).toBe(true);
    expect(consoleScrubberEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(consoleScrubberEnabled({ NODE_ENV: "production", LOG_SCRUB: "off" })).toBe(false);
    expect(consoleScrubberEnabled({ NODE_ENV: "test", LOG_SCRUB: "on" })).toBe(true);
  });

  it("redacts string, error and object arguments, once", () => {
    const sink = vi.fn();
    const fake = {
      error: sink,
      warn: sink,
      info: sink,
      log: sink,
      debug: sink,
    } as unknown as Console;
    installConsoleScrubber(fake);
    installConsoleScrubber(fake);
    fake.error("mail to a@b.co failed", new Error("key re_1234567890ab"), { token: "t" });
    const [text, error, obj] = sink.mock.calls[0]!;
    expect(text).toBe("mail to [email] failed");
    expect((error as Error).message).toBe("key [redacted]");
    expect(obj).toEqual({ token: "[redacted]" });
    expect(sink).toHaveBeenCalledTimes(1);
  });
});
