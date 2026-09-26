import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { appOrigin } from "@/lib/app-url";
import { assertNoTx } from "@/server/db/context";

/**
 * Google Calendar connect/disconnect ('Google Calendar OAuth' decision).
 *
 * One platform OAuth client (GOOGLE_CALENDAR_CLIENT_ID / _SECRET), separate
 * from the sign-in client. Each org's credential is its refresh token, an
 * OrgSecret (kind REFRESH_TOKEN) written only through src/server/secrets.
 *
 * Flow:
 *   start     ADMIN+ -> PKCE verifier + nonce in an httpOnly cookie (HMAC
 *             signed), and state = HMAC(orgId, userId, nonce, exp) with a
 *             10-minute expiry; redirect to Google's consent screen.
 *   callback  re-checks the signed state, the cookie nonce (single use), the
 *             session user and ADMIN+ in that org, then exchanges the code
 *             and lists the writable calendars (network, no transaction
 *             open), checks the granted scopes, and stores the refresh token
 *             with setSecret (one service transaction, audited).
 * Sync itself ships with the calendar builder (gcal jobs); the google-revoke
 * job revokes the token after Disconnect.
 *
 * Every HTTP call goes through `googleHttp.fetch` (a test seam), to fixed
 * Google hosts only.
 */

export const GOOGLE_CALENDAR_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events.owned",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
] as const;

/** Scopes the callback insists were granted (openid/email are informational). */
export const REQUIRED_CALENDAR_SCOPES = GOOGLE_CALENDAR_SCOPES.slice(2);

export const GOOGLE_ENDPOINTS = {
  authorize: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revoke: "https://oauth2.googleapis.com/revoke",
  calendarList: "https://www.googleapis.com/calendar/v3/users/me/calendarList",
} as const;

export const STATE_TTL_MS = 10 * 60 * 1000;
export const OAUTH_COOKIE = "gcal_oauth";

/** Test seam: every Google HTTP call. */
export const googleHttp = {
  fetch: (url: string, init: RequestInit): Promise<Response> => fetch(url, init),
};

type Env = Record<string, string | undefined>;

export class GoogleConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleConfigError";
  }
}

export function googleClient(env: Env = process.env): { clientId: string; clientSecret: string } {
  const clientId = env.GOOGLE_CALENDAR_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new GoogleConfigError(
      "Google Calendar is not configured on this platform (GOOGLE_CALENDAR_CLIENT_ID / _SECRET).",
    );
  }
  return { clientId, clientSecret };
}

export function isGoogleConfigured(env: Env = process.env): boolean {
  return Boolean(
    env.GOOGLE_CALENDAR_CLIENT_ID?.trim() && env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim(),
  );
}

export function redirectUri(env: Env = process.env): string {
  return `${appOrigin(env)}/api/integrations/google-calendar/callback`;
}

// ---------------------------------------------------------------- Signing

function signingKey(env: Env = process.env): Buffer {
  const secret = env.AUTH_SECRET;
  if (!secret) throw new GoogleConfigError("AUTH_SECRET is required to sign OAuth state");
  return createHmac("sha256", secret).update("cbc-google-calendar-oauth:v1").digest();
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
  orgId: string;
  userId: string;
  nonce: string;
  exp: number;
}

export function signState(state: OAuthState, env?: Env): string {
  const body = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${body}.${hmac(`state.${body}`, env)}`;
}

/** The verified state, or null (bad signature, malformed or expired). */
export function verifyState(
  raw: string | null | undefined,
  now = Date.now(),
  env?: Env,
): OAuthState | null {
  if (!raw || raw.length > 2000) return null;
  const [body, sig] = raw.split(".");
  if (!body || !sig || !safeEqual(sig, hmac(`state.${body}`, env))) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<OAuthState>;
    if (typeof s.orgId !== "string" || typeof s.userId !== "string" || typeof s.nonce !== "string")
      return null;
    if (typeof s.exp !== "number" || s.exp < now || s.exp > now + STATE_TTL_MS + 60_000)
      return null;
    return { orgId: s.orgId, userId: s.userId, nonce: s.nonce, exp: s.exp };
  } catch {
    return null;
  }
}

export interface OAuthCookie {
  nonce: string;
  verifier: string;
  orgId: string;
}

export function signCookie(value: OAuthCookie, env?: Env): string {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${body}.${hmac(`cookie.${body}`, env)}`;
}

