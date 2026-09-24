"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { withOrgAction } from "@/server/db/context";
import { cancelOrgDeletion, scheduleOrgDeletion } from "@/server/settings/deletion";

/**
 * Settings > Danger zone actions, OWNER-only (each service re-checks the
 * permission; the database makes deletedAt and deleteScheduledFor
 * OWNER-only too).
 */

export const scheduleDeletionAction = withOrgAction(async (ctx, confirmSlug: string) => {
  const result = await scheduleOrgDeletion(ctx, z.string().max(100).parse(confirmSlug));
  if (!result.ok) return { error: result.error };
  redirect("/app");
});

export const cancelDeletionAction = withOrgAction(async (ctx) => cancelOrgDeletion(ctx));
