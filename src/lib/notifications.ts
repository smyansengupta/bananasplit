import type { NotificationType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { notifyUser as notify, type NotifyDb } from "@/server/notifications";

export { isEmailEnabled } from "@/lib/notification-preferences";

/**
 * In-app notification center (spec 6.1). Every notification-worthy event in
 * the app goes through here: it writes the in-app row and enqueues its
 * email copy (a notify-email job) in the same transaction as `db`. The job
 * checks the recipient's email preference, routes through the org's sender
 * (getOrgMailer) and sends at most once, after commit.
 *
 * `db` defaults to the legacy client for the not-yet-migrated modules; new
 * code passes its ctx.db (or calls src/server/notifications directly). The
 * bell's reads moved to withUserTx (src/app/app/notifications-actions.ts).
 */
export async function notifyUser(
  params: {
    organizationId: string;
    userId: string;
    type: NotificationType;
    title: string;
    body?: string;
    linkUrl?: string;
  },
  db: NotifyDb = prisma,
): Promise<void> {
  await notify(db, params.organizationId, params.userId, {
    type: params.type,
    title: params.title,
    body: params.body ?? null,
    linkUrl: params.linkUrl ?? null,
  });
}
