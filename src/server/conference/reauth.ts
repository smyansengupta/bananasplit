import {
  type IntegrationProvider,
  IntegrationStatus,
  NotificationType,
  Role,
} from "@/generated/prisma/client";
import { writeOrgAuditLog } from "@/server/audit";
import { withSystemOrgTx } from "@/server/db/context";
import { sanitize } from "@/server/jobs/sanitize";
import { notifyUsers } from "@/server/notifications";

import { providerOf } from "./providers";
import { clearAccessToken } from "./token";

/**
 * A meeting provider refused the saved grant (docs/features/meetings.md).
 *
 * The same shape as the Google Calendar reauth path
 * (src/server/google-calendar/reauth.ts): mark the connection NEEDS_REAUTH
 * and alert owners and admins ONCE per failure streak. The alert is gated on
 * a compare-and-set of the status (CONNECTED/ERROR -> NEEDS_REAUTH), so a
 * burst of failing sync jobs sends one notification, and reconnecting starts
 * a new streak.
 *
 * Returns true when this call started the streak and sent the alert.
 */
export async function markConferenceNeedsReauth(
  organizationId: string,
  integration: IntegrationProvider,
  detail: unknown,
): Promise<boolean> {
  const def = providerOf(integration);
  const label = def?.label ?? "The meeting provider";
  clearAccessToken(organizationId, integration);

  return withSystemOrgTx(organizationId, async ({ db }) => {
    const moved = await db.orgIntegration.updateMany({
      where: {
        organizationId,
        provider: integration,
        status: { in: [IntegrationStatus.CONNECTED, IntegrationStatus.ERROR] },
      },
      data: { status: IntegrationStatus.NEEDS_REAUTH, lastError: sanitize(detail, 300) },
    });
    if (moved.count === 0) return false;

    const org = await db.organization.findUnique({
      where: { id: organizationId },
      select: { slug: true },
    });
    const managers = await db.membership.findMany({
      where: { organizationId, role: { in: [Role.OWNER, Role.ADMIN] } },
      select: { userId: true },
    });
    const row = await db.orgIntegration.findUnique({
      where: { organizationId_provider: { organizationId, provider: integration } },
      select: { id: true },
    });
    await notifyUsers(
      db,
      organizationId,
      managers.map((m) => m.userId),
      {
        type: NotificationType.INTEGRATION_ERROR,
        title: `${label} needs to be reconnected`,
        body:
          `${label} stopped accepting the connection, so new online meetings are not being created there. ` +
          "An owner or admin can reconnect it from Meetings; meetings made meanwhile get their link once it is back.",
        linkUrl: org ? `/app/${org.slug}/meetings` : null,
      },
    );
    await writeOrgAuditLog(db, {
      organizationId,
      action: "integration.needs_reauth",
      targetType: "OrgIntegration",
      targetId: row?.id ?? null,
      diff: { provider: integration },
    });
    return true;
  });
}
