import {
  EventVisibility,
  IntegrationProvider,
  IntegrationStatus,
  Prisma,
} from "@/generated/prisma/client";
import type { TxClient } from "@/server/db/context";

/**
 * The org's Google Calendar connection as the sync worker reads it.
 *
 * OrgIntegration (provider GOOGLE_CALENDAR) is written by Settings >
 * Integrations (the OAuth connect flow, B1); its refresh token is an
 * OrgSecret (kind REFRESH_TOKEN) read only through getSecret. The non-secret
 * config keys this module reads:
 *
 *   publicCalendarId    where PUBLIC events are mirrored (default "primary")
 *   internalCalendarId  optional; where INTERNAL events are mirrored. Without
 *                       it INTERNAL events are never on Google at all.
 *
 * and the keys it writes (merged, never replacing the rest):
 *
 *   import              the last Google import's summary (dry run or apply)
 *   lastSyncRequestAt   the last "Sync now"
 *   revokedAt           when the grant was revoked after Disconnect
 */

export interface GoogleCalendarConfig {
  publicCalendarId: string;
  internalCalendarId: string | null;
}

export interface GoogleIntegration {
  id: string;
  status: IntegrationStatus;
  config: GoogleCalendarConfig;
  rawConfig: Record<string, unknown>;
  connectedById: string | null;
  lastError: string | null;
}

function calendarIdOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v.length > 0 && v.length <= 1024 && !/[\s/?#]/.test(v) ? v : null;
}

export function parseGoogleConfig(config: unknown): GoogleCalendarConfig {
  const c = (config && typeof config === "object" ? config : {}) as Record<string, unknown>;
  const publicCalendarId = calendarIdOrNull(c.publicCalendarId) ?? "primary";
  const internal = calendarIdOrNull(c.internalCalendarId);
  return {
    publicCalendarId,
    // Mirroring INTERNAL events into the PUBLIC calendar would publish them.
    internalCalendarId: internal && internal !== publicCalendarId ? internal : null,
  };
}

export async function loadGoogleIntegration(
  db: TxClient,
  organizationId: string,
): Promise<GoogleIntegration | null> {
  const row = await db.orgIntegration.findUnique({
    where: {
      organizationId_provider: { organizationId, provider: IntegrationProvider.GOOGLE_CALENDAR },
    },
    select: { id: true, status: true, config: true, connectedById: true, lastError: true },
  });
  if (!row) return null;
  const rawConfig = (row.config && typeof row.config === "object" ? row.config : {}) as Record<
    string,
    unknown
  >;
  return {
    id: row.id,
    status: row.status,
    config: parseGoogleConfig(rawConfig),
    rawConfig,
    connectedById: row.connectedById,
    lastError: row.lastError,
  };
}

/** Merges `patch` into the integration's config (read-modify-write in the caller's transaction). */
export async function mergeIntegrationConfig(
  db: TxClient,
  integrationId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const row = await db.orgIntegration.findUnique({
    where: { id: integrationId },
    select: { config: true },
  });
  if (!row) return;
  const current = (row.config && typeof row.config === "object" ? row.config : {}) as Record<
    string,
    unknown
  >;
  await db.orgIntegration.update({
    where: { id: integrationId },
    data: { config: { ...current, ...patch } as Prisma.InputJsonObject },
  });
}

/**
 * The calendar an event belongs on, or null when it must not be on Google:
 * PUBLIC -> the public calendar; INTERNAL -> the internal calendar if one is
 * configured, otherwise nowhere (never the public one); deleted or merged ->
 * nowhere.
 */
export function targetCalendarFor(
  event: { visibility: EventVisibility; deletedAt: Date | null; mergedIntoId: string | null },
  config: GoogleCalendarConfig,
): string | null {
  if (event.deletedAt || event.mergedIntoId) return null;
  if (event.visibility === EventVisibility.PUBLIC) return config.publicCalendarId;
  return config.internalCalendarId;
}
