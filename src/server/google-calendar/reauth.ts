import {
  IntegrationProvider,
  IntegrationStatus,
  NotificationType,
  Role,
} from "@/generated/prisma/client";
import { writeOrgAuditLog } from "@/server/audit";
import { withSystemOrgTx } from "@/server/db/context";
import { sanitize } from "@/server/jobs/sanitize";
import { notifyUsers } from "@/server/notifications";

import { clearAccessToken } from "./token";

export const REAUTH_MESSAGE =
  "Google refused the saved authorization (invalid_grant). Reconnect Google Calendar in Settings > Integrations.";

/**
 * invalid_grant: marks the org's Google integration NEEDS_REAUTH and alerts
 * every OWNER and ADMIN, ONCE per failure streak. The alert is gated on a
 * compare-and-set of the status (CONNECTED/ERROR -> NEEDS_REAUTH), so a
 * burst of failing gcal jobs sends one notification; reconnecting (status
 * back to CONNECTED) starts a new streak.
 *
 * Returns true when this call started the streak (and sent the alert).
 */
export async function markNeedsReauth(organizationId: string, detail: unknown = REAUTH_MESSAGE): Promise<boolean> {
  clearAccessToken(organizationId);
  return withSystemOrgTx(organizationId, async ({ db }) => {
    const moved = await db.orgIntegration.updateMany({
      where: {
        organizationId,
        provider: IntegrationProvider.GOOGLE_CALENDAR,
        status: { in: [IntegrationStatus.CONNECTED, IntegrationStatus.ERROR] },
      },
      data: { status: IntegrationStatus.NEEDS_REAUTH, lastError: sanitize(detail, 300) },
    });
    if (moved.count === 0) return false;

    // Sequential: one connection per transaction.
    const org = await db.organization.findUnique({ where: { id: organizationId }, select: { slug: true } });
    const managers = await db.membership.findMany({
      where: { organizationId, role: { in: [Role.OWNER, Role.ADMIN] } },
      select: { userId: true },
    });
    const integration = await db.orgIntegration.findUnique({
      where: { organizationId_provider: { organizationId, provider: IntegrationProvider.GOOGLE_CALENDAR } },
      select: { id: true },
    });
    await notifyUsers(
      db,
      organizationId,
      managers.map((m) => m.userId),
      {
        type: NotificationType.INTEGRATION_ERROR,
        title: "Google Calendar needs to be reconnected",
        body:
          "Google stopped accepting the club's calendar connection, so event changes are not reaching Google Calendar. " +
          "An owner or admin can reconnect it in Settings > Integrations; changes made meanwhile sync after you press Sync now.",
        linkUrl: org ? `/app/${org.slug}/settings/integrations` : null,
      },
    );
    await writeOrgAuditLog(db, {
      organizationId,
      action: "integration.needs_reauth",
      targetType: "OrgIntegration",
      targetId: integration?.id ?? null,
      diff: { provider: IntegrationProvider.GOOGLE_CALENDAR },
    });
    return true;
  });
}
