import { IntegrationProvider } from "@/generated/prisma/client";
import type { TxClient } from "@/server/db/context";

import { parseSourceConfig, sourceEndpoint, SourceConfigError } from "./connection";
import { STREAM_LABELS, STREAMS, type Stream } from "./state";

/**
 * The website sync's status for the admin panel: the integration, its
 * derived endpoint (never the password), and per stream the last sync, rows
 * written and the sanitized last error. Read as app_user in the admin's own
 * transaction: OrgIntegration and DataSourceSyncState are OWNER/ADMIN only
 * under RLS, so a member gets null.
 */

export interface SyncStreamStatus {
  stream: Stream;
  label: string;
  lastSyncedAt: Date | null;
  rowsUpserted: number;
  lastError: string | null;
  detail: string | null;
}

export interface SyncStatus {
  integrationId: string;
  status: string;
  lastError: string | null;
  endpoint: string | null;
  configError: string | null;
  hasPassword: boolean;
  streams: SyncStreamStatus[];
}

function detailOf(stream: Stream, watermark: unknown): string | null {
  const w = (watermark ?? {}) as Record<string, unknown>;
  if (stream === "checkins" && Number(w.unmapped) > 0)
    return `${w.unmapped} check-ins with an unknown source (shown as Form)`;
  if (stream === "reconcile" && typeof w.lastAt === "string")
    return `Removed ${Number(w.removed ?? 0)} rows deleted on the website`;
  if (typeof w.total === "number") return `${w.total} on the website`;
  return null;
}

export async function loadSyncStatus(
  db: TxClient,
  organizationId: string,
): Promise<SyncStatus | null> {
  const integration = await db.orgIntegration.findFirst({
    where: { organizationId, provider: IntegrationProvider.SUPABASE_SOURCE },
    select: { id: true, status: true, lastError: true, config: true, secretFingerprint: true },
  });
  if (!integration) return null;
  let endpoint: string | null = null;
  let configError: string | null = null;
  try {
    const ep = sourceEndpoint(parseSourceConfig(integration.config));
    endpoint = `${ep.user}@${ep.host}:${ep.port}/${ep.database}`;
  } catch (error) {
    configError = error instanceof SourceConfigError ? error.message : "Invalid settings.";
  }
  const states = await db.dataSourceSyncState.findMany({
    where: { organizationId, integrationId: integration.id },
    select: {
      stream: true,
      lastSyncedAt: true,
      rowsUpserted: true,
      lastError: true,
      watermark: true,
    },
  });
  const byStream = new Map(states.map((s) => [s.stream, s]));
  return {
    integrationId: integration.id,
    status: integration.status,
    lastError: integration.lastError,
    endpoint,
    configError,
    hasPassword: Boolean(integration.secretFingerprint),
    streams: STREAMS.map((stream) => {
      const s = byStream.get(stream);
      return {
        stream,
        label: STREAM_LABELS[stream],
        lastSyncedAt: s?.lastSyncedAt ?? null,
        rowsUpserted: s?.rowsUpserted ?? 0,
        lastError: s?.lastError ?? null,
        detail: s ? detailOf(stream, s.watermark) : null,
      };
    }),
  };
}
