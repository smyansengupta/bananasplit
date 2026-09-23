import { describe, expect, it } from "vitest";

import { normalizeEmail, sameEmail } from "./normalize-email";
import { isProductionDeployment, orgCreationDenial, platformAdminEmails } from "./org-creation";

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;
const verified = { email: "jackson@example.edu", emailVerified: new Date() };

describe("normalizeEmail (0A Fix 4(a))", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Alice@Example.EDU ")).toBe("alice@example.edu");
    expect(sameEmail("Alice@Example.edu", " alice@example.edu")).toBe(true);
    expect(sameEmail("alice@example.edu", "bob@example.edu")).toBe(false);
    expect(sameEmail(null, "a@b.c")).toBe(false);
  });
});

describe("org creation lock (0A Fix 4(c), Fix 16)", () => {
  it("refuses an unverified account everywhere", () => {
    expect(orgCreationDenial({ email: "a@example.edu", emailVerified: null }, env({}))).toBe(
      "unverified",
    );
    expect(orgCreationDenial(null, env({}))).toBe("unverified");
  });

  it("allows any verified account in development and on previews", () => {
    expect(orgCreationDenial(verified, env({ NODE_ENV: "development" }))).toBeNull();
    expect(
      orgCreationDenial(verified, env({ NODE_ENV: "production", VERCEL_ENV: "preview" })),
    ).toBeNull();
  });

  it("in production, refuses a verified user who is not a platform admin", () => {
    const production = env({
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      PLATFORM_ADMIN_EMAILS: "president@example.edu",
    });
    expect(orgCreationDenial(verified, production)).toBe("locked");
  });

  it("in production, allows a platform admin, whatever the case or spacing", () => {
    const production = env({
      VERCEL_ENV: "production",
      PLATFORM_ADMIN_EMAILS: " Jackson@Example.edu , other@example.edu",
    });
    expect(orgCreationDenial(verified, production)).toBeNull();
  });

  it("locks a self-hosted production build (no VERCEL_ENV) too", () => {
    expect(isProductionDeployment(env({ NODE_ENV: "production" }))).toBe(true);
    expect(orgCreationDenial(verified, env({ NODE_ENV: "production" }))).toBe("locked");
  });

  it("treats an empty admin list as nobody", () => {
    expect(platformAdminEmails(env({ PLATFORM_ADMIN_EMAILS: " , " })).size).toBe(0);
  });
});
