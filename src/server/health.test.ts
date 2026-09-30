// @vitest-environment node
import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/clients", () => ({ getClient: vi.fn() }));

import { runHealthChecks, type HealthProbes, type RoleProbe } from "./health";
import { kekFingerprint, loadKeyring } from "./secrets/keyring";

const ROLE_NAMES = { app: "app_user", service: "app_service", auth: "app_auth" } as const;

function probes(over: {
  role?: (role: keyof typeof ROLE_NAMES) => Partial<RoleProbe>;
  manifest?: string[];
  fixtureOnly?: string | null;
} = {}): HealthProbes {
  return {
    async role(role) {
      return {
        currentUser: ROLE_NAMES[role],
        superuser: false,
        bypassRls: false,
        ownedRelations: 0,
        timezone: "UTC",
        statementTimeout: "15s",
        idleInTransactionTimeout: "15s",
        ...(over.role?.(role) ?? {}),
      };
    },
    async manifest() {
      return over.manifest ?? [];
    },
    async fixtureOnly() {
      return over.fixtureOnly === undefined ? null : over.fixtureOnly;
    },
  };
}

const failing = (report: Awaited<ReturnType<typeof runHealthChecks>>) =>
  report.checks.filter((c) => !c.ok).map((c) => c.name);

describe("health checks", () => {
  it("passes on correctly configured roles and an empty manifest", async () => {
    const report = await runHealthChecks(probes(), {});
    expect(report.ok).toBe(true);
    expect(report.checks.map((c) => c.name)).toEqual([
      "role:app_user",
      "role:app_service",
      "role:app_auth",
      "security_manifest",
    ]);
  });

  it("fails when a role default is missing", async () => {
    const report = await runHealthChecks(
      probes({ role: (r) => (r === "auth" ? { timezone: "America/New_York", statementTimeout: "0" } : {}) }),
      {},
    );
    expect(report.ok).toBe(false);
    expect(failing(report)).toEqual(["role:app_auth"]);
    expect(report.checks.find((c) => c.name === "role:app_auth")?.detail).toMatch(/timezone.*statement_timeout/);
  });

  it("fails when a runtime URL connects as a superuser, a BYPASSRLS role, the owner or the wrong role", async () => {
    for (const bad of [
      { superuser: true },
      { bypassRls: true },
      { ownedRelations: 3 },
      { currentUser: "neondb_owner" },
    ] as Partial<RoleProbe>[]) {
      const report = await runHealthChecks(probes({ role: (r) => (r === "app" ? bad : {}) }), {});
      expect(failing(report)).toEqual(["role:app_user"]);
    }
  });

  it("fails when the security manifest reports anything", async () => {
    const report = await runHealthChecks(probes({ manifest: ["rls_disabled public.zz"] }), {});
    expect(failing(report)).toEqual(["security_manifest"]);
  });

  it("fails when a probe throws or hangs", async () => {
    const p = probes();
    p.manifest = () => Promise.reject(new Error("permission denied"));
    expect(failing(await runHealthChecks(p, {}))).toEqual(["security_manifest"]);
  });

  describe("on a preview", () => {
    const kek = randomBytes(32).toString("base64");
    const good = {
      VERCEL_ENV: "preview",
      SECRETS_KEK_V1: kek,
      SECRETS_KEK_CURRENT: "1",
      SECRETS_KEK_ENV: "preview",
      PREVIEW_KEK_FINGERPRINT: kekFingerprint(loadKeyring({ SECRETS_KEK_V1: kek, SECRETS_KEK_CURRENT: "1" })),
      BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_PrevStore1_abc",
      PREVIEW_BLOB_STORE_ID: "PrevStore1",
    };

    it("passes with the fixture marker, the mail sink and the preview stores and keyring", async () => {
      const report = await runHealthChecks(probes({ fixtureOnly: "on" }), good);
      expect(failing(report)).toEqual([]);
    });

    it("fails without the fixture-only marker", async () => {
      expect(failing(await runHealthChecks(probes({ fixtureOnly: null }), good))).toEqual(["preview:fixture_only"]);
    });

    it("fails with production's Blob store or KEK", async () => {
      const report = await runHealthChecks(probes({ fixtureOnly: "on" }), {
        ...good,
        BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_ProdStore_abc",
        SECRETS_KEK_V1: randomBytes(32).toString("base64"),
      });
      expect(failing(report)).toEqual(["preview:blob_private", "preview:kek"]);
    });
  });

  it("checks email, cron and secrets configuration in production", async () => {
    const report = await runHealthChecks(probes(), { VERCEL_ENV: "production" });
    expect(failing(report)).toEqual([
      "production:email",
      "production:cron_secret",
      "production:auth_secret",
      "production:secrets",
      "production:app_url",
    ]);
    const kek = randomBytes(32).toString("base64");
    const ok = await runHealthChecks(probes(), {
      VERCEL_ENV: "production",
      RESEND_API_KEY: "re_x",
      EMAIL_FROM: "CBC <no-reply@claudeneu.com>",
      NEXT_PUBLIC_APP_URL: "https://portal.claudeneu.com",
      CRON_SECRET: "c",
      AUTH_SECRET: "a",
      SECRETS_KEK_V1: kek,
      SECRETS_FINGERPRINT_KEY: "f",
    });
    expect(failing(ok)).toEqual([]);
  });

  describe("production:auth_secret", () => {
    const check = async (env: Record<string, string>) =>
      (await runHealthChecks(probes(), { VERCEL_ENV: "production", ...env })).checks.find(
        (c) => c.name === "production:auth_secret",
      );

    it("fails without an Auth.js secret, which is what makes every sign-in a 500", async () => {
      expect(await check({})).toEqual({
        name: "production:auth_secret",
        ok: false,
        detail: "AUTH_SECRET is not set (nor NEXTAUTH_SECRET)",
      });
      expect((await check({ AUTH_SECRET: "  " }))?.ok).toBe(false);
    });

    it("passes with AUTH_SECRET, the legacy NEXTAUTH_SECRET or a rotation slot", async () => {
      expect((await check({ AUTH_SECRET: "s" }))?.ok).toBe(true);
      expect((await check({ NEXTAUTH_SECRET: "s" }))?.ok).toBe(true);
      expect((await check({ AUTH_SECRET_1: "s" }))?.ok).toBe(true);
    });

    it("is only checked in production", async () => {
      const preview = await runHealthChecks(probes({ fixtureOnly: "on" }), {
        VERCEL_ENV: "preview",
      });
      expect(preview.checks.map((c) => c.name)).not.toContain("production:auth_secret");
    });
  });

  describe("production:app_url", () => {
    const check = async (env: Record<string, string>) =>
      (await runHealthChecks(probes(), { VERCEL_ENV: "production", ...env })).checks.find(
        (c) => c.name === "production:app_url",
      );

    it("passes on the project's production domain when NEXT_PUBLIC_APP_URL is not set", async () => {
      expect(await check({ VERCEL_PROJECT_PRODUCTION_URL: "bananasplit.smyan.dev" })).toEqual({
        name: "production:app_url",
        ok: true,
        detail:
          "NEXT_PUBLIC_APP_URL is not set; links use https://bananasplit.smyan.dev (VERCEL_PROJECT_PRODUCTION_URL)",
      });
    });

    it("fails with no app URL at all, or one on localhost or plain http", async () => {
      expect(await check({})).toMatchObject({
        ok: false,
        detail: expect.stringMatching(/^No app URL in production: set NEXT_PUBLIC_APP_URL/),
      });
      expect(await check({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" })).toMatchObject({
        ok: false,
        detail: expect.stringMatching(/points at localhost/),
      });
      expect(await check({ NEXT_PUBLIC_APP_URL: "http://portal.example.org" })).toMatchObject({
        ok: false,
        detail: "the app URL http://portal.example.org is not https",
      });
    });
  });
});
