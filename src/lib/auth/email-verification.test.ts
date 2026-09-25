import { afterEach, describe, expect, it, vi } from "vitest";

import { emailVerificationRequired } from "./email-verification";

/**
 * The gate is off only where the link could never arrive: a local machine
 * with no sender. Anywhere real - a deployment, or any environment with a
 * sender configured - an address must still be confirmed before it can hold
 * a Membership.
 */
const KEYS = [
  "VERCEL_ENV",
  "RESEND_API_KEY",
  "AUTH_REQUIRE_EMAIL_VERIFICATION",
  "NODE_ENV",
] as const;

/** Sets exactly these four, clearing any the case leaves out. */
function env(values: Partial<Record<(typeof KEYS)[number], string>>): void {
  for (const key of KEYS) {
    const value = values[key];
    if (value === undefined) vi.stubEnv(key, "");
    else vi.stubEnv(key, value);
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("emailVerificationRequired", () => {
  it("is off on a local machine with no sender", () => {
    env({ NODE_ENV: "development" });
    expect(emailVerificationRequired()).toBe(false);
  });

  it("is on wherever a sender exists, even locally", () => {
    env({ NODE_ENV: "development", RESEND_API_KEY: "re_live_key" });
    expect(emailVerificationRequired()).toBe(true);
  });

  it("is on for every deployment, sender or not", () => {
    for (const vercelEnv of ["production", "preview", "development"]) {
      env({ VERCEL_ENV: vercelEnv });
      expect(emailVerificationRequired()).toBe(true);
    }
    env({ NODE_ENV: "production" });
    expect(emailVerificationRequired()).toBe(true);
  });

  it("can be forced on locally", () => {
    env({ NODE_ENV: "development", AUTH_REQUIRE_EMAIL_VERIFICATION: "true" });
    expect(emailVerificationRequired()).toBe(true);
  });

  it("refuses to be switched off where it matters", () => {
    env({ VERCEL_ENV: "production", AUTH_REQUIRE_EMAIL_VERIFICATION: "false" });
    expect(emailVerificationRequired()).toBe(true);
    env({
      NODE_ENV: "development",
      RESEND_API_KEY: "re_live_key",
      AUTH_REQUIRE_EMAIL_VERIFICATION: "false",
    });
    expect(emailVerificationRequired()).toBe(true);
  });
});
