// @vitest-environment node
import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/context", async () =>
  (await import("@/test/fake-context")).fakeContextModule(),
);

import { IntegrationProvider } from "@/generated/prisma/enums";

import {
  STATE_TTL_MS,
  beginAuth,
  conferenceHttp,
  exchangeCode,
  integrationFromSlug,
  missingScopes,
  oauthCookieName,
  refreshTokens,
  signCookie,
  signState,
  slugOf,
  verifyCookie,
  verifyState,
} from "./oauth";
import { PROVIDERS, isAllowedJoinUrl, isConfigured, providerOf, providerUrl } from "./providers";

const env = {
  AUTH_SECRET: "test-secret",
  NEXT_PUBLIC_APP_URL: "https://portal.example.org",
  GOOGLE_MEET_CLIENT_ID: "meet-id",
  GOOGLE_MEET_CLIENT_SECRET: "meet-secret",
  ZOOM_CLIENT_ID: "zoom-id",
  ZOOM_CLIENT_SECRET: "zoom-secret",
  MICROSOFT_TEAMS_CLIENT_ID: "teams-id",
  MICROSOFT_TEAMS_CLIENT_SECRET: "teams-secret",
};

const meet = providerOf(IntegrationProvider.GOOGLE_MEET)!;
const zoom = providerOf(IntegrationProvider.ZOOM)!;
const teams = providerOf(IntegrationProvider.MICROSOFT_TEAMS)!;

function jsonOnce(body: unknown, status = 200) {
  return vi
    .spyOn(conferenceHttp, "fetch")
    .mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
}

describe("provider table", () => {
  it("covers the three providers, each with its own integration row and slug", () => {
    expect(PROVIDERS.map((p) => p.integration)).toEqual([
      IntegrationProvider.GOOGLE_MEET,
      IntegrationProvider.ZOOM,
      IntegrationProvider.MICROSOFT_TEAMS,
    ]);
    expect(PROVIDERS.map((p) => slugOf(p.integration))).toEqual([
      "google-meet",
      "zoom",
      "microsoft-teams",
    ]);
    for (const p of PROVIDERS) {
      expect(integrationFromSlug(slugOf(p.integration))).toBe(p.integration);
    }
    expect(integrationFromSlug("google-calendar")).toBeNull();
    expect(integrationFromSlug("../../etc")).toBeNull();
  });

  it("reports a provider with no credentials as unconfigured, without throwing", () => {
    expect(isConfigured(zoom, env)).toBe(true);
    expect(isConfigured(zoom, { ...env, ZOOM_CLIENT_SECRET: "" })).toBe(false);
    expect(isConfigured(zoom, {})).toBe(false);
  });

  it("fills Microsoft's tenant into its endpoints, defaulting to common", () => {
    expect(providerUrl(teams.authorize, { clientId: "", clientSecret: "", tenant: "common" })).toContain(
      "/common/oauth2",
    );
    expect(
      providerUrl(teams.token, { clientId: "", clientSecret: "", tenant: "contoso.onmicrosoft.com" }),
    ).toContain("/contoso.onmicrosoft.com/oauth2");
  });
});

describe("join URL allowlist", () => {
  it("accepts only https links on the provider's own hosts", () => {
    expect(isAllowedJoinUrl("https://meet.google.com/abc-defg-hij", meet.joinHosts)).toBe(true);
    expect(isAllowedJoinUrl("https://us02web.zoom.us/j/123", zoom.joinHosts)).toBe(true);
    expect(isAllowedJoinUrl("https://teams.microsoft.com/l/meetup-join/x", teams.joinHosts)).toBe(
      true,
    );
  });

  it("rejects http, another host, and a host that merely ends in the name", () => {
    expect(isAllowedJoinUrl("http://meet.google.com/x", meet.joinHosts)).toBe(false);
    expect(isAllowedJoinUrl("https://evil.example/x", meet.joinHosts)).toBe(false);
    // The classic near-miss: a host that contains the real one as a suffix of
    // its own label rather than as a parent domain.
    expect(isAllowedJoinUrl("https://notzoom.us/j/1", zoom.joinHosts)).toBe(false);
    expect(isAllowedJoinUrl("https://meet.google.com.evil.test/x", meet.joinHosts)).toBe(false);
    expect(isAllowedJoinUrl("javascript:alert(1)", meet.joinHosts)).toBe(false);
    expect(isAllowedJoinUrl("not a url", meet.joinHosts)).toBe(false);
  });
});

describe("OAuth state and cookie", () => {
  const now = 1_700_000_000_000;
  const state = {
    provider: IntegrationProvider.ZOOM,
    orgId: "org_A",
    userId: "u1",
    nonce: "n1",
    exp: now + STATE_TTL_MS,
  };

  it("round-trips a signed state", () => {
    expect(verifyState(signState(state, env), IntegrationProvider.ZOOM, now, env)).toEqual(state);
  });

  it("will not let a state issued for one provider be used at another", () => {
    const raw = signState(state, env);
    expect(verifyState(raw, IntegrationProvider.MICROSOFT_TEAMS, now, env)).toBeNull();
    expect(verifyState(raw, IntegrationProvider.GOOGLE_MEET, now, env)).toBeNull();
  });

  it("rejects a tampered state, a foreign signing key and an expired one", () => {
    const raw = signState(state, env);
    const [, sig] = raw.split(".");
    const forged = Buffer.from(JSON.stringify({ ...state, orgId: "org_B" })).toString("base64url");
    expect(verifyState(`${forged}.${sig}`, IntegrationProvider.ZOOM, now, env)).toBeNull();
    expect(verifyState(raw, IntegrationProvider.ZOOM, now, { ...env, AUTH_SECRET: "other" })).toBeNull();
    expect(verifyState(raw, IntegrationProvider.ZOOM, now + STATE_TTL_MS + 1, env)).toBeNull();
    expect(verifyState(null, IntegrationProvider.ZOOM, now, env)).toBeNull();
  });

  it("round-trips the nonce cookie, and binds it to its provider", () => {
    const cookie = { provider: IntegrationProvider.ZOOM, nonce: "n1", verifier: "v1", orgId: "org_A" };
    expect(verifyCookie(signCookie(cookie, env), IntegrationProvider.ZOOM, env)).toEqual(cookie);
    expect(verifyCookie(signCookie(cookie, env), IntegrationProvider.GOOGLE_MEET, env)).toBeNull();
    expect(oauthCookieName(zoom)).toBe("conf_oauth_zoom");
  });
});

