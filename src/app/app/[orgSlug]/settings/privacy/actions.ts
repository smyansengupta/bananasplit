"use server";

import { z } from "zod";

import { BallotVisibility, MemberVisibility } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/auth/permissions";
import { writeOrgAuditLog } from "@/server/audit";
import { tags } from "@/server/cache/tags";
import { invalidate } from "@/server/cache/invalidate";
import { withOrgAction, type OrgContext } from "@/server/db/context";

/**
 * Settings > Privacy, on app_user through withOrgAction. OWNER/ADMIN edit
 * everything except who may see individual ballots, which is OWNER-only
 * (an ADMIN could otherwise grant ADMINs the votes); app.org_settings_guard
 * enforces that in the database too. The values are enforced by RLS
 * (app.can_view_rows, app.can_view_ballot_rows, app.ballot_tally) and by the
 * public events feed.
 */

export interface PrivacyResult {
  error?: string;
}

const privacySchema = z.object({
  ballotResultsVisibleToMembers: z.boolean(),
  ballotMinCellSize: z.number().int().min(1, "At least 1").max(50, "At most 50"),
  showMemberEmailsToMembers: z.boolean(),
  publicEventsEnabled: z.boolean(),
  contactEmailVisibility: z.enum(MemberVisibility),
});

export type PrivacyInput = z.infer<typeof privacySchema>;

function refresh(ctx: OrgContext) {
  invalidate([
    tags.reports(ctx.organizationId),
    tags.databases(ctx.organizationId),
    tags.publicEvents(ctx.organizationId),
    tags.members(ctx.organizationId),
  ]);
}

export const updatePrivacy = withOrgAction(
  async (ctx, input: PrivacyInput): Promise<PrivacyResult> => {
    requirePermission(ctx, "privacy.write");
    const parsed = privacySchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid settings" };
    const before = await ctx.db.orgSettings.findUniqueOrThrow({
      where: { organizationId: ctx.organizationId },
      select: {
        ballotResultsVisibleToMembers: true,
        ballotMinCellSize: true,
        showMemberEmailsToMembers: true,
        publicEventsEnabled: true,
        contactEmailVisibility: true,
      },
    });
    const changed = Object.fromEntries(
      Object.entries(parsed.data).filter(([k, v]) => before[k as keyof typeof before] !== v),
    );
    if (Object.keys(changed).length === 0) return {};
    await ctx.db.orgSettings.update({
      where: { organizationId: ctx.organizationId },
      data: { ...changed, updatedById: ctx.userId },
    });
    await writeOrgAuditLog(ctx.db, {
      organizationId: ctx.organizationId,
      action: "privacy.updated",
      targetType: "OrgSettings",
      targetId: ctx.organizationId,
      diff: {
        from: Object.fromEntries(
          Object.keys(changed).map((k) => [k, before[k as keyof typeof before]]),
        ),
        to: changed,
      },
    });
    refresh(ctx);
    return {};
  },
);

export const updateBallotVisibility = withOrgAction(
  async (ctx, value: string): Promise<PrivacyResult> => {
    requirePermission(ctx, "privacy.ballots");
    const parsed = z.enum(BallotVisibility).safeParse(value);
    if (!parsed.success) return { error: "Choose a valid option." };
    const before = await ctx.db.orgSettings.findUniqueOrThrow({
      where: { organizationId: ctx.organizationId },
      select: { ballotIndividualVisibility: true },
    });
    if (before.ballotIndividualVisibility === parsed.data) return {};
    await ctx.db.orgSettings.update({
      where: { organizationId: ctx.organizationId },
      data: { ballotIndividualVisibility: parsed.data, updatedById: ctx.userId },
    });
    await writeOrgAuditLog(ctx.db, {
      organizationId: ctx.organizationId,
      action: "privacy.ballot_visibility_changed",
      targetType: "OrgSettings",
      targetId: ctx.organizationId,
      diff: { from: before.ballotIndividualVisibility, to: parsed.data },
    });
    refresh(ctx);
    return {};
  },
);

export const updateDatabaseVisibility = withOrgAction(
  async (ctx, databaseId: string, value: string): Promise<PrivacyResult> => {
    requirePermission(ctx, "privacy.write");
    const id = z.string().min(1).max(100).parse(databaseId);
    const parsed = z.enum(MemberVisibility).safeParse(value);
    if (!parsed.success) return { error: "Choose a valid option." };
    const db = await ctx.db.databaseDefinition.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { name: true, memberVisibility: true },
    });
    if (!db) return { error: "That database no longer exists." };
    if (db.memberVisibility === parsed.data) return {};
    await ctx.db.databaseDefinition.update({
      where: { id },
      data: { memberVisibility: parsed.data },
    });
    await writeOrgAuditLog(ctx.db, {
      organizationId: ctx.organizationId,
      action: "privacy.database_visibility_changed",
      targetType: "DatabaseDefinition",
      targetId: id,
      diff: { database: db.name, from: db.memberVisibility, to: parsed.data },
    });
    refresh(ctx);
    return {};
  },
);
