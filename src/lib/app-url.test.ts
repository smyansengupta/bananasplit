import { describe, expect, it } from "vitest";

import { absoluteAppUrl, AppUrlConfigError, appBaseUrl, appOrigin, appUrl } from "./app-url";

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

describe("appBaseUrl — never from the Host header (0A Fix 7)", () => {
  it("uses NEXT_PUBLIC_APP_URL without a trailing slash", () => {
    expect(appBaseUrl(env({ NEXT_PUBLIC_APP_URL: "https://portal.example.org/" }))).toBe(
      "https://portal.example.org",
    );
  });

  it("uses the deployment's own host on Vercel previews", () => {
    expect(
      appBaseUrl(
        env({
          VERCEL_ENV: "preview",
          VERCEL_URL: "cbc-git-branch.vercel.app",
          NEXT_PUBLIC_APP_URL: "https://portal.example.org",
        }),
      ),
    ).toBe("https://cbc-git-branch.vercel.app");
  });

  it("keeps NEXT_PUBLIC_APP_URL in production even when VERCEL_URL is set", () => {
    expect(
      appBaseUrl(
        env({
          VERCEL_ENV: "production",
          VERCEL_URL: "cbc-abc123.vercel.app",
          NEXT_PUBLIC_APP_URL: "https://portal.example.org",
        }),
      ),
    ).toBe("https://portal.example.org");
  });

  it("falls back to localhost:3000 off Vercel", () => {
    expect(appBaseUrl(env({}))).toBe("http://localhost:3000");
    expect(appBaseUrl(env({ VERCEL_ENV: "development" }))).toBe("http://localhost:3000");
    // A local NEXT_PUBLIC_APP_URL on localhost is fine outside production.
    expect(appBaseUrl(env({ NEXT_PUBLIC_APP_URL: "http://localhost:3108" }))).toBe(
      "http://localhost:3108",
    );
  });

  it("uses the project's production domain in production without NEXT_PUBLIC_APP_URL", () => {
    // Vercel sets it without a scheme.
    expect(
      appOrigin(
        env({
          VERCEL_ENV: "production",
          VERCEL_URL: "bananasplit-abc123.vercel.app",
          VERCEL_PROJECT_PRODUCTION_URL: "bananasplit.fyi",
        }),
      ),
    ).toBe("https://bananasplit.fyi");
    expect(
      appUrl(
        "/verify-email/tok",
        env({
          VERCEL_ENV: "production",
          VERCEL_PROJECT_PRODUCTION_URL: "https://bananasplit.fyi/",
        }),
      ),
    ).toBe("https://bananasplit.fyi/verify-email/tok");
  });

  it("prefers NEXT_PUBLIC_APP_URL over the production domain", () => {
    expect(
      appOrigin(
        env({
          VERCEL_ENV: "production",
          VERCEL_PROJECT_PRODUCTION_URL: "bananasplit.vercel.app",
          NEXT_PUBLIC_APP_URL: "https://bananasplit.fyi",
        }),
      ),
    ).toBe("https://bananasplit.fyi");
  });

  it("never links a preview to production", () => {
    expect(
      appOrigin(
        env({
          VERCEL_ENV: "preview",
          VERCEL_URL: "bananasplit-git-branch.vercel.app",
          VERCEL_PROJECT_PRODUCTION_URL: "bananasplit.fyi",
        }),
      ),
    ).toBe("https://bananasplit-git-branch.vercel.app");
  });

  it("throws a configuration error in production instead of linking to localhost", () => {
    expect(() => appOrigin(env({ VERCEL_ENV: "production" }))).toThrow(AppUrlConfigError);
    expect(() => appUrl("/verify-email/tok", env({ VERCEL_ENV: "production" }))).toThrow(
      /set NEXT_PUBLIC_APP_URL.*VERCEL_PROJECT_PRODUCTION_URL/,
    );
    expect(() =>
      appOrigin(env({ VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "  " })),
    ).toThrow(AppUrlConfigError);
    for (const local of [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://app.localhost",
    ]) {
      expect(() =>
        appOrigin(
          env({
            VERCEL_ENV: "production",
            NEXT_PUBLIC_APP_URL: local,
            VERCEL_PROJECT_PRODUCTION_URL: "bananasplit.fyi",
          }),
        ),
      ).toThrow(/points at localhost in production/);
    }
  });

  it("joins paths with exactly one slash", () => {
    const e = env({ NEXT_PUBLIC_APP_URL: "https://p.example.org/" });
    expect(absoluteAppUrl("/api/calendar/feed/", e)).toBe("https://p.example.org/api/calendar/feed/");
    expect(absoluteAppUrl("verify-email/x", e)).toBe("https://p.example.org/verify-email/x");
  });
});
