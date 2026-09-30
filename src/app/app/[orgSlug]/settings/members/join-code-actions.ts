"use server";

import { z } from "zod";

import { ForbiddenError } from "@/lib/auth/errors";
import { requirePermission } from "@/lib/auth/permissions";
import { withOrgAction } from "@/server/db/context";
import {
  rotateJoinCode,
  updateJoinCodeSettings,
  type JoinCodeView,
} from "@/server/onboarding/join-code";

/**
 * The org's invite code (Settings > Members, and the welcome card after org
 * setup). OWNER/ADMIN only: members.invite here, and RLS on OrgJoinCode.
 */

export type JoinCodeResult =
  | {
      ok: true;
      code: { code: string; enabled: boolean; allowedDomain: string | null; useCount: number };
    }
  | { ok: false; error: string };

function view(code: JoinCodeView): JoinCodeResult {
  return {
    ok: true,
    code: {
      code: code.code,
      enabled: code.enabled,
      allowedDomain: code.allowedDomain,
      useCount: code.useCount,
    },
  };
}

async function guarded(run: () => Promise<JoinCodeResult>): Promise<JoinCodeResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ForbiddenError)
      return { ok: false, error: "Only owners and admins can change the invite code." };
    throw error;
  }
}

const rotateInTx = withOrgAction(async (ctx) => {
  requirePermission(ctx, "members.invite");
  return view(await rotateJoinCode(ctx.db, ctx.organizationId, ctx.userId));
});

export async function rotateJoinCodeAction(orgId: string): Promise<JoinCodeResult> {
  return guarded(() => rotateInTx(orgId));
}

const settingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    allowedDomain: z.string().max(253).nullable().optional(),
  })
  .strict();

const updateInTx = withOrgAction(async (ctx, input: z.infer<typeof settingsSchema>) => {
  requirePermission(ctx, "members.invite");
  const result = await updateJoinCodeSettings(ctx.db, ctx.organizationId, ctx.userId, input);
  return result.ok ? view(result.code) : result;
});

export async function updateJoinCodeAction(orgId: string, input: unknown): Promise<JoinCodeResult> {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That setting isn't valid." };
  return guarded(() => updateInTx(orgId, parsed.data));
}
