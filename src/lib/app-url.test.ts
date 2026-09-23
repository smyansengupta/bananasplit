import { describe, expect, it } from "vitest";

import { absoluteAppUrl, appBaseUrl } from "./app-url";

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

  it("falls back to localhost:3000", () => {
    expect(appBaseUrl(env({}))).toBe("http://localhost:3000");
  });

  it("joins paths with exactly one slash", () => {
    const e = env({ NEXT_PUBLIC_APP_URL: "https://p.example.org/" });
    expect(absoluteAppUrl("/api/calendar/feed/", e)).toBe("https://p.example.org/api/calendar/feed/");
    expect(absoluteAppUrl("verify-email/x", e)).toBe("https://p.example.org/verify-email/x");
  });
});
