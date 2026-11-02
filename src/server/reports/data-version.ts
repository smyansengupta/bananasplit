import { invalidate } from "@/server/cache/invalidate";
import { reports as reportsTag } from "@/server/cache/tags";
import type { TxClient } from "@/server/db/context";

/**
 * Call this in the SAME transaction as any write that changes report data
 * (a sync batch, a manual check-in, a suppress, a CSV import, a merge, a
 * ballot edit): it bumps OrgSettings.reportsDataVersion, which is part of
 * every report cache key, and queues invalidate([tags.reports(orgId)]) for
 * after COMMIT (updateTag in a Server Action, revalidateTag(tag,
 * {expire: 0}) in a job). A rolled-back write changes neither.
 *
 *   await markReportsDataChanged({ db: ctx.db, organizationId: ctx.organizationId });
 *
 * The version bump needs OWNER/ADMIN (app_user) or the service path, the
 * same callers that can write report data; for anyone else the UPDATE
 * matches no row under RLS and only the invalidation happens.
 */
export async function markReportsDataChanged(ctx: {
  db: TxClient;
  organizationId: string;
}): Promise<void> {
  await ctx.db.$executeRaw`
    UPDATE public."OrgSettings"
       SET "reportsDataVersion" = "reportsDataVersion" + 1
     WHERE "organizationId" = ${ctx.organizationId}`;
  invalidate([reportsTag(ctx.organizationId)]);
}