export function verifyCookie(raw: string | null | undefined, env?: Env): OAuthCookie | null {
  if (!raw || raw.length > 2000) return null;
  const [body, sig] = raw.split(".");
  if (!body || !sig || !safeEqual(sig, hmac(`cookie.${body}`, env))) return null;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<OAuthCookie>;
    if (
      typeof c.nonce !== "string" ||
      typeof c.verifier !== "string" ||
      typeof c.orgId !== "string"
    )
      return null;
    return { nonce: c.nonce, verifier: c.verifier, orgId: c.orgId };
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
export function beginGoogleAuth(
  orgId: string,
  userId: string,
  now = Date.now(),
  env: Env = process.env,
): { url: string; cookie: string } {
  const { clientId } = googleClient(env);
  const { verifier, challenge } = pkcePair();
  const nonce = randomBytes(18).toString("base64url");
  const state = signState({ orgId, userId, nonce, exp: now + STATE_TTL_MS }, env);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(env),
    response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return {
    url: `${GOOGLE_ENDPOINTS.authorize}?${params}`,
    cookie: signCookie({ nonce, verifier, orgId }, env),
  };
}

// ---------------------------------------------------------------- HTTP

export class GoogleApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = "GoogleApiError";
    this.status = status;
    this.code = code;
  }
}

async function googleJson(
  url: string,
  init: RequestInit,
  what: string,
): Promise<Record<string, unknown>> {
  assertNoTx(`google ${what}`);
  const res = await googleHttp.fetch(url, { ...init, cache: "no-store" });
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  if (!res.ok) {
    const code = typeof body.error === "string" ? body.error : null;
    throw new GoogleApiError(
      res.status,
      code,
      `Google ${what} failed (${res.status}${code ? ` ${code}` : ""})`,
    );
  }
  return body;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  scopes: string[];
  /** The connected account's address, from the id_token (display only). */
  accountEmail: string | null;
}

function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: unknown;
      email_verified?: unknown;
    };
    return typeof claims.email === "string" && claims.email_verified !== false
      ? claims.email
      : null;
  } catch {
    return null;
  }
}

function tokensFrom(body: Record<string, unknown>): GoogleTokens {
  if (typeof body.access_token !== "string")
    throw new GoogleApiError(502, null, "Google returned no access token");
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
    scopes: typeof body.scope === "string" ? body.scope.split(/\s+/).filter(Boolean) : [],
    accountEmail: emailFromIdToken(body.id_token),
  };
}

export async function exchangeCode(
  code: string,
  verifier: string,
  signal?: AbortSignal,
  env: Env = process.env,
): Promise<GoogleTokens> {
  const { clientId, clientSecret } = googleClient(env);
  const body = await googleJson(
    GOOGLE_ENDPOINTS.token,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri(env),
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
      signal,
    },
    "token exchange",
  );
  return tokensFrom(body);
}

export async function refreshAccessToken(
  refreshToken: string,
  signal?: AbortSignal,
  env: Env = process.env,
): Promise<GoogleTokens> {
  const { clientId, clientSecret } = googleClient(env);
  const body = await googleJson(
    GOOGLE_ENDPOINTS.token,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
      }),
      signal,
    },
    "token refresh",
  );
  return { ...tokensFrom(body), refreshToken };
}

export interface GoogleCalendarSummary {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
}

/** Calendars the account can write to (for the picker). */
export async function listWritableCalendars(
  accessToken: string,
  signal?: AbortSignal,
): Promise<GoogleCalendarSummary[]> {
  const url = `${GOOGLE_ENDPOINTS.calendarList}?${new URLSearchParams({ minAccessRole: "writer", maxResults: "250" })}`;
  const body = await googleJson(
    url,
    { method: "GET", headers: { authorization: `Bearer ${accessToken}` }, signal },
    "calendar list",
  );
  const items = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : [];
  return items
    .filter((i) => typeof i.id === "string")
    .map((i) => ({
      id: String(i.id).slice(0, 300),
      summary: String(i.summaryOverride ?? i.summary ?? i.id).slice(0, 200),
      primary: i.primary === true,
      accessRole: String(i.accessRole ?? "writer"),
    }))
    .slice(0, 250);
}

/** Revokes a refresh (or access) token. An already-invalid token counts as revoked. */
export async function revokeGoogleToken(token: string, signal?: AbortSignal): Promise<void> {
  try {
    await googleJson(
      GOOGLE_ENDPOINTS.revoke,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
        signal,
      },
      "token revoke",
    );
  } catch (error) {
    if (error instanceof GoogleApiError && error.status === 400 && error.code === "invalid_token")
      return;
    throw error;
  }
}

export function missingScopes(granted: readonly string[]): string[] {
  return REQUIRED_CALENDAR_SCOPES.filter((s) => !granted.includes(s));
}
