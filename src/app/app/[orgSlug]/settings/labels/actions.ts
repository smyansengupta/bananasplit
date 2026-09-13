"use server";

import { z } from "zod";

import { withOrgContext } from "@/lib/auth/with-org-context";
import { LABEL_COLOR_PALETTE } from "@/lib/label-colors";
import { prisma } from "@/lib/prisma";

const labelSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(40),
  color: z.enum(LABEL_COLOR_PALETTE),
});

export const createLabel = withOrgContext(async (ctx, input: unknown) => {
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
  await prisma.$transaction([
    prisma.taskLabel.deleteMany({
      where: { labelId, task: { organizationId: ctx.organizationId } },
    }),
    prisma.label.deleteMany({ where: { id: labelId, organizationId: ctx.organizationId } }),
  ]);
  return {};
});
