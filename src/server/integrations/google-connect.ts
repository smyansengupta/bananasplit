import { IntegrationStatus, type Role } from "@/generated/prisma/client";
import { NotFoundError } from "@/lib/auth/errors";
import { can } from "@/lib/auth/permissions";
import { withOrgTx } from "@/server/db/context";
import { sanitize } from "@/server/jobs/sanitize";
import { setSecret } from "@/server/secrets";

import {
  GoogleConfigError,
  exchangeCode,
  listWritableCalendars,
  missingScopes,
  revokeGoogleToken,
  verifyCookie,
  verifyState,
} from "./google";

/**
 * The Google Calendar OAuth callback's logic, route-independent so it can
 * be tested end to end with a mocked Google (googleHttp).
 *
 * Checks, in order: the signed state (10 minutes), the single-use nonce
 * cookie from /start (same org), the session user is the one who started,
 * that user is still OWNER/ADMIN in that org, Google's own error, then the
 * code exchange with the PKCE verifier and the granted scopes. The token
 * exchange and the calendar list run with no transaction open; setSecret
 * then writes the OrgIntegration row and the refresh token in one service
 * transaction (audited, owners alerted).
 */

export type GoogleCallbackOutcome =
  { ok: true; orgSlug: string } | { ok: false; code: GoogleCallbackError; orgSlug?: string };

export type GoogleCallbackError =
  | "invalid_state"
  | "signed_out"
  | "wrong_user"
  | "forbidden"
  | "denied"
  | "scopes"
  | "no_refresh_token"
  | "not_configured"
  | "google_error";

export const GOOGLE_CALLBACK_MESSAGES: Record<GoogleCallbackError, string> = {
  invalid_state: "The Google sign-in expired or was not started here. Try Connect again.",
  signed_out: "Sign in, then try Connect again.",
  wrong_user: "The Google connection was started by a different account. Try Connect again.",
  forbidden: "Only owners and admins can connect Google Calendar.",
  denied: "Google access was not granted.",
  scopes:
    "Google did not grant calendar access. Try again and keep both calendar permissions checked.",
  no_refresh_token:
    "Google did not return offline access. Remove Clubport from your Google account's third-party access, then connect again.",
  not_configured: "Google Calendar is not configured on this platform.",
  google_error: "Google could not complete the connection. Try again.",
};

export interface GoogleCallbackInput {
  state: string | null;
  code: string | null;
  error: string | null;
  cookie: string | null;
  sessionUserId: string | null;
  signal?: AbortSignal;
}

async function orgRole(orgId: string): Promise<{ role: Role; slug: string } | null> {
  try {
    return await withOrgTx(orgId, async ({ db, role }) => {
      const org = await db.organization.findUniqueOrThrow({
        where: { id: orgId },
        select: { slug: true },
      });
      return { role, slug: org.slug };
    });
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

export async function completeGoogleConnect(
  input: GoogleCallbackInput,
): Promise<GoogleCallbackOutcome> {
  const state = verifyState(input.state);
  const cookie = verifyCookie(input.cookie);
  if (!state || !cookie || cookie.nonce !== state.nonce || cookie.orgId !== state.orgId) {
    return { ok: false, code: "invalid_state" };
  }
  if (!input.sessionUserId) return { ok: false, code: "signed_out" };
  if (input.sessionUserId !== state.userId) return { ok: false, code: "wrong_user" };

  const membership = await orgRole(state.orgId);
  if (!membership) return { ok: false, code: "forbidden" };
  const orgSlug = membership.slug;
  if (!can({ role: membership.role }, "integrations.write"))
    return { ok: false, code: "forbidden", orgSlug };
  if (input.error) return { ok: false, code: "denied", orgSlug };
  if (!input.code || input.code.length > 2000) return { ok: false, code: "invalid_state", orgSlug };

  let tokens;
  let calendars;
  try {
    tokens = await exchangeCode(input.code, cookie.verifier, input.signal);
    if (missingScopes(tokens.scopes).length > 0) {
      if (tokens.refreshToken)
        await revokeGoogleToken(tokens.refreshToken, input.signal).catch(() => undefined);
      return { ok: false, code: "scopes", orgSlug };
    }
    if (!tokens.refreshToken) return { ok: false, code: "no_refresh_token", orgSlug };
    calendars = await listWritableCalendars(tokens.accessToken, input.signal);
  } catch (error) {
    if (error instanceof GoogleConfigError) return { ok: false, code: "not_configured", orgSlug };
    console.warn(`[google-calendar] callback failed: ${sanitize(error)}`);
    return { ok: false, code: "google_error", orgSlug };
  }

  // Keep chosen calendars that still exist; otherwise the admin picks.
  const previous = await withOrgTx(state.orgId, ({ db }) =>
    db.orgIntegration.findUnique({
      where: {
        organizationId_provider: { organizationId: state.orgId, provider: "GOOGLE_CALENDAR" },
      },
      select: { config: true },
    }),
  );
  const prev =
    (previous?.config as { publicCalendarId?: string; internalCalendarId?: string } | null) ?? {};
  const ids = new Set(calendars.map((c) => c.id));
  await setSecret({
    orgId: state.orgId,
    actor: { userId: state.userId, role: membership.role },
    provider: "GOOGLE_CALENDAR",
    kind: "REFRESH_TOKEN",
    value: tokens.refreshToken,
    status: IntegrationStatus.CONNECTED,
    config: {
      accountEmail: tokens.accountEmail,
      scopes: tokens.scopes,
      calendars,
      publicCalendarId:
        prev.publicCalendarId && ids.has(prev.publicCalendarId) ? prev.publicCalendarId : null,
      internalCalendarId:
        prev.internalCalendarId && ids.has(prev.internalCalendarId)
          ? prev.internalCalendarId
          : null,
      connectedAt: new Date().toISOString(),
      disconnectedAt: null,
    },
  });
  return { ok: true, orgSlug };
}
