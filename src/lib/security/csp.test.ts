// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  buildNonceCsp,
  buildStaticCsp,
  cspHeaderName,
  cspMode,
  generateNonce,
  isNonceRoute,
  NONCE_ROUTE_PREFIXES,
  sentryOrigin,
  STATIC_CSP_SOURCE,
  STATIC_SECURITY_HEADERS,
} from "./csp";

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

function directives(policy: string): Map<string, string> {
  return new Map(
    policy.split(";").map((d) => {
      const [name, ...values] = d.trim().split(/\s+/);
      return [name, values.join(" ")] as [string, string];
    }),
  );
}

describe("nonce policy (0A Fix 13)", () => {
  const policy = directives(buildNonceCsp("abc123==", { env: env({ NODE_ENV: "production" }) }));

  it("allows scripts only by nonce, with strict-dynamic and no unsafe-inline", () => {
    expect(policy.get("script-src")).toBe("'self' 'nonce-abc123==' 'strict-dynamic'");
  });

  it("keeps style-src 'unsafe-inline' with no style nonce and no style-src-attr", () => {
    expect(policy.get("style-src")).toBe("'self' 'unsafe-inline'");
    expect(policy.has("style-src-attr")).toBe(false);
    expect(policy.get("style-src")).not.toContain("nonce");
  });

  it("locks framing, plugins, base and form targets", () => {
    expect(policy.get("default-src")).toBe("'self'");
    expect(policy.get("frame-ancestors")).toBe("'none'");
    expect(policy.get("object-src")).toBe("'none'");
    expect(policy.get("base-uri")).toBe("'self'");
    expect(policy.get("form-action")).toBe("'self' https://accounts.google.com");
    expect(policy.get("font-src")).toBe("'self'");
    expect(policy.get("img-src")).toContain("https://*.public.blob.vercel-storage.com");
    expect(policy.has("upgrade-insecure-requests")).toBe(true);
    expect(policy.get("report-uri")).toBe("/api/csp-report");
  });

  it("adds 'unsafe-eval' in development only", () => {
    const dev = directives(buildNonceCsp("n", { env: env({ NODE_ENV: "development" }) }));
    expect(dev.get("script-src")).toContain("'unsafe-eval'");
    expect(dev.has("upgrade-insecure-requests")).toBe(false);
    expect(policy.get("script-src")).not.toContain("unsafe-eval");
  });

  it("allows the Sentry ingest host when a DSN is set", () => {
    const withSentry = env({
      NODE_ENV: "production",
      NEXT_PUBLIC_SENTRY_DSN: "https://key@o123.ingest.us.sentry.io/456",
    });
    expect(sentryOrigin(withSentry)).toBe("https://o123.ingest.us.sentry.io");
    expect(directives(buildNonceCsp("n", { env: withSentry })).get("connect-src")).toBe(
      "'self' https://o123.ingest.us.sentry.io",
    );
    expect(policy.get("connect-src")).toBe("'self'");
  });
});

describe("static policy for every other route", () => {
  it("has no nonce and allows inline scripts, per the no-nonce guide", () => {
    const policy = directives(buildStaticCsp({ env: env({ NODE_ENV: "production" }) }));
    expect(policy.get("script-src")).toBe("'self' 'unsafe-inline'");
    expect(policy.get("frame-ancestors")).toBe("'none'");
  });

  it("never applies to a nonce route, so no page carries two policies", () => {
    // next.config.ts matches with path-to-regexp; the group is a plain regex.
    const regex = new RegExp(`^${STATIC_CSP_SOURCE.replace(/^\/\(/, "/(")}$`);
    for (const path of [
      "/app",
      "/app/claude-builders-club/tasks",
      "/poll/abc",
      "/invite/tok",
      "/sign-in",
      "/sign-up",
      "/verify-email/tok",
      "/onboarding",
    ]) {
      expect(regex.test(path), path).toBe(false);
      expect(isNonceRoute(path), path).toBe(true);
    }
    for (const path of ["/", "/application", "/api/health", "/api/public/cbc/events"]) {
      expect(regex.test(path), path).toBe(true);
      expect(isNonceRoute(path), path).toBe(false);
    }
  });
});

describe("mode and headers", () => {
  it("ships report-only in production until CSP_MODE=enforce, and enforces in development", () => {
    expect(cspMode(env({ NODE_ENV: "production" }))).toBe("report-only");
    expect(cspMode(env({ NODE_ENV: "production", CSP_MODE: "enforce" }))).toBe("enforce");
    expect(cspMode(env({ NODE_ENV: "development" }))).toBe("enforce");
    expect(cspHeaderName("report-only")).toBe("Content-Security-Policy-Report-Only");
    expect(cspHeaderName("enforce")).toBe("Content-Security-Policy");
  });

  it("sets HSTS, nosniff, a referrer policy and a permissions policy everywhere", () => {
    const keys = STATIC_SECURITY_HEADERS.map((h) => h.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "Strict-Transport-Security",
        "X-Content-Type-Options",
        "Referrer-Policy",
        "Permissions-Policy",
      ]),
    );
  });

  it("generates a fresh 128-bit nonce each time", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
    expect(Buffer.from(a, "base64")).toHaveLength(16);
  });

  it("lists the nonce routes the plan names", () => {
    expect([...NONCE_ROUTE_PREFIXES]).toEqual([
      "/app",
      "/poll",
      "/invite",
      "/sign-in",
      "/sign-up",
      "/verify-email",
      "/onboarding",
    ]);
  });
});
