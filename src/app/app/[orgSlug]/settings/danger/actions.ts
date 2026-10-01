"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { getUserIdentity } from "@/lib/auth/email-verification";
import { isPlatformAdmin } from "@/lib/auth/org-creation";
import { requireUser } from "@/lib/auth/session";
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

const bootstrapInOrg = withOrgAction(async (ctx, mapping: Record<string, string>) =>
  bootstrapCbcWorkspace(ctx, mapping),
);

/** The CBC template is for the platform's own club: platform admins only. */
export async function bootstrapCbcAction(
  organizationId: string,
  mapping: Record<string, string>,
): Promise<{ error?: string; chartVersionId?: string }> {
  const user = await requireUser();
  if (!isPlatformAdmin(await getUserIdentity(user.id))) {
    return { error: "Only platform admins can apply this template." };
  }
  return bootstrapInOrg(organizationId, mapping);
}

export const scheduleDeletionAction = withOrgAction(
  async (ctx, confirmSlug: string): Promise<{ error?: string }> => {
    const result = await scheduleOrgDeletion(ctx, z.string().max(100).parse(confirmSlug));
    if (!result.ok) return { error: result.error };
    redirect("/app");
  },
);

export const cancelDeletionAction = withOrgAction(async (ctx) => cancelOrgDeletion(ctx));
