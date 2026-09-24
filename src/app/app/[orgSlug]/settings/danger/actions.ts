"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { withOrgAction } from "@/server/db/context";
import { requestOrgExport } from "@/server/export/service";
import { bootstrapCbcWorkspace } from "@/server/settings/bootstrap";
import { cancelOrgDeletion, scheduleOrgDeletion } from "@/server/settings/deletion";

/**
 * Settings > Danger zone actions, OWNER-only: every service re-checks the
 * permission, and the database makes deletedAt, deleteScheduledFor and
 * OrgExport inserts OWNER-only too.
 */

export const requestExportAction = withOrgAction(
  async (ctx): Promise<{ error?: string; exportId?: string }> => {
    const result = await requestOrgExport(ctx);
    return result.ok ? { exportId: result.exportId } : { error: result.error };
  },
);

export const bootstrapCbcAction = withOrgAction(async (ctx, mapping: Record<string, string>) =>
  bootstrapCbcWorkspace(ctx, mapping),
);

export const scheduleDeletionAction = withOrgAction(
  async (ctx, confirmSlug: string): Promise<{ error?: string }> => {
    const result = await scheduleOrgDeletion(ctx, z.string().max(100).parse(confirmSlug));
    if (!result.ok) return { error: result.error };
    redirect("/app");
  },
);

export const cancelDeletionAction = withOrgAction(async (ctx) => cancelOrgDeletion(ctx));
