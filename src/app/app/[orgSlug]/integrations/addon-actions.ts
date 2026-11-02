"use server";

import { can } from "@/lib/auth/permissions";
import { isAddOn, readAddOns } from "@/lib/addons";
import { writeOrgAuditLog } from "@/server/audit";
import { withOrgAction } from "@/server/db/context";

/**
 * Adding and taking off an add-on (src/lib/addons.ts): owners and admins,
 * as for the sidebar (RLS lets only them update OrgSettings). Taking one off
 * changes only OrgSettings.addOns; nothing it made is touched.
 */

type Result = { ok: true } | { ok: false; error: string };

async function setAddOn(
  ctx: Parameters<Parameters<typeof withOrgAction>[0]>[0],
  id: string,
  on: boolean,
): Promise<Result> {
  if (!can(ctx, "settings.general.write")) {
    return { ok: false, error: "Only owners and admins can add or take off add-ons." };
  }
  if (!isAddOn(id)) return { ok: false, error: "That add-on doesn't exist." };
  const row = await ctx.db.orgSettings.findUnique({
    where: { organizationId: ctx.organizationId },
    select: { addOns: true },
  });
  const now = readAddOns(row?.addOns);
  const next = on ? readAddOns([...now, id]) : now.filter((a) => a !== id);
  if (next.length === now.length) return { ok: true };
  await ctx.db.orgSettings.update({
    where: { organizationId: ctx.organizationId },
    data: { addOns: next },
    select: { organizationId: true },
  });
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
