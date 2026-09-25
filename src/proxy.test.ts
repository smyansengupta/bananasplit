// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { config, proxy } from "./proxy";

describe("proxy — per-request nonce CSP (0A Fix 13)", () => {
  it("sets the policy on the response and hands the nonce to rendering", () => {
    const response = proxy(new NextRequest("http://localhost:3000/app/claude-builders-club"));

    // Vitest runs with NODE_ENV=test: the enforcing header.
    const policy = response.headers.get("content-security-policy");
    expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    const nonce = policy!.match(/'nonce-([^']+)'/)![1];

    // NextResponse.next({ request: { headers } }) forwards overridden
    // request headers through x-middleware-request-* headers.
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(policy);
    expect(response.headers.get("reporting-endpoints")).toContain("/api/csp-report");
  });

  it("forwards the requested path for the sign-in callbackUrl, overwriting any client value", () => {
    const request = new NextRequest("http://localhost:3000/app/cbc/tasks/t1?view=mine", {
      headers: { "x-pathname": "https://evil.example" },
    });
    const response = proxy(request);
    expect(response.headers.get("x-middleware-request-x-pathname")).toBe(
      "/app/cbc/tasks/t1?view=mine",
    );
  });

  it("uses a new nonce for every request", () => {
    const a = proxy(new NextRequest("http://localhost:3000/sign-in"));
    const b = proxy(new NextRequest("http://localhost:3000/sign-in"));
    expect(a.headers.get("content-security-policy")).not.toBe(
      b.headers.get("content-security-policy"),
    );
  });

  it("matches the authenticated and form surfaces and skips prefetches", () => {
    const sources = config.matcher.map((m) => m.source);
    expect(sources).toEqual([
      "/app",
      "/app/:path*",
      "/poll/:path*",
      "/invite/:path*",
      "/sign-in",
      "/sign-up",
      "/verify-email/:path*",
      "/onboarding",
    ]);
    for (const entry of config.matcher) {
      expect(entry.missing).toEqual([
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ]);
    }
  });
});
