"use server";

import { z } from "zod";

import { ForbiddenError } from "@/lib/auth/errors";
import { can } from "@/lib/auth/permissions";
import { LABEL_COLOR_PALETTE } from "@/lib/label-colors";
import { writeOrgAuditLog } from "@/server/audit";
import { withOrgAction, type OrgContext } from "@/server/db/context";

/**
 * Settings > Labels, on app_user through withOrgAction. Label RLS is
 * member-level (tasks attach labels), so the palette's admin-only rule is
 * enforced here: the page only links for owners and admins, which is a UI
 * convenience, not a substitute for this check.
 */

const labelSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(40),
  color: z.enum(LABEL_COLOR_PALETTE),
});

const idSchema = z.string().min(1).max(100);

function assertCanManageLabels(ctx: OrgContext) {
  if (!can(ctx, "labels.write")) {
    throw new ForbiddenError("Only owners and admins can manage labels.");
  }
}

export const createLabel = withOrgAction(async (ctx, input: unknown) => {
  assertCanManageLabels(ctx);
  const parsed = labelSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const label = await ctx.db.label.create({
    data: { organizationId: ctx.organizationId, name: parsed.data.name, color: parsed.data.color },
    select: { id: true },
  });
  await writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action: "label.created",
    targetType: "Label",
    targetId: label.id,
    diff: { name: parsed.data.name },
  });
  return {};
});

export const updateLabel = withOrgAction(async (ctx, labelId: string, input: unknown) => {
  assertCanManageLabels(ctx);
  const id = idSchema.parse(labelId);
  const parsed = labelSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  await ctx.db.label.updateMany({
    where: { id, organizationId: ctx.organizationId },
    data: { name: parsed.data.name, color: parsed.data.color },
  });
  return {};
});

export const deleteLabel = withOrgAction(async (ctx, labelId: string) => {
  assertCanManageLabels(ctx);
  const id = idSchema.parse(labelId);
  await ctx.db.taskLabel.deleteMany({ where: { labelId: id, organizationId: ctx.organizationId } });
  const { count } = await ctx.db.label.deleteMany({
    where: { id, organizationId: ctx.organizationId },
  });
  if (count > 0) {
    await writeOrgAuditLog(ctx.db, {
      organizationId: ctx.organizationId,
      action: "label.deleted",
      targetType: "Label",
      targetId: id,
    });
  }
  return {};
});
