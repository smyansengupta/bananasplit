"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { can } from "@/lib/auth/permissions";
import { withOrgAction } from "@/server/db/context";

/**
 * Projects on the task board. Any member creates and archives projects;
 * OWNER/ADMIN turn a project into an intake queue (Design Requests) with a
 * triage owner and a default due window.
 */

const projectSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
});

const id = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);

const createProjectTx = withOrgAction(async (ctx, input: unknown) => {
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const project = await ctx.db.project.create({
    data: { organizationId: ctx.organizationId, name: parsed.data.name },
    select: { id: true },
  });
  return { projectId: project.id };
});

export async function createProject(orgId: string, input: unknown) {
  const result = await createProjectTx(orgId, input);
  if (!("error" in result)) refresh();
  return result;
}

const setArchivedTx = withOrgAction(async (ctx, projectId: string, archived: boolean) => {
  if (!id.safeParse(projectId).success) return { error: "Project not found." };
  await ctx.db.project.updateMany({
    where: { id: projectId, organizationId: ctx.organizationId },
    data: { archivedAt: archived ? new Date() : null },
  });
  return {};
});

export async function archiveProject(orgId: string, projectId: string) {
  const result = await setArchivedTx(orgId, projectId, true);
  refresh();
  return result;
}

export async function unarchiveProject(orgId: string, projectId: string) {
  const result = await setArchivedTx(orgId, projectId, false);
  refresh();
  return result;
}

const intakeSchema = z.object({
  projectId: id,
  isIntake: z.boolean(),
  triageUserId: id.nullable(),
  defaultDueInDays: z.number().int().min(1).max(60).nullable(),
});

const setIntakeTx = withOrgAction(async (ctx, input: unknown) => {
  if (!can(ctx, "tasks.manageAll")) return { error: "Only an owner or admin can set up an intake queue." };
  const parsed = intakeSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;
  if (d.triageUserId) {
    const member = await ctx.db.membership.findFirst({
      where: { organizationId: ctx.organizationId, userId: d.triageUserId },
      select: { id: true },
    });
    if (!member) return { error: "The triage owner must be a member." };
  }
  const res = await ctx.db.project.updateMany({
    where: { id: d.projectId, organizationId: ctx.organizationId },
    data: {
      isIntake: d.isIntake,
      triageUserId: d.isIntake ? d.triageUserId : null,
      defaultDueInDays: d.isIntake ? d.defaultDueInDays : null,
    },
  });
  if (res.count === 0) return { error: "Project not found." };
  return {};
});

/** OWNER/ADMIN: make a project an intake queue (or back into a plain project). */
export async function setProjectIntake(
  orgId: string,
  input: { projectId: string; isIntake: boolean; triageUserId: string | null; defaultDueInDays: number | null },
) {
  const result = await setIntakeTx(orgId, input);
  if (!result.error) refresh();
  return result;
}
