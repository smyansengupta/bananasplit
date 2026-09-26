"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { can } from "@/lib/auth/permissions";
import { withOrgAction } from "@/server/db/context";

/**
 * Projects on the task board. Creating, archiving and unarchiving a project
 * all need `tasks.manageAll` (OWNER/ADMIN), as does turning a project into an
 * intake queue (Design Requests) with a triage owner and a default due
 * window.
 *
 * Projects are org-wide structure: every member sees the same list in the
 * project filter, the CBC set is created by the OWNER-only 'Bootstrap CBC
 * workspace' action, and one of them is the intake queue. Until now
 * createProjectTx and setArchivedTx made no permission check at all, so any
 * MEMBER could add a project, or archive the admin-configured intake project
 * out from under the queue (reproduced). Row-level security only scopes these
 * writes to the caller's org; it carries no role predicate, so the check has
 * to be here. Gating create as well as archive keeps the pair symmetric — a
 * member who could create but not archive would leave clutter only an admin
 * could clear — and matches labels, the other org-wide taxonomy, which is
 * already admin-only.
 */

const DENIED = "Only an owner or admin can manage projects.";

const projectSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
});

const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/);

const createProjectTx = withOrgAction(async (ctx, input: unknown) => {
  if (!can(ctx, "tasks.manageAll")) return { error: DENIED };
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
  if (!can(ctx, "tasks.manageAll")) return { error: DENIED };
  if (!id.safeParse(projectId).success) return { error: "Project not found." };
  await ctx.db.project.updateMany({
    where: { id: projectId, organizationId: ctx.organizationId },
    data: { archivedAt: archived ? new Date() : null },
  });
  return {};
});

export async function archiveProject(orgId: string, projectId: string) {
  const result = await setArchivedTx(orgId, projectId, true);
  if (!result.error) refresh();
  return result;
}

export async function unarchiveProject(orgId: string, projectId: string) {
  const result = await setArchivedTx(orgId, projectId, false);
  if (!result.error) refresh();
  return result;
}

const intakeSchema = z.object({
  projectId: id,
  isIntake: z.boolean(),
  triageUserId: id.nullable(),
  defaultDueInDays: z.number().int().min(1).max(60).nullable(),
});

const setIntakeTx = withOrgAction(async (ctx, input: unknown) => {
  if (!can(ctx, "tasks.manageAll"))
    return { error: "Only an owner or admin can set up an intake queue." };
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
  input: {
    projectId: string;
    isIntake: boolean;
    triageUserId: string | null;
    defaultDueInDays: number | null;
  },
) {
  const result = await setIntakeTx(orgId, input);
  if (!result.error) refresh();
  return result;
}
