"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { ForbiddenError } from "@/lib/auth/errors";
import { requirePermission } from "@/lib/auth/permissions";
import { dueDateKey } from "@/lib/tasks/dates";
import { writeOrgAuditLog } from "@/server/audit";
import { withOrgAction } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";

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

/** "Turn on" from the archive's empty state: the weekly pulse, with its usual schedule. */
export const turnPulseOnAction = withOrgAction(
  async (ctx): Promise<{ ok: boolean; error?: string }> => {
    requirePermission(ctx, "settings.general.write");
    await ctx.db.orgSettings.update({
      where: { organizationId: ctx.organizationId },
      data: { pulseEnabled: true, updatedById: ctx.userId },
      select: { organizationId: true },
    });
    refresh();
    return { ok: true };
  },
  { onRefused: "return", feature: "overview" },
);

/**
 * Send now (the archive, on this week's draft): the week's usual send,
 * brought forward to now. It is the same weekly-pulse job, so it compiles
 * the week afresh, keeps the note and claims the issue before anything goes
 * out (it can never send twice); the scheduled run then finds it sent.
 */
export const sendPulseNowAction = withOrgAction(
  async (ctx, issueId: unknown): Promise<{ ok: boolean; error?: string }> => {
    requirePermission(ctx, "settings.general.write");
    const id = z.string().min(1).max(100).safeParse(issueId);
    if (!id.success) return { ok: false, error: "That pulse is gone." };
    const issue = await ctx.db.pulseIssue.findFirst({
      where: { id: id.data, organizationId: ctx.organizationId },
      select: { id: true, weekStart: true, sentAt: true },
    });
    if (!issue) return { ok: false, error: "That pulse is gone." };
    if (issue.sentAt) return { ok: false, error: "This pulse has already gone out." };
    const settings = await ctx.db.orgSettings.findUnique({
      where: { organizationId: ctx.organizationId },
      select: { pulseEnabled: true },
    });
    if (!settings?.pulseEnabled) return { ok: false, error: "Turn the pulse on first." };
    const weekStart = dueDateKey(issue.weekStart);
    await enqueueJob(ctx.db, {
      orgId: ctx.organizationId,
      kind: "weekly-pulse",
      key: weekStart,
      payload: { weekStart },
      runAt: new Date(),
      once: true,
    });
    await writeOrgAuditLog(ctx.db, {
      organizationId: ctx.organizationId,
      action: "pulse.sent_now",
      targetType: "PulseIssue",
      targetId: issue.id,
    });
    refresh();
    return { ok: true };
  },
  { onRefused: "return", feature: "overview" },
);
