"use server";

import { z } from "zod";

import { requirePermission } from "@/lib/auth/permissions";
import { isReservedSlug } from "@/lib/slug";
import { isValidTimeZone } from "@/lib/timezones";
import { writeOrgAuditLog } from "@/server/audit";
import { tags } from "@/server/cache/tags";
import { invalidate } from "@/server/cache/invalidate";
import { withOrgAction } from "@/server/db/context";
import { sqlStateOf } from "@/server/db/errors";
import { orgNameSchema, orgSlugSchema } from "@/server/settings/org-creation";

/**
 * Settings > General, on app_user through withOrgAction. Name and timezone
 * are ADMIN+; the URL (slug) is OWNER-only, in the app and in the database
 * (app.organization_guard). The organization_slug_guard trigger refuses a
 * reserved or retired slug and records the old slug in OrgSlugHistory, so
 * it keeps redirecting (307) to the org and can never be taken by another.
 */

export interface GeneralResult {
  error?: string;
}

export const updateOrgName = withOrgAction(async (ctx, name: string): Promise<GeneralResult> => {
  requirePermission(ctx, "settings.general.write");
  const parsed = orgNameSchema.safeParse(name);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid name" };
  const before = await ctx.db.organization.findUniqueOrThrow({
    where: { id: ctx.organizationId },
    select: { name: true },
  });
  if (before.name === parsed.data) return {};
  await ctx.db.organization.update({
    where: { id: ctx.organizationId },
    data: { name: parsed.data },
  });
  await writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action: "org.renamed",
    targetType: "Organization",
    targetId: ctx.organizationId,
    diff: { from: before.name, to: parsed.data },
  });
  invalidate([tags.publicEvents(ctx.organizationId), tags.theme(ctx.organizationId)]);
  return {};
});

export const updateOrgTimezone = withOrgAction(
  async (ctx, timezone: string): Promise<GeneralResult> => {
    requirePermission(ctx, "settings.general.write");
    const tz = z.string().trim().max(64).parse(timezone);
    if (!isValidTimeZone(tz)) return { error: "Choose a valid timezone." };
    const before = await ctx.db.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
      select: { timezone: true },
    });
    if (before.timezone === tz) return {};
    await ctx.db.organization.update({ where: { id: ctx.organizationId }, data: { timezone: tz } });
    await writeOrgAuditLog(ctx.db, {
      organizationId: ctx.organizationId,
      action: "org.timezone_changed",
      targetType: "Organization",
      targetId: ctx.organizationId,
      diff: { from: before.timezone, to: tz },
    });
    invalidate([tags.reports(ctx.organizationId), tags.publicEvents(ctx.organizationId)]);
    return {};
  },
);

export const renameOrgSlug = withOrgAction(
  async (ctx, newSlug: string): Promise<GeneralResult & { slug?: string }> => {
    requirePermission(ctx, "org.slug.write");
    const parsed = orgSlugSchema.safeParse(newSlug);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid URL" };
    const slug = parsed.data;
    if (isReservedSlug(slug)) return { error: "That URL is reserved. Pick another." };

    const org = await ctx.db.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
      select: { slug: true },
    });
    if (org.slug === slug) return { slug };

    // A retired slug of THIS org may be taken back; anything else must be free.
    const free = await ctx.db.$queryRaw<
      { ok: boolean }[]
    >`SELECT app.slug_available(${slug}) AS ok`;
    const ownOld = await ctx.db.$queryRaw<{ id: string }[]>`
      SELECT "organizationId" AS id FROM app.resolve_org_slug(${slug}) WHERE "isRetired"`;
    if (free[0]?.ok !== true && ownOld[0]?.id !== ctx.organizationId) {
      return { error: "That URL is already taken." };
    }

    try {
      await ctx.db.organization.update({ where: { id: ctx.organizationId }, data: { slug } });
    } catch (error) {
      if (sqlStateOf(error) === "23505") return { error: "That URL is already taken." };
      throw error;
    }
    await writeOrgAuditLog(ctx.db, {
      organizationId: ctx.organizationId,
      action: "org.slug_changed",
      targetType: "Organization",
      targetId: ctx.organizationId,
      diff: { from: org.slug, to: slug },
    });
    // The themed public pages (/poll, /invite) carry the org name, logo and
    // links, so they refresh with the theme tag.
    invalidate([tags.publicEvents(ctx.organizationId), tags.theme(ctx.organizationId)]);
    return { slug };
  },
);
