import { NotificationType, Role } from "@/generated/prisma/client";
import { requirePermission } from "@/lib/auth/permissions";
import { writeOrgAuditLog } from "@/server/audit";
import { tags } from "@/server/cache/tags";
import { invalidate } from "@/server/cache/invalidate";
import { withUserTx, type OrgContext } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";
import { notifyOrgOwners } from "@/server/notifications";

/**
 * Deleting an organization (Settings > Danger zone), OWNER-only:
 *
 *   1. The OWNER types the org's slug. The org is soft-deleted at once
 *      (deletedAt) and scheduled for purge 30 days later
 *      (deleteScheduledFor), and an org-purge job is enqueued for that
 *      time, all in one transaction. app.organization_guard makes both
 *      columns OWNER-only in the database too.
 *   2. During the grace period the org is gone for everyone: every slug
 *      lookup filters on deletedAt, the public feed stops, invitations can't
 *      be accepted. Its URL shows the pending-deletion page, where an OWNER
 *      can cancel (which clears both columns and cancels the job).
 *   3. The org-purge job (src/server/settings/purge.ts) hard-deletes it.
 */

export const DELETION_GRACE_DAYS = 30;

export function deletionDate(now = new Date()): Date {
  return new Date(now.getTime() + DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000);
}

export type DeletionResult = { ok: true; scheduledFor: Date } | { ok: false; error: string };

const dateFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" });

export async function scheduleOrgDeletion(
  ctx: OrgContext,
  confirmSlug: string,
): Promise<DeletionResult> {
  requirePermission(ctx, "org.delete");
  const org = await ctx.db.organization.findUniqueOrThrow({
    where: { id: ctx.organizationId },
    select: { slug: true, name: true, deletedAt: true },
  });
  if (confirmSlug.trim() !== org.slug) {
    return { ok: false, error: `Type ${org.slug} exactly to confirm.` };
  }
  if (org.deletedAt)
    return { ok: false, error: "This organization is already scheduled for deletion." };

  const now = new Date();
  const scheduledFor = deletionDate(now);
  await ctx.db.organization.update({
    where: { id: ctx.organizationId },
    data: { deletedAt: now, deleteScheduledFor: scheduledFor },
  });
  await enqueueJob(ctx.db, {
    orgId: ctx.organizationId,
    kind: "org-purge",
    key: ctx.organizationId,
    payload: {},
    runAt: scheduledFor,
  });
  await writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action: "org.deletion_scheduled",
    targetType: "Organization",
    targetId: ctx.organizationId,
    diff: { scheduledFor: scheduledFor.toISOString() },
  });
  await notifyOrgOwners(ctx.db, ctx.organizationId, {
    type: NotificationType.SECURITY_ALERT,
    title: `${org.name} is scheduled for deletion on ${dateFmt.format(scheduledFor)}`,
    body: `${ctx.user.name ?? ctx.user.email} deleted the organization. Until then an owner can cancel from its page; after that every member, task, note, event, file and setting is removed for good.`,
    linkUrl: `/app/${org.slug}`,
    actorId: ctx.userId,
  });
  invalidate([tags.publicEvents(ctx.organizationId), tags.members(ctx.organizationId)]);
  return { ok: true, scheduledFor };
}

export async function cancelOrgDeletion(ctx: OrgContext): Promise<{ error?: string }> {
  requirePermission(ctx, "org.delete");
  const org = await ctx.db.organization.findUniqueOrThrow({
    where: { id: ctx.organizationId },
    select: { name: true, slug: true, deletedAt: true },
  });
  if (!org.deletedAt) return {};

  const cancelled = await ctx.db.$queryRaw<{ ok: boolean }[]>`
    SELECT app.cancel_job(${ctx.organizationId}, ${`org-purge:${ctx.organizationId}`}) AS ok`;
  if (cancelled[0]?.ok !== true) {
    // The purge is already running (the grace period is over), or the job is gone.
    const running = await ctx.db.job.findFirst({
      where: { organizationId: ctx.organizationId, kind: "org-purge", status: "RUNNING" },
      select: { id: true },
    });
    if (running) return { error: "The deletion is already in progress and can't be cancelled." };
  }
  await ctx.db.organization.update({
    where: { id: ctx.organizationId },
    data: { deletedAt: null, deleteScheduledFor: null },
  });
  await writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action: "org.deletion_cancelled",
    targetType: "Organization",
    targetId: ctx.organizationId,
  });
  await notifyOrgOwners(ctx.db, ctx.organizationId, {
    type: NotificationType.SECURITY_ALERT,
    title: `Deletion of ${org.name} was cancelled`,
    body: `${ctx.user.name ?? ctx.user.email} cancelled the scheduled deletion.`,
    linkUrl: `/app/${org.slug}`,
    actorId: ctx.userId,
  });
  invalidate([tags.publicEvents(ctx.organizationId), tags.members(ctx.organizationId)]);
  return {};
}

export interface PendingDeletionOrg {
  id: string;
  name: string;
  slug: string;
  deletedAt: Date;
  deleteScheduledFor: Date | null;
  role: Role;
}

/**
 * The caller's org at `slug` when it is scheduled for deletion (soft-deleted
 * orgs resolve to nothing in app.resolve_org_slug), or null. app_user sees
 * only orgs the caller belongs to.
 */
export async function findPendingDeletionOrg(
  userId: string,
  slug: string,
): Promise<PendingDeletionOrg | null> {
  return withUserTx(userId, async ({ db }) => {
    const org = await db.organization.findFirst({
      where: { slug, deletedAt: { not: null } },
      select: {
        id: true,
        name: true,
        slug: true,
        deletedAt: true,
        deleteScheduledFor: true,
        memberships: { where: { userId }, select: { role: true } },
      },
    });
    const role = org?.memberships[0]?.role;
    if (!org?.deletedAt || !role) return null;
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      deletedAt: org.deletedAt,
      deleteScheduledFor: org.deleteScheduledFor,
      role,
    };
  });
}
