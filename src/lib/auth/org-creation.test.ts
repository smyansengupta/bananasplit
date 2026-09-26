import { describe, expect, it } from "vitest";

import { normalizeEmail, sameEmail } from "./normalize-email";
import {
  canIssueOrgCreationCodes,
  isProductionDeployment,
  orgCreationDenial,
  orgCreationEnabled,
  orgCreationMode,
  orgCreationPolicy,
  platformAdminEmails,
} from "./org-creation";

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;
const verified = { email: "jackson@example.edu", emailVerified: new Date() };
const prod = (vars: Record<string, string> = {}) => env({ VERCEL_ENV: "production", ...vars });

describe("normalizeEmail (0A Fix 4(a))", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Alice@Example.EDU ")).toBe("alice@example.edu");
    expect(sameEmail("Alice@Example.edu", " alice@example.edu")).toBe(true);
    expect(sameEmail("alice@example.edu", "bob@example.edu")).toBe(false);
    expect(sameEmail(null, "a@b.c")).toBe(false);
  });
});

describe("org creation policy", () => {
  it("refuses an unverified account everywhere, platform admins included", () => {
    expect(orgCreationDenial({ email: "a@example.edu", emailVerified: null }, env({}))).toBe(
      "unverified",
    );
    expect(orgCreationDenial(null, env({}))).toBe("unverified");
    expect(
      orgCreationDenial(
        { email: "jackson@example.edu", emailVerified: null },
        prod({ PLATFORM_ADMIN_EMAILS: "jackson@example.edu" }),
      ),
    ).toBe("unverified");
  });

  it("allows any verified account in development and on previews (open mode, enabled)", () => {
    expect(orgCreationPolicy(verified, env({ NODE_ENV: "development" }))).toMatchObject({
      denial: null,
      mode: "open",
      requiresCode: false,
      openLimits: false,
    });
    expect(
      orgCreationDenial(verified, env({ NODE_ENV: "production", VERCEL_ENV: "preview" })),
    ).toBeNull();
  });

  it("in production, creation is disabled by default for everyone but platform admins, even for a direct action call", () => {
    expect(orgCreationEnabled(prod())).toBe(false);
    expect(
      orgCreationDenial(verified, prod({ PLATFORM_ADMIN_EMAILS: "president@example.edu" })),
    ).toBe("disabled");
    expect(
      orgCreationDenial(
        verified,
        prod({ PLATFORM_ADMIN_EMAILS: " Jackson@Example.edu , other@example.edu" }),
      ),
    ).toBeNull();
  });

  it("with creation enabled in production, the default mode is admins-only", () => {
    const e = prod({ PLATFORM_ORG_CREATION_ENABLED: "true" });
    expect(orgCreationMode(e)).toBe("admins");
    expect(orgCreationDenial(verified, e)).toBe("locked");
  });

  it("invite mode requires a code from non-admins; admins need none", () => {
    const e = prod({
      PLATFORM_ORG_CREATION_ENABLED: "true",
      ORG_CREATION_MODE: "invite",
      PLATFORM_ADMIN_EMAILS: "boss@example.edu",
    });
    expect(orgCreationPolicy(verified, e)).toMatchObject({ denial: null, requiresCode: true });
    expect(
      orgCreationPolicy({ email: "boss@example.edu", emailVerified: new Date() }, e),
    ).toMatchObject({
      denial: null,
      requiresCode: false,
      isPlatformAdmin: true,
    });
  });

  it("open mode in production applies the stricter per-user and platform limits", () => {
    const e = prod({ PLATFORM_ORG_CREATION_ENABLED: "1", ORG_CREATION_MODE: "open" });
    expect(orgCreationPolicy(verified, e)).toMatchObject({ denial: null, openLimits: true });
  });

  it("locks a self-hosted production build (no VERCEL_ENV) too", () => {
    expect(isProductionDeployment(env({ NODE_ENV: "production" }))).toBe(true);
    expect(orgCreationDenial(verified, env({ NODE_ENV: "production" }))).toBe("disabled");
  });

  it("treats an empty admin list as nobody", () => {
    expect(platformAdminEmails(env({ PLATFORM_ADMIN_EMAILS: " , " })).size).toBe(0);
  });
});

describe("org-creation codes", () => {
  const admin = { email: "boss@example.edu", emailVerified: new Date() };
  it("only platform admins, only in invite mode, only while creation is enabled", () => {
    const ok = env({ PLATFORM_ADMIN_EMAILS: "boss@example.edu", ORG_CREATION_MODE: "invite" });
    expect(canIssueOrgCreationCodes(admin, ok).allowed).toBe(true);
    expect(canIssueOrgCreationCodes(verified, ok).allowed).toBe(false);
    expect(
      canIssueOrgCreationCodes(admin, env({ PLATFORM_ADMIN_EMAILS: "boss@example.edu" })).allowed,
    ).toBe(false);
    expect(
      canIssueOrgCreationCodes(
        admin,
        prod({ PLATFORM_ADMIN_EMAILS: "boss@example.edu", ORG_CREATION_MODE: "invite" }),
      ).reason,
    ).toMatch(/switched off/);
  });
});