describe("beginAuth", () => {
  it("sends PKCE, the provider's scopes and a state matching the cookie", () => {
    const { url, cookie, cookieName } = beginAuth(zoom, "org_A", "u1", 1_700_000_000_000, env);
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://zoom.us/oauth/authorize");
    expect(parsed.searchParams.get("client_id")).toBe("zoom-id");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "https://portal.example.org/api/integrations/conference/zoom/callback",
    );
    expect(parsed.searchParams.get("scope")).toBe(zoom.scopes.join(" "));
    expect(cookieName).toBe("conf_oauth_zoom");

    const verified = verifyCookie(cookie, IntegrationProvider.ZOOM, env)!;
    const challenge = createHash("sha256").update(verified.verifier).digest("base64url");
    expect(parsed.searchParams.get("code_challenge")).toBe(challenge);
    expect(
      verifyState(parsed.searchParams.get("state"), IntegrationProvider.ZOOM, 1_700_000_000_000, env),
    ).toMatchObject({ orgId: "org_A", userId: "u1", nonce: verified.nonce });
  });

  it("asks Google for offline access, or there would be no refresh token", () => {
    const { url } = beginAuth(meet, "org_A", "u1", 1_700_000_000_000, env);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("access_type")).toBe("offline");
    expect(parsed.searchParams.get("prompt")).toBe("consent");
    expect(parsed.searchParams.get("scope")).toContain("meetings.space.created");
  });

  it("refuses to start when the deployment has no client for that provider", () => {
    expect(() => beginAuth(zoom, "org_A", "u1", Date.now(), { AUTH_SECRET: "s" })).toThrow(
      /ZOOM_CLIENT_ID/,
    );
  });
});

describe("token exchange", () => {
  it("exchanges a code with the PKCE verifier and reads the account back", async () => {
    const idToken = `x.${Buffer.from(
      JSON.stringify({ email: "club@example.org", email_verified: true }),
    ).toString("base64url")}.y`;
    const spy = jsonOnce({
      access_token: "at",
      refresh_token: "rt",
      scope: "meeting:write:meeting user:read:user",
      expires_in: 3599,
      id_token: idToken,
    });
    const tokens = await exchangeCode(zoom, "the-code", "the-verifier", undefined, env);
    expect(tokens).toMatchObject({
      accessToken: "at",
      refreshToken: "rt",
      accountEmail: "club@example.org",
      expiresInSeconds: 3599,
    });
    expect(tokens.scopes).toContain("meeting:write:meeting");

    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe("https://zoom.us/oauth/token");
    const sent = new URLSearchParams(String(init.body));
    expect(sent.get("grant_type")).toBe("authorization_code");
    expect(sent.get("code")).toBe("the-code");
    expect(sent.get("code_verifier")).toBe("the-verifier");
    // Zoom authenticates the client in the header, never in the body.
    expect(sent.get("client_secret")).toBeNull();
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from("zoom-id:zoom-secret").toString("base64")}`,
    );
  });

  it("falls back to the scopes asked for when the provider echoes none", async () => {
    jsonOnce({ access_token: "at", refresh_token: "rt", expires_in: 3600 });
    const tokens = await exchangeCode(zoom, "c", "v", undefined, env);
    expect(tokens.scopes).toEqual([...zoom.scopes]);
  });

  it("repeats the scopes on a Microsoft refresh, which needs them", async () => {
    const spy = jsonOnce({ access_token: "at", expires_in: 3600 });
    await refreshTokens(teams, "rt", undefined, env);
    const sent = new URLSearchParams(String(spy.mock.calls[0]![1].body));
    expect(sent.get("grant_type")).toBe("refresh_token");
    expect(sent.get("scope")).toBe(teams.scopes.join(" "));
  });

  it("turns a provider error into a message that names the reason", async () => {
    jsonOnce({ error: "invalid_grant", error_description: "token expired" }, 400);
    await expect(refreshTokens(zoom, "rt", undefined, env)).rejects.toMatchObject({
      status: 400,
      code: "invalid_grant",
    });
  });

  it("fails loudly rather than silently when no access token comes back", async () => {
    jsonOnce({ token_type: "bearer" });
    await expect(exchangeCode(zoom, "c", "v", undefined, env)).rejects.toThrow(/no access token/);
  });
});

describe("granted scopes", () => {
  it("reports the required scopes a provider withheld", () => {
    expect(missingScopes(zoom, ["meeting:write:meeting", "user:read:user"])).toEqual([]);
    expect(missingScopes(zoom, ["user:read:user"])).toEqual(["meeting:write:meeting"]);
    expect(missingScopes(meet, [])).toEqual([
      "https://www.googleapis.com/auth/meetings.space.created",
    ]);
  });
});
