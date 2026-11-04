import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { IntegrationProvider } from "@/generated/prisma/enums";
import { appOrigin } from "@/lib/app-url";
import { assertNoTx } from "@/server/db/context";

import {
  type ProviderDef,
  providerClient,
  providerUrl,
} from "./providers";
import { ConferenceApiError } from "./types";

/**
 * Connecting a meeting provider (docs/features/meetings.md).
 *
 * Same shape as the Google Calendar flow in src/server/integrations/google.ts,
 * which it is deliberately modelled on, generalised over the three providers
 * so the security properties are written once:
 *
 *   start     ADMIN+ only -> a PKCE verifier and a nonce in an httpOnly,
 *             HMAC-signed cookie, and state = HMAC(provider, orgId, userId,
 *             nonce, exp) with a ten-minute life; redirect to consent.
 *   callback  re-checks the signed state, the cookie's nonce (single use),
 *             that the session user is the one who started it and is still
 *             ADMIN+ in that org, then exchanges the code and checks the
 *             granted scopes. Only then is the refresh token stored.
 *
 * The provider is part of what is signed, so a state or cookie issued for
 * Zoom cannot be replayed at the Teams callback.
 *
 * Every HTTP call goes through `conferenceHttp.fetch`, a test seam, to the
 * fixed hosts in providers.ts and nowhere else.
 */

export const STATE_TTL_MS = 10 * 60 * 1000;

/** Test seam: every provider HTTP call made while connecting. */
export const conferenceHttp = {
  fetch: (url: string, init: RequestInit): Promise<Response> => fetch(url, init),
};

type Env = Record<string, string | undefined>;

/** The cookie a provider's connect flow sets, e.g. "conf_oauth_zoom". */
export function oauthCookieName(def: ProviderDef): string {
  return `conf_oauth_${def.integration.toLowerCase()}`;
}

export function redirectUri(def: ProviderDef, env: Env = process.env): string {
  return `${appOrigin(env)}/api/integrations/conference/${slugOf(def.integration)}/callback`;
}

/** The URL slug for a provider: google-meet, zoom, microsoft-teams. */
export function slugOf(integration: IntegrationProvider): string {
  return integration.toLowerCase().replace(/_/g, "-");
}

export function integrationFromSlug(slug: string): IntegrationProvider | null {
  const want = slug.toUpperCase().replace(/-/g, "_");
  return want === IntegrationProvider.GOOGLE_MEET ||
    want === IntegrationProvider.ZOOM ||
    want === IntegrationProvider.MICROSOFT_TEAMS
    ? (want as IntegrationProvider)
    : null;
}

// ---------------------------------------------------------------- Signing

class OAuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthConfigError";
  }
}

function signingKey(env: Env = process.env): Buffer {
  const secret = env.AUTH_SECRET;
  if (!secret) throw new OAuthConfigError("AUTH_SECRET is required to sign OAuth state");
  return createHmac("sha256", secret).update("bananasplit-conference-oauth:v1").digest();
}

function hmac(data: string, env?: Env): string {
  return createHmac("sha256", signingKey(env)).update(data).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface OAuthState {
  provider: IntegrationProvider;
  orgId: string;
  userId: string;
  nonce: string;
  exp: number;
}

export function signState(state: OAuthState, env?: Env): string {
  const body = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${body}.${hmac(`state.${body}`, env)}`;
}

/** The verified state, or null (bad signature, malformed, expired, or for another provider). */
export function verifyState(
  raw: string | null | undefined,
  provider: IntegrationProvider,
  now = Date.now(),
  env?: Env,
): OAuthState | null {
  if (!raw || raw.length > 2000) return null;
  const [body, sig] = raw.split(".");
  if (!body || !sig || !safeEqual(sig, hmac(`state.${body}`, env))) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<OAuthState>;
    if (s.provider !== provider) return null;
    if (typeof s.orgId !== "string" || typeof s.userId !== "string" || typeof s.nonce !== "string")
      return null;
    if (typeof s.exp !== "number" || s.exp < now || s.exp > now + STATE_TTL_MS + 60_000)
      return null;
    return { provider, orgId: s.orgId, userId: s.userId, nonce: s.nonce, exp: s.exp };
  } catch {
    return null;
  }
}

export interface OAuthCookie {
  provider: IntegrationProvider;
  nonce: string;
  verifier: string;
  orgId: string;
}

export function signCookie(value: OAuthCookie, env?: Env): string {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${body}.${hmac(`cookie.${body}`, env)}`;
}

export function verifyCookie(
  raw: string | null | undefined,
  provider: IntegrationProvider,
  env?: Env,
): OAuthCookie | null {
  if (!raw || raw.length > 2000) return null;
  const [body, sig] = raw.split(".");
  if (!body || !sig || !safeEqual(sig, hmac(`cookie.${body}`, env))) return null;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<OAuthCookie>;
    if (c.provider !== provider) return null;
    if (
      typeof c.nonce !== "string" ||
      typeof c.verifier !== "string" ||
      typeof c.orgId !== "string"
    )
      return null;
    return { provider, nonce: c.nonce, verifier: c.verifier, orgId: c.orgId };
  } catch {
    return null;
  }
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** Everything the start route needs: the consent URL and the cookie to set. */
export function beginAuth(
  def: ProviderDef,
  orgId: string,
  userId: string,
  now = Date.now(),
  env: Env = process.env,
): { url: string; cookie: string; cookieName: string } {
  const client = providerClient(def, env);
  const { verifier, challenge } = pkcePair();
  const nonce = randomBytes(18).toString("base64url");
  const state = signState(
    { provider: def.integration, orgId, userId, nonce, exp: now + STATE_TTL_MS },
    env,
  );
  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri(def, env),
    response_type: "code",
    scope: def.scopes.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...(def.authorizeParams ?? {}),
  });
  return {
    url: `${providerUrl(def.authorize, client)}?${params}`,
    cookie: signCookie({ provider: def.integration, nonce, verifier, orgId }, env),
    cookieName: oauthCookieName(def),
  };
}

