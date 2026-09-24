import { IntegrationProvider } from "@/generated/prisma/client";
import { withSystemOrgTx } from "@/server/db/context";
import { revokeGoogleToken } from "@/server/integrations/google";
import { PermanentJobError, type JobHandler, type JobOutcome } from "@/server/jobs/types";
import { sanitize } from "@/server/jobs/sanitize";
import { getSecret } from "@/server/secrets";
import { deleteOrgBlobs } from "@/server/storage";

/**
 * org-purge:{orgId} (heavy kind), enqueued by scheduleOrgDeletion for the
 * end of the 30-day grace period and cancelled by cancelOrgDeletion.
 *
 * Job-runner contract: the network steps run with no transaction open and
 * are idempotent, so a lost lease simply repeats them:
 *   1. re-check that the org is still soft-deleted and due (a cancel that
 *      raced the claim wins);
 *   2. revoke the Google Calendar refresh token, if any;
 *   3. delete every org-scoped blob of every org kind in the storage
 *      registry (receipts, logos, exports, org-chart), listing until empty;
 *   4. one final service transaction: app.log_org_deletion() moves the
 *      current slug into OrgSlugHistory as DELETED (reserved forever, no
 *      redirect) and writes OrgDeletionLog, then the Organization row is
 *      deleted and every org table follows by cascade.
 */
export const orgPurgeJob: JobHandler<Record<string, never>> = async (
  run,
): Promise<JobOutcome | void> => {
  const orgId = run.organizationId;
  if (!orgId) throw new PermanentJobError("org-purge without an organizationId");

  const org = await withSystemOrgTx(orgId, ({ db }) =>
    db.organization.findUnique({
      where: { id: orgId },
      select: {
        deletedAt: true,
        deleteScheduledFor: true,
        integrations: {
          where: { provider: IntegrationProvider.GOOGLE_CALENDAR },
          select: { id: true },
        },
      },
    }),
  );
  if (!org || !org.deletedAt) return; // already purged, or the deletion was cancelled
  if (org.deleteScheduledFor && org.deleteScheduledFor.getTime() > Date.now()) {
    return { status: "RETRY", error: "the grace period is not over" };
  }

  if (org.integrations.length > 0) {
    try {
      const token = await getSecret({
        orgId,
        provider: IntegrationProvider.GOOGLE_CALENDAR,
        kind: "REFRESH_TOKEN",
      });
      if (token) await revokeGoogleToken(token, run.signal);
    } catch (error) {
      // The org is going away either way; an unrevoked token is still
      // deleted with the org's secrets. Logged, never stored.
      console.warn(`[purge] ${orgId}: Google token revoke failed: ${sanitize(error)}`);
    }
  }

  const blobs = await deleteOrgBlobs(orgId);

  await withSystemOrgTx(orgId, async ({ db }) => {
    const scheduledBy = await db.orgAuditLog.findFirst({
      where: { organizationId: orgId, action: "org.deletion_scheduled" },
      orderBy: { createdAt: "desc" },
      select: { actorId: true },
    });
    await db.$queryRaw`SELECT app.log_org_deletion(${orgId}, ${scheduledBy?.actorId ?? null}) AS id`;
    await db.organization.delete({ where: { id: orgId } });
  });
  console.info(`[purge] ${orgId}: purged (blobs ${JSON.stringify(blobs)})`);
};
