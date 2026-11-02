"use server";

import { can } from "@/lib/auth/permissions";
import { isAddOn } from "@/lib/addons";
import { checkRateLimit, rateLimitKey, retryAfterText } from "@/lib/rate-limit";
import { writeOrgAuditLog } from "@/server/audit";
import { withOrgAction } from "@/server/db/context";

/**
 * Adding and turning off an add-on (src/lib/addons.ts): owners and admins,
 * as for the sidebar (RLS lets only them update OrgSettings). Turning one off
 * changes only OrgSettings.addOns; nothing it made is touched. Each change
 * is one statement, so two admins adding different add-ons at once both
 * stick, and a change that changes nothing writes no audit row.
 */

type Result = { ok: true } | { ok: false; error: string };

/** Add-on changes a person can make in an hour (a held-down key, a script). */
const CHANGES_PER_HOUR = 30;

async function setAddOn(
  ctx: Parameters<Parameters<typeof withOrgAction>[0]>[0],
  id: string,
  on: boolean,
): Promise<Result> {
  if (!can(ctx, "settings.general.write")) {
    return { ok: false, error: "Only owners and admins can add or turn off add-ons." };
  }
  if (!isAddOn(id)) return { ok: false, error: "That add-on doesn't exist." };
  const hit = await checkRateLimit(
    rateLimitKey("addons", ctx.organizationId, ctx.userId),
    CHANGES_PER_HOUR,
    60 * 60,
  );
  if (!hit.allowed) {
    return { ok: false, error: `That's a lot of changes. Try again ${retryAfterText(hit)}.` };
  }
  const changed = on
    ? await ctx.db.$executeRaw`
        UPDATE "OrgSettings" SET "addOns" = array_append("addOns", ${id}), "updatedAt" = now()
         WHERE "organizationId" = ${ctx.organizationId} AND NOT (${id} = ANY ("addOns"))`
    : await ctx.db.$executeRaw`
        UPDATE "OrgSettings" SET "addOns" = array_remove("addOns", ${id}), "updatedAt" = now()
         WHERE "organizationId" = ${ctx.organizationId} AND ${id} = ANY ("addOns")`;
  if (changed === 0) return { ok: true };
  await writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action: on ? "settings.addon.added" : "settings.addon.removed",
    targetType: "OrgSettings",
    targetId: ctx.organizationId,
    diff: { addOn: id },
  });
  return { ok: true };
}

export const addAddOnAction = withOrgAction(async (ctx, id: string) => setAddOn(ctx, id, true));

export const removeAddOnAction = withOrgAction(async (ctx, id: string) => setAddOn(ctx, id, false));
