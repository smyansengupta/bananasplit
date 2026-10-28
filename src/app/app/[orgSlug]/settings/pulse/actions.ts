"use server";

import { refresh } from "next/cache";

import { ForbiddenError } from "@/lib/auth/errors";
import { withOrgAction } from "@/server/db/context";
import { savePulseSettings } from "@/server/onboarding/pulse";

const saveTx = withOrgAction((ctx, raw: unknown) => savePulseSettings(ctx, raw), {
  onRefused: "return",
  feature: "overview",
});

/** Admin panel › Weekly pulse (OWNER/ADMIN). */
export async function savePulseSettingsAction(
  orgId: string,
  raw: unknown,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const result = await saveTx(orgId, raw);
    if (!("ok" in result)) return { ok: false, error: "This organization is paused." };
    if (result.ok) refresh();
    return result;
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "Only the organization's owners and admins can change this." };
    }
    throw error;
  }
}