// ---------------------------------------------------------------- Tokens

export interface ProviderTokens {
  accessToken: string;
  refreshToken: string | null;
  scopes: string[];
  /** The connected account, for display only. */
  accountEmail: string | null;
  expiresInSeconds: number;
}

function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: unknown;
      preferred_username?: unknown;
      email_verified?: unknown;
    };
    if (typeof claims.email === "string" && claims.email_verified !== false) return claims.email;
    return typeof claims.preferred_username === "string" ? claims.preferred_username : null;
  } catch {
    return null;
  }
}

function tokensFrom(body: Record<string, unknown>, asked: readonly string[]): ProviderTokens {
  if (typeof body.access_token !== "string")
    throw new ConferenceApiError(502, null, "the provider returned no access token");
  // Zoom does not echo a scope string on every grant; fall back to what was
  // asked for rather than reporting none granted.
  const scopes =
    typeof body.scope === "string" && body.scope.trim().length > 0
      ? body.scope.split(/[\s,]+/).filter(Boolean)
      : [...asked];
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
    scopes,
    accountEmail: emailFromIdToken(body.id_token),
    expiresInSeconds: Math.max(60, Number(body.expires_in ?? 3600)),
  };
}

async function tokenPost(
  def: ProviderDef,
  body: URLSearchParams,
  what: string,
  signal?: AbortSignal,
  env: Env = process.env,
): Promise<Record<string, unknown>> {
  assertNoTx(`${def.integration} ${what}`);
  const client = providerClient(def, env);
  const timeout = AbortSignal.timeout(10_000);
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
  // Each provider the way it documents itself, rather than every method at
  // once: Zoom authenticates the client in the header (client_secret_basic),
  // Google and Microsoft in the body (client_secret_post). Sending both is
  // not an error anywhere, but it does put the secret in two places.
  if (def.integration === IntegrationProvider.ZOOM) {
    headers.authorization = `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString("base64")}`;
    body.set("client_id", client.clientId);
  } else {
    body.set("client_id", client.clientId);
    body.set("client_secret", client.clientSecret);
  }

  const res = await conferenceHttp.fetch(providerUrl(def.token, client), {
    method: "POST",
    headers,
    body: body.toString(),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    cache: "no-store",
    redirect: "error",
  });
  let parsed: Record<string, unknown> = {};
  try {
    parsed = (await res.json()) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  if (!res.ok) {
    const code = typeof parsed.error === "string" ? parsed.error : null;
    const detail =
      typeof parsed.error_description === "string" ? `: ${parsed.error_description}` : "";
    throw new ConferenceApiError(
      res.status,
      code,
      `${def.label} ${what} failed (${res.status}${code ? ` ${code}` : ""})${detail}`,
    );
  }
  return parsed;
}

export async function exchangeCode(
  def: ProviderDef,
  code: string,
  verifier: string,
  signal?: AbortSignal,
  env: Env = process.env,
): Promise<ProviderTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(def, env),
    code_verifier: verifier,
  });
  return tokensFrom(await tokenPost(def, body, "code exchange", signal, env), def.scopes);
}

export async function refreshTokens(
  def: ProviderDef,
  refreshToken: string,
  signal?: AbortSignal,
  env: Env = process.env,
): Promise<ProviderTokens> {
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken });
  // Microsoft wants the scopes repeated on a refresh; the others ignore it.
  if (def.integration === IntegrationProvider.MICROSOFT_TEAMS)
    body.set("scope", def.scopes.join(" "));
  return tokensFrom(await tokenPost(def, body, "token refresh", signal, env), def.scopes);
}

/** Scopes the provider did not grant, of the ones we insist on. */
export function missingScopes(def: ProviderDef, granted: readonly string[]): string[] {
  const have = new Set(granted);
  return def.required.filter((s) => !have.has(s));
}

/** Revokes a grant where the provider offers it. Already-invalid counts as done. */
export async function revokeToken(
  def: ProviderDef,
  token: string,
  signal?: AbortSignal,
  env: Env = process.env,
): Promise<void> {
  if (!def.revoke) return;
  assertNoTx(`${def.integration} revoke`);
  const client = providerClient(def, env);
  const timeout = AbortSignal.timeout(10_000);
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  if (def.integration === IntegrationProvider.ZOOM) {
    headers.authorization = `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString("base64")}`;
  }
  const res = await conferenceHttp.fetch(providerUrl(def.revoke, client), {
    method: "POST",
    headers,
    body: new URLSearchParams({ token }).toString(),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    cache: "no-store",
    redirect: "error",
  });
  if (res.ok) return;
  let error: string | null = null;
  try {
    error = ((await res.json()) as { error?: string }).error ?? null;
  } catch {
    error = null;
  }
  // A token the provider has already forgotten is the state we wanted.
  if (res.status === 400 && (error === "invalid_token" || error === "invalid_request")) return;
  throw new ConferenceApiError(res.status, error, `${def.label} revoke failed`);
}
