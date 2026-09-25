"use server";

import { z } from "zod";

import { requirePermission } from "@/lib/auth/permissions";
import { withOrgAction } from "@/server/db/context";
import {
  discardDraft,
  getOpenTasks,
  OrgChartError,
  publishDraft,
  retryParse,
  rollbackToVersion,
  saveDraft,
  startDraft,
  type OpenTasks,
  type PublishResult,
  type SaveDraftResult,
} from "@/server/org-chart/service";

/**
 * Org chart Server Actions. Each runs in one withOrgAction transaction
 * (app_user, RLS); writes need orgchart.write (OWNER/ADMIN). OrgChartError
 * is caught OUTSIDE the transaction wrapper, so a refused rollback or
 * publish rolls back completely before its message is returned.
 */

type Failure = { ok: false; error: string };

function rescue<Args extends unknown[], R>(
  fn: (organizationId: string, ...args: Args) => Promise<R>,
): (organizationId: string, ...args: Args) => Promise<R | Failure> {
  return async (organizationId, ...args) => {
    try {
      return await fn(organizationId, ...args);
    } catch (error) {
      if (error instanceof OrgChartError) return { ok: false, error: error.message };
      throw error;
    }
  };
}

const id = z.string().min(1).max(100);

const startDraftTx = withOrgAction(async (ctx, from: "blank" | "current") => {
  const versionId = await startDraft(ctx, z.enum(["blank", "current"]).parse(from));
  return { ok: true as const, versionId };
});
export async function startDraftAction(organizationId: string, from: "blank" | "current") {
  return rescue(startDraftTx)(organizationId, from);
}

const saveDraftTx = withOrgAction((ctx, input: unknown): Promise<SaveDraftResult> =>
  saveDraft(ctx, input),
);
export async function saveDraftAction(organizationId: string, input: unknown) {
  return rescue(saveDraftTx)(organizationId, input);
}

const publishTx = withOrgAction(
  (
    ctx,
    versionId: string,
    options: { setTitles?: boolean; expectedEditVersion?: number },
  ): Promise<PublishResult> =>
    publishDraft(ctx, id.parse(versionId), {
      setTitles: options?.setTitles === true,
      expectedEditVersion:
        typeof options?.expectedEditVersion === "number" ? options.expectedEditVersion : undefined,
    }),
);
export async function publishDraftAction(
  organizationId: string,
  versionId: string,
  options: { setTitles?: boolean; expectedEditVersion?: number },
) {
  return rescue(publishTx)(organizationId, versionId, options);
}

const discardTx = withOrgAction(async (ctx, versionId: string) => {
  await discardDraft(ctx, id.parse(versionId));
  return { ok: true as const };
});
export async function discardDraftAction(organizationId: string, versionId: string) {
  return rescue(discardTx)(organizationId, versionId);
}

const rollbackTx = withOrgAction((ctx, versionId: string) =>
  rollbackToVersion(ctx, id.parse(versionId)),
);
export async function rollbackAction(organizationId: string, versionId: string) {
  return rescue(rollbackTx)(organizationId, versionId);
}

const retryTx = withOrgAction(async (ctx, versionId: string) => {
  await retryParse(ctx, id.parse(versionId));
  return { ok: true as const };
});
export async function retryParseAction(organizationId: string, versionId: string) {
  return rescue(retryTx)(organizationId, versionId);
}

/** The side panel's open tasks for a member (any member may look). */
const openTasksTx = withOrgAction(async (ctx, userId: string): Promise<OpenTasks> => {
  requirePermission(ctx, "orgchart.view");
  return getOpenTasks(ctx, id.parse(userId));
});
export async function loadOpenTasksAction(organizationId: string, userId: string) {
  return openTasksTx(organizationId, userId);
}
