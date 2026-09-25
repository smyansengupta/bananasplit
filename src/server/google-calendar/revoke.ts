import { IntegrationProvider, IntegrationStatus } from "@/generated/prisma/client";
import { writeOrgAuditLog } from "@/server/audit";
import { withSystemOrgTx } from "@/server/db/context";
import { PermanentJobError, type JobHandler } from "@/server/jobs/types";
import { getSecret } from "@/server/secrets";

import { GoogleApiError } from "./client";
import { mergeIntegrationConfig } from "./config";
import { clearAccessToken, revokeGrant } from "./token";

/**
 * The google-revoke job, queued by Disconnect in Settings > Integrations:
 * revokes the stored refresh token at Google (an already invalid token
 * counts as revoked) and settles the org's events, whose pending mirrors can
 * no longer run.
 *
 * - It never revokes a grant the org is using: if the integration is
 *   CONNECTED again (reconnected before the job ran), it does nothing.
 * - Google HTTP runs outside any transaction; the secret is decrypted only
 *   here, through getSecret, and never logged.
 * - Deleting the ciphertext is the Disconnect flow's job (removeSecret is
 *   OWNER-only and needs the acting user); a revoked token is useless anyway.
 * - Google-side mirrors stay where they are: the suite keeps their ids, so a
 *   later reconnect to the same calendar updates them in place.
 */
export const googleRevokeJob: JobHandler<{ integrationId: string }> = async (run) => {
  const organizationId = run.organizationId;
  if (!organizationId) throw new PermanentJobError("google-revoke is an org job");
  const { integrationId } = run.payload;

  const integration = await withSystemOrgTx(organizationId, async ({ db }) =>
    db.orgIntegration.findFirst({
      where: { id: integrationId, organizationId },
      select: { id: true, provider: true, status: true },
    }),
  );
  if (!integration || integration.provider !== IntegrationProvider.GOOGLE_CALENDAR) return;
  if (integration.status === IntegrationStatus.CONNECTED) return;

  clearAccessToken(organizationId);
  const token = await getSecret({ orgId: organizationId, integrationId, kind: "REFRESH_TOKEN" });
  if (token) {
    try {
      await revokeGrant(token, { signal: run.signal });
    } catch (error) {
      if (error instanceof GoogleApiError && !error.retryable)
        throw new PermanentJobError(error.message);
      throw error;
    }
  }

  await withSystemOrgTx(organizationId, async ({ db }) => {
    // Raw: settling the sync state is not an edit, so updatedAt stays.
    await db.$executeRaw`
      UPDATE "Event" SET "googleSyncState" = 'NOT_APPLICABLE'::"CalendarSyncState", "googleSyncError" = NULL
       WHERE "organizationId" = ${organizationId}
         AND "googleSyncState" IN ('PENDING'::"CalendarSyncState", 'FAILED'::"CalendarSyncState")`;
    await mergeIntegrationConfig(db, integrationId, { revokedAt: new Date().toISOString() });
    await writeOrgAuditLog(db, {
      organizationId,
      action: "integration.google_revoked",
      targetType: "OrgIntegration",
      targetId: integrationId,
      diff: { provider: IntegrationProvider.GOOGLE_CALENDAR, hadToken: Boolean(token) },
    });
  });
};
