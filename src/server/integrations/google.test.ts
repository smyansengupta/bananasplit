// @vitest-environment node
import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/context", async () =>
  (await import("@/test/fake-context")).fakeContextModule(),
);

import {
  GOOGLE_CALENDAR_SCOPES,
  STATE_TTL_MS,
  beginGoogleAuth,
  missingScopes,
  signCookie,
  signState,
  verifyCookie,
  verifyState,
} from "./google";

const env = {
  AUTH_SECRET: "test-secret",
  GOOGLE_CALENDAR_CLIENT_ID: "client-id",
  GOOGLE_CALENDAR_CLIENT_SECRET: "client-secret",
  NEXT_PUBLIC_APP_URL: "https://portal.example.org",
};

describe("Google OAuth state", () => {
  const now = 1_700_000_000_000;
  const state = { orgId: "org_A", userId: "u1", nonce: "n1", exp: now + STATE_TTL_MS };

  it("round-trips a signed state", () => {
    expect(verifyState(signState(state, env), now, env)).toEqual(state);
  });

  it("rejects a tampered state (another org swapped in)", () => {
    const raw = signState(state, env);
    const [, sig] = raw.split(".");
    const forged = Buffer.from(JSON.stringify({ ...state, orgId: "org_B" })).toString("base64url");
    expect(verifyState(`${forged}.${sig}`, now, env)).toBeNull();
    expect(verifyState(raw.slice(0, -3) + "abc", now, env)).toBeNull();
    expect(verifyState(raw, now, { ...env, AUTH_SECRET: "other" })).toBeNull();
  });

  it("rejects an expired state and one with an implausible expiry", () => {
    expect(verifyState(signState(state, env), state.exp + 1, env)).toBeNull();
    expect(
      verifyState(signState({ ...state, exp: now + 24 * 60 * 60 * 1000 }, env), now, env),
    ).toBeNull();
  });

  it("signs the nonce cookie separately from the state", () => {
    const cookie = signCookie({ nonce: "n1", verifier: "v", orgId: "org_A" }, env);
    expect(verifyCookie(cookie, env)).toEqual({ nonce: "n1", verifier: "v", orgId: "org_A" });
    // A state is not a valid cookie and vice versa (domain-separated MACs).
    expect(verifyCookie(signState(state, env), env)).toBeNull();
    expect(verifyState(cookie, now, env)).toBeNull();
  });
});

describe("beginGoogleAuth", () => {
  it("asks for the least-privilege calendar scopes, offline access, and PKCE S256 bound to the cookie's verifier", () => {
    const { url, cookie } = beginGoogleAuth("org_A", "u1", Date.now(), env);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("scope")).toBe(GOOGLE_CALENDAR_SCOPES.join(" "));
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("redirect_uri")).toBe(
      "https://portal.example.org/api/integrations/google-calendar/callback",
    );
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    const c = verifyCookie(cookie, env)!;
    expect(u.searchParams.get("code_challenge")).toBe(
      createHash("sha256").update(c.verifier).digest("base64url"),
    );
    const s = verifyState(u.searchParams.get("state"), Date.now(), env)!;
    expect(s).toMatchObject({ orgId: "org_A", userId: "u1", nonce: c.nonce });
    // The verifier never appears in the URL.
    expect(url).not.toContain(c.verifier);
  });

  it("needs the platform client", () => {
    expect(() => beginGoogleAuth("org_A", "u1", Date.now(), { AUTH_SECRET: "x" })).toThrow(
      /not configured/,
    );
  });

  it("requires both calendar scopes", () => {
    expect(missingScopes(["openid", "email"])).toHaveLength(2);
    expect(missingScopes([...GOOGLE_CALENDAR_SCOPES])).toEqual([]);
  });
});
