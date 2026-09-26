"use server";

import { refresh } from "next/cache";

import { Prisma } from "@/generated/prisma/client";
import { can } from "@/lib/auth/permissions";
import type { ContrastWarning } from "@/lib/theme/contrast";
import { buildThemeRecord } from "@/lib/theme/record";
import { themeInputSchema } from "@/lib/theme/validate";
import { writeOrgAuditLog } from "@/server/audit";
import { invalidate } from "@/server/cache/invalidate";
import { tags } from "@/server/cache/tags";
import { withOrgAction, type OrgContext } from "@/server/db/context";

/**
 * Settings > Theme (Phase 8). OWNER/ADMIN only: checked here for a clear
 * message, and again by the OrgTheme RLS policies (writes need
 * app.is_org_admin()).
 *
 * The input is validated strictly (every colour /^#[0-9a-f]{6}$/i, the
 * object shape closed), and the tokens and contrast warnings are recomputed
 * on the server from the roles, never taken from the client. A failing
 * contrast check does not block the save (the spec says warn); the warnings
 * are stored and returned.
 *
 * After COMMIT: invalidate the public-page branding cache (tags.theme) and
 * refresh the client router, so the org layout re-renders its <style> with
 * the new tokens: the whole app restyles without a reload or a rebuild.
 */

export type SaveThemeResult =
  { ok: true; warnings: ContrastWarning[] } | { ok: false; error: string };

const NO_ACCESS = "Only owners and admins can change the theme.";

function afterThemeChange(ctx: OrgContext): void {
  invalidate([tags.theme(ctx.organizationId)]);
  ctx.afterCommit(() => refresh());
}

export const saveOrgTheme = withOrgAction(async (ctx, input: unknown): Promise<SaveThemeResult> => {
  if (!can(ctx, "theme.write")) return { ok: false, error: NO_ACCESS };

  const parsed = themeInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Every colour must be a six-digit hex value like #a34a2a." };
  }
  const record = buildThemeRecord(parsed.data);

  const previous = await ctx.db.orgTheme.findUnique({
    where: { organizationId: ctx.organizationId },
    select: { preset: true, mode: true, lockMode: true, logoDisplay: true },
  });

  const data = {
    preset: record.preset,
    mode: record.mode,
    lockMode: record.lockMode,
    logoDisplay: record.logoDisplay,
    light: record.light,
    dark: record.dark ?? Prisma.DbNull,
    tokens: record.tokens as unknown as Prisma.InputJsonValue,
    contrastWarnings: record.contrastWarnings as unknown as Prisma.InputJsonValue,
    updatedById: ctx.userId,
  };
  await ctx.db.orgTheme.upsert({
    where: { organizationId: ctx.organizationId },
    create: { organizationId: ctx.organizationId, ...data },
    update: data,
  });

  await writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action: "theme.updated",
    targetType: "OrgTheme",
    targetId: ctx.organizationId,
    diff: {
      from: previous ?? { preset: "default" },
      to: {
        preset: record.preset,
        mode: record.mode,
        lockMode: record.lockMode,
        logoDisplay: record.logoDisplay,
      },
      contrastWarnings: record.contrastWarnings.length,
    },
  });

  afterThemeChange(ctx);
  return { ok: true, warnings: record.contrastWarnings };
});

/** Back to the default theme: deleting the row is the reset (RLS allows it to admins only). */
export const resetOrgTheme = withOrgAction(async (ctx): Promise<SaveThemeResult> => {
  if (!can(ctx, "theme.write")) return { ok: false, error: NO_ACCESS };

  const { count } = await ctx.db.orgTheme.deleteMany({
    where: { organizationId: ctx.organizationId },
  });
  if (count > 0) {
    await writeOrgAuditLog(ctx.db, {
      organizationId: ctx.organizationId,
      action: "theme.reset",
      targetType: "OrgTheme",
      targetId: ctx.organizationId,
    });
    afterThemeChange(ctx);
  }
  return { ok: true, warnings: [] };
});
