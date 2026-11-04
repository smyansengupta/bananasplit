"use server";

import { requirePermission } from "@/lib/auth/permissions";
import { isStartedStep, STARTED_STEP_KEYS } from "@/lib/overview/getting-started";
import { writeOrgAuditLog } from "@/server/audit";
import { withOrgAction } from "@/server/db/context";

/**
 * Checks a "Get your club started" step off as not needed, or puts it back
 * (OWNER/ADMIN; RLS lets only them update OrgSettings). Steps the club has
 * actually done stay done whatever is stored here.
 */
export const setStartedStepSkipped = withOrgAction(
  async (ctx, step: unknown, skipped: unknown): Promise<{ ok: boolean; error?: string }> => {
    requirePermission(ctx, "settings.general.write");
    if (!isStartedStep(step) || typeof skipped !== "boolean") {
      return { ok: false, error: "That step isn't on the list." };
    }
    const row = await ctx.db.orgSettings.findUnique({
      where: { organizationId: ctx.organizationId },
      select: { startedSkipped: true },
    });
    const current = new Set(row?.startedSkipped ?? []);
    if (skipped) current.add(step);
    else current.delete(step);
    await ctx.db.orgSettings.update({
      where: { organizationId: ctx.organizationId },
      data: { startedSkipped: [...current] },
      select: { organizationId: true },
    });
    await writeOrgAuditLog(ctx.db, {
      organizationId: ctx.organizationId,
      action: "settings.started.updated",
      targetType: "OrgSettings",
      targetId: ctx.organizationId,
      diff: { step, skipped },
    });
    return { ok: true };
  },
  { onRefused: "return" },
);

/**
 * Hides the whole card at once: every step not done yet is checked off.
 * Returns what was checked off before, so Undo puts exactly that back
 * (restoreStartedSkipped).
 */
export const hideGettingStarted = withOrgAction(
  async (ctx): Promise<{ ok: boolean; error?: string; previous?: string[] }> => {
    requirePermission(ctx, "settings.general.write");
    const row = await ctx.db.orgSettings.findUnique({
      where: { organizationId: ctx.organizationId },
      select: { startedSkipped: true },
    });
    const previous = row?.startedSkipped ?? [];
    await ctx.db.orgSettings.update({
      where: { organizationId: ctx.organizationId },
      data: { startedSkipped: [...STARTED_STEP_KEYS] },
      select: { organizationId: true },
    });
    await writeOrgAuditLog(ctx.db, {
      organizationId: ctx.organizationId,
      action: "settings.started.updated",
      targetType: "OrgSettings",
      targetId: ctx.organizationId,
      diff: { hidden: true },
    });
    return { ok: true, previous };
  },
  { onRefused: "return" },
);

/** Undo for hideGettingStarted: the steps checked off before, and no more. */
export const restoreStartedSkipped = withOrgAction(
  async (ctx, previous: unknown): Promise<{ ok: boolean; error?: string }> => {
    requirePermission(ctx, "settings.general.write");
    if (!Array.isArray(previous)) return { ok: false, error: "Nothing to put back." };
    await ctx.db.orgSettings.update({
      where: { organizationId: ctx.organizationId },
      data: { startedSkipped: previous.filter(isStartedStep) },
      select: { organizationId: true },
    });
    return { ok: true };
  },
  { onRefused: "return" },
);
