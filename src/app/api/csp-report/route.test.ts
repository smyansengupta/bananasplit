// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () => ({ allowed: true }),
  rateLimitKey: (...parts: string[]) => parts.join(":"),
}));

const { POST } = await import("./route");

function report(body: unknown, type = "application/csp-report") {
  return POST(
    new Request("http://localhost:3000/api/csp-report", {
      method: "POST",
      headers: { "content-type": type, "x-forwarded-for": "198.51.100.7" },
      body: JSON.stringify(body),
    }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/csp-report", () => {
  it("logs the directive and blocked origin, never the full URL", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await report({
      "csp-report": {
        "document-uri": "https://portal.example.org/invite/SECRET_TOKEN?x=1",
        "effective-directive": "script-src-elem",
        "blocked-uri": "https://evil.example/x.js?session=abc",
      },
    });

    expect(response.status).toBe(204);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain("script-src-elem");
    expect(line).toContain("https://evil.example");
    expect(line).not.toContain("session=abc");
    expect(line).not.toContain("x=1");
  });

  it("accepts the Reporting API format", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await report(
      [{ type: "csp-violation", body: { effectiveDirective: "img-src", blockedURL: "data" } }],
      "application/reports+json",
    );
    expect(response.status).toBe(204);
    expect(String(warn.mock.calls[0]?.[0])).toContain("img-src");
  });

  it("rejects malformed bodies", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/csp-report", { method: "POST", body: "not json" }),
    );
    expect(response.status).toBe(400);
  });
});
