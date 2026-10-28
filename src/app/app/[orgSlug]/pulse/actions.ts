"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { ForbiddenError } from "@/lib/auth/errors";
import { requirePermission } from "@/lib/auth/permissions";
import { withOrgAction } from "@/server/db/context";

/**
 * The one member write on a pulse issue: an admin's note before it goes
 * out (RLS: OWNER/ADMIN, and only the note column). Once an issue is sent,
 * its note stays as it went out.
 */

const noteSchema = z.object({
  issueId: z.string().min(1).max(100),
  note: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().max(1000, "Keep the note under 1,000 characters.")),
});

const saveNoteTx = withOrgAction(
  async (ctx, raw: unknown): Promise<{ ok: boolean; error?: string }> => {
    requirePermission(ctx, "settings.general.write");
    const parsed = noteSchema.safeParse(raw);
    if (!parsed.success)
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the note." };
    const updated = await ctx.db.pulseIssue.updateMany({
      where: { id: parsed.data.issueId, organizationId: ctx.organizationId, sentAt: null },
      data: { note: parsed.data.note || null },
    });
    if (updated.count === 0) return { ok: false, error: "This pulse has already gone out." };
    return { ok: true };
  },
  { onRefused: "return", feature: "overview" },
);

export async function savePulseNoteAction(
  orgId: string,
  input: { issueId: string; note: string },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const result = await saveNoteTx(orgId, input);
    if ("ok" in result && result.ok) refresh();
    return "ok" in result ? result : { ok: false, error: "This organization is paused." };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "Only the organization's owners and admins can add a note." };
    }
    throw error;
  }
}
