"use server";

import { z } from "zod";

import { withOrgContext } from "@/lib/auth/with-org-context";
import { prisma } from "@/lib/prisma";

const projectSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
});

export const createProject = withOrgContext(async (ctx, input: unknown) => {
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const project = await prisma.project.create({
    data: { organizationId: ctx.organizationId, name: parsed.data.name },
  });
  return { projectId: project.id };
});

export const archiveProject = withOrgContext(async (ctx, projectId: string) => {
  await prisma.project.updateMany({
    where: { id: projectId, organizationId: ctx.organizationId },
    data: { archivedAt: new Date() },
  });
  return {};
});

export const unarchiveProject = withOrgContext(async (ctx, projectId: string) => {
  await prisma.project.updateMany({
    where: { id: projectId, organizationId: ctx.organizationId },
    data: { archivedAt: null },
  });
  return {};
});
