"use server";

import { z } from "zod";

import { requirePermission } from "@/lib/auth/permissions";
import { withOrgAction } from "@/server/db/context";
import { getClaudeKeyStatus } from "@/server/org-chart/claude";
import {
  discardDraft,
  DRAFT_SOURCES,
  getOpenTasks,
  OrgChartError,
  publishDraft,
  retryParse,
  rollbackToVersion,
  saveDraft,
  startDraft,
  type DraftSource,
  type OpenTasks,
  type PublishResult,
  type SaveDraftResult,
} from "@/server/org-chart/service";

/** Every action here belongs to people (withOrgAction's space check). */
const peopleAction: typeof withOrgAction = (handler, options) =>
  withOrgAction(handler, { ...options, feature: "people" });

/**
 * Org chart Server Actions. Each runs in one withOrgAction transaction
 * (app_user, RLS); writes need orgchart.write (every member). OrgChartError
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

const startDraftTx = peopleAction(async (ctx, from: DraftSource) => {
  const versionId = await startDraft(ctx, z.enum(DRAFT_SOURCES).parse(from));
  return { ok: true as const, versionId };
});
export async function startDraftAction(organizationId: string, from: DraftSource) {
  return rescue(startDraftTx)(organizationId, from);
}

const saveDraftTx = peopleAction((ctx, input: unknown): Promise<SaveDraftResult> =>
  saveDraft(ctx, input),
);
export async function saveDraftAction(organizationId: string, input: unknown) {
  return rescue(saveDraftTx)(organizationId, input);
}

const publishTx = peopleAction(
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

const discardTx = peopleAction(async (ctx, versionId: string) => {
  await discardDraft(ctx, id.parse(versionId));
  return { ok: true as const };
});
export async function discardDraftAction(organizationId: string, versionId: string) {
  return rescue(discardTx)(organizationId, versionId);
}

const rollbackTx = peopleAction((ctx, versionId: string) =>
  rollbackToVersion(ctx, id.parse(versionId)),
);
export async function rollbackAction(organizationId: string, versionId: string) {
  return rescue(rollbackTx)(organizationId, versionId);
}

const retryTx = peopleAction(async (ctx, versionId: string, claudeKeySaved: boolean) => {
  await retryParse(ctx, id.parse(versionId), claudeKeySaved);
  return { ok: true as const };
});
export async function retryParseAction(organizationId: string, versionId: string) {
  // Read before the transaction (members cannot read OrgIntegration). The
  // boolean is only acted on inside it, after membership is checked.
  const { saved } = await getClaudeKeyStatus(organizationId);
  return rescue(retryTx)(organizationId, versionId, saved);
}

/** The side panel's open tasks for a member (any member may look). */
const openTasksTx = peopleAction(async (ctx, userId: string): Promise<OpenTasks> => {
  requirePermission(ctx, "orgchart.view");
  return getOpenTasks(ctx, id.parse(userId));
});
export async function loadOpenTasksAction(organizationId: string, userId: string) {
  return openTasksTx(organizationId, userId);
}
