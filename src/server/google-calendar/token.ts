import { createHash } from "node:crypto";

import { IntegrationProvider } from "@/generated/prisma/client";
import { assertNoTx } from "@/server/db/context";
import { PermanentJobError } from "@/server/jobs/types";
import { getSecret } from "@/server/secrets";

import { GoogleApiError } from "./client";

/**
 * Access tokens for an org's Google Calendar connection.
 *
 * The platform OAuth client (GOOGLE_CALENDAR_CLIENT_ID / _SECRET, separate
 * from the sign-in client) is deployment config; the per-org credential is
 * the refresh token, an OrgSecret read through getSecret (decrypted outside
 * any transaction, never logged, never returned to a client). Access tokens
 * are cached in memory for their lifetime, keyed by the org and a
 * fingerprint of the refresh token, so a reconnect never reuses the old
 * grant's token.
 *
 * invalid_grant (revoked, expired in Testing mode, password change) throws
 * GoogleReauthError: the worker marks the integration NEEDS_REAUTH and
 * alerts owners and admins once.
 */

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/** The stored grant no longer works; an admin must reconnect. */
export class GoogleReauthError extends Error {
  constructor(message = "Google refused the saved authorization (invalid_grant).") {
    super(message);
    this.name = "GoogleReauthError";
  }
}

/** The deployment has no Google Calendar OAuth client configured. */
export class GoogleNotConfiguredError extends PermanentJobError {
  constructor() {
    super("Google Calendar is not configured on this deployment (GOOGLE_CALENDAR_CLIENT_ID / _SECRET).");
    this.name = "GoogleNotConfiguredError";
  }
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
  fingerprint: string;
}

const cache = new Map<string, CachedToken>();

/** Forget an org's cached access token (after a 401, a disconnect or a revoke). */
export function clearAccessToken(orgId: string): void {
  cache.delete(orgId);
}

/** For tests. */
export function clearAllAccessTokens(): void {
  cache.clear();
}

function oauthClient(env: Record<string, string | undefined> = process.env): { id: string; secret: string } {
  const id = env.GOOGLE_CALENDAR_CLIENT_ID?.trim();
  const secret = env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim();
  if (!id || !secret) throw new GoogleNotConfiguredError();
  return { id, secret };
}

/** The org's refresh token, or GoogleReauthError when none is stored. */
export async function getRefreshToken(orgId: string): Promise<string> {
  const token = await getSecret({
    orgId,
    provider: IntegrationProvider.GOOGLE_CALENDAR,
    kind: "REFRESH_TOKEN",
  });
  if (!token) throw new GoogleReauthError("No Google Calendar authorization is stored for this org.");
  return token;
}

function fingerprint(refreshToken: string): string {
  return createHash("sha256").update(refreshToken).digest("hex").slice(0, 16);
}

/** A valid access token for the org's Google Calendar connection. */
export async function getAccessToken(orgId: string, options: { signal?: AbortSignal } = {}): Promise<string> {
  assertNoTx("Google token refresh");
  const client = oauthClient();
  const refreshToken = await getRefreshToken(orgId);
  const fp = fingerprint(refreshToken);
  const hit = cache.get(orgId);
  if (hit && hit.fingerprint === fp && hit.expiresAt - 60_000 > Date.now()) return hit.accessToken;

  const timeout = AbortSignal.timeout(10_000);
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      client_id: client.id,
      client_secret: client.secret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    cache: "no-store",
    redirect: "error",
  });
  let body: { access_token?: string; expires_in?: number; error?: string; error_description?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    body = {};
  }
  if (!res.ok || !body.access_token) {
    clearAccessToken(orgId);
    if (body.error === "invalid_grant") throw new GoogleReauthError();
    if (body.error === "invalid_client" || body.error === "unauthorized_client") {
      throw new PermanentJobError(`Google rejected the OAuth client (${body.error}).`);
    }
    throw new GoogleApiError(res.status || 500, body.error ?? null, body.error_description ?? "token refresh failed");
  }
  cache.set(orgId, {
    accessToken: body.access_token,
    expiresAt: Date.now() + Math.max(60, Number(body.expires_in ?? 3600)) * 1000,
    fingerprint: fp,
  });
  return body.access_token;
}

/**
 * Revokes a grant at Google. An already invalid token counts as revoked.
 * Throws GoogleApiError (retryable) on server errors.
 */
export async function revokeGrant(token: string, options: { signal?: AbortSignal } = {}): Promise<void> {
  assertNoTx("Google revoke");
  const timeout = AbortSignal.timeout(10_000);
  const res = await fetch(GOOGLE_REVOKE_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
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
  if (res.status === 400 && (error === "invalid_token" || error === "invalid_request")) return;
  throw new GoogleApiError(res.status, error, "revoke failed");
}
