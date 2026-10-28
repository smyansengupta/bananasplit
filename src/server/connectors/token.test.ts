// @vitest-environment node
import { OAuthError } from "@modelcontextprotocol/server";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { ConnectorsConfig } from "./config";
import {
  connectorAuthInfo,
  connectorFromAuthInfo,
  SPACE_CLAIM,
  UID_CLAIM,
  verifyConnectorToken,
} from "./token";

// The verifier fetches AuthKit's JWKS; this stands in for it with a local key.
const config: ConnectorsConfig = {
  apiKey: "sk_test_unused",
  authkitOrigin: "https://club-123.authkit.app",
  resourceUrl: "http://localhost:3000/api/mcp",
  resourceMetadataUrl: "http://localhost:3000/.well-known/oauth-protected-resource/api/mcp",
};

let privateKey: CryptoKey;
let publicJwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === `${config.authkitOrigin}/oauth2/jwks`) {
        return Response.json({ keys: [publicJwk] });
      }
      return new Response("not found", { status: 404 });
    }),
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface TokenOptions {
  claims?: Record<string, unknown>;
  issuer?: string;
  audience?: string;
  expiresIn?: string | number;
}

function token({
  claims = {},
  issuer = config.authkitOrigin,
  audience = config.resourceUrl,
  expiresIn = "5m",
}: TokenOptions = {}): Promise<string> {
  return new SignJWT({
    [UID_CLAIM]: "user_ours_1",
    client_id: "https://claude.ai/oauth/claude-code-client-metadata",
    sid: "app_consent_1",
    scope: "openid profile email offline_access",
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("user_01WORKOS")
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(privateKey);
}

describe("verifyConnectorToken", () => {
  it("accepts an AuthKit token for this MCP URL and carries our user id", async () => {
    const raw = await token({ claims: { [SPACE_CLAIM]: "all" } });
    const connector = await verifyConnectorToken(raw, config);
    expect(connector).toMatchObject({
      userId: "user_ours_1",
      clientId: "https://claude.ai/oauth/claude-code-client-metadata",
      consentId: "app_consent_1",
      workosUserId: "user_01WORKOS",
      space: "all",
      access: null,
    });
    expect(connector.expiresAt).toBeGreaterThan(Date.now() / 1000);

    // Through the SDK's AuthInfo and back, as the route and the server factory do.
    const auth = connectorAuthInfo(connector, raw, config, { grant: { id: "g1" } });
    expect(auth.resource?.href).toBe(config.resourceUrl);
    expect(auth.expiresAt).toBe(connector.expiresAt);
    expect(auth.extra?.grant).toEqual({ id: "g1" });
    expect(connectorFromAuthInfo(auth)).toBe(connector);
  });

  it("recognises only a connector this module built", async () => {
    const forged = { userId: "user_other", clientId: "x", consentId: "y", workosUserId: "z" };
    expect(
      connectorFromAuthInfo({
        token: "t",
        clientId: "x",
        scopes: [],
        extra: { connector: forged },
      }),
    ).toBeNull();
    expect(connectorFromAuthInfo(undefined)).toBeNull();
  });

  it("refuses a token from another issuer", async () => {
    await expect(
      verifyConnectorToken(await token({ issuer: "https://evil.authkit.app" }), config),
    ).rejects.toBeInstanceOf(OAuthError);
  });

  it("refuses a token whose audience is the WorkOS client id (no Resource Indicator matched)", async () => {
    await expect(
      verifyConnectorToken(await token({ audience: "client_01ENVIRONMENT" }), config),
    ).rejects.toBeInstanceOf(OAuthError);
  });

  it("refuses an expired token", async () => {
    const past = Math.floor(Date.now() / 1000) - 120;
    await expect(
      verifyConnectorToken(await token({ expiresIn: past }), config),
    ).rejects.toBeInstanceOf(OAuthError);
  });

  it("refuses a token without our user id claim (JWT template missing)", async () => {
    await expect(
      verifyConnectorToken(await token({ claims: { [UID_CLAIM]: undefined } }), config),
    ).rejects.toThrow("doesn't name a Bananasplit account");
  });

  it("refuses a token without a consent (sid) or a client, which a grant needs", async () => {
    await expect(
      verifyConnectorToken(await token({ claims: { sid: undefined } }), config),
    ).rejects.toBeInstanceOf(OAuthError);
    await expect(
      verifyConnectorToken(await token({ claims: { client_id: undefined } }), config),
    ).rejects.toBeInstanceOf(OAuthError);
  });

  it("refuses an HS256 token signed with a shared secret", async () => {
    const forged = await new SignJWT({ [UID_CLAIM]: "user_ours_1", client_id: "x" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(config.authkitOrigin)
      .setAudience(config.resourceUrl)
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode("a-shared-secret-of-thirty-two-bytes!"));
    await expect(verifyConnectorToken(forged, config)).rejects.toBeInstanceOf(OAuthError);
  });
});
