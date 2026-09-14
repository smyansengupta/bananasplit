"use server";

import { z } from "zod";

import { Role } from "@/generated/prisma/client";
import { ForbiddenError } from "@/lib/auth/errors";
import { withOrgContext } from "@/lib/auth/with-org-context";
import { LABEL_COLOR_PALETTE } from "@/lib/label-colors";
import { prisma } from "@/lib/prisma";

const labelSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(40),
  color: z.enum(LABEL_COLOR_PALETTE),
});

// The settings page only links here for owners/admins (see settings/page.tsx)
// — that's a UI convenience, not a substitute for this check. Without it, a
// plain member could call these actions directly and edit the shared label
// palette the UI hides from them.
function assertCanManageLabels(role: Role) {
  if (role !== Role.OWNER && role !== Role.ADMIN) {
    throw new ForbiddenError("Only owners and admins can manage labels.");
  }
}

export const createLabel = withOrgContext(async (ctx, input: unknown) => {
  assertCanManageLabels(ctx.role);
  const parsed = labelSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  await prisma.label.create({
    data: { organizationId: ctx.organizationId, name: parsed.data.name, color: parsed.data.color },
  });
  return {};
});

export const updateLabel = withOrgContext(async (ctx, labelId: string, input: unknown) => {
  assertCanManageLabels(ctx.role);
  const parsed = labelSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  await prisma.label.updateMany({
    where: { id: labelId, organizationId: ctx.organizationId },
    data: { name: parsed.data.name, color: parsed.data.color },
  });
  return {};
});

export const deleteLabel = withOrgContext(async (ctx, labelId: string) => {
  assertCanManageLabels(ctx.role);
  await prisma.$transaction([
    prisma.taskLabel.deleteMany({
      where: { labelId, task: { organizationId: ctx.organizationId } },
    }),
    prisma.label.deleteMany({ where: { id: labelId, organizationId: ctx.organizationId } }),
  ]);
  return {};
});
