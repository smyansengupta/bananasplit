"use server";

import { z } from "zod";

import { IntegrationProvider } from "@/generated/prisma/enums";
import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { requirePermission } from "@/lib/auth/permissions";
import { withOrgTx } from "@/server/db/context";
import {
  disconnectGoogle,
  removeProvider,
  resolveActor,
  saveClaude,
  saveEmailSender,
  saveGoogleCalendars,
  saveSupabase,
  sendTestEmail,
  testProvider,
  type IntegrationResult,
  type OrgActor,
} from "@/server/integrations/service";
import { isSetupStepId, setupStep, type SetupStepId } from "@/server/setup/catalog";
import { diagnose } from "@/server/setup/diagnose";
import { setSetupCompleted, skipStep, unskipStep } from "@/server/setup/progress";
import { onProviderConnected, startFirstSync } from "@/server/setup/service";
import { loadDataCounts, syncPending } from "@/server/setup/summary";
import { loadSyncStatus } from "@/server/sync/status";

import type { SyncProgressView } from "./view";

/**
 * The guided setup's actions.
 *
 * Deliberately NOT withOrgAction, for the same reason Settings >
 * Integrations is not: saving, testing and removing a secret runs on the
 * service path with no transaction open around the network check
 * (src/server/secrets). Each action resolves the caller's role through the
 * database first (resolveActor: a non-member gets NotFoundError), then the
 * integration service checks integrations.write or integrations.remove.
 *
 * No action returns a credential. A save returns ok plus a message, or a
 * sanitized reason with a fix from @/server/setup/diagnose, and nothing
 * else. The secret itself only ever exists inside src/server/secrets.
 */

export type SetupResult =
  | { ok: true; message?: string; synced?: boolean }
  | { ok: false; error: string; fix?: string | null; field?: string | null };

const idSchema = z.string().min(1).max(100);
const stepSchema = z.string().refine(isSetupStepId, "unknown step");
const optionalSecret = z.string().max(8192).optional();

const claudeInput = z.object({
  apiKey: optionalSecret,
  model: z.string().max(100).optional(),
  fallbacks: z.boolean().optional(),
});
const emailInput = z.object({
  fromName: z.string().max(200),
  fromAddress: z.string().max(300),
  replyTo: z.string().max(300).optional(),
  apiKey: optionalSecret,
});
const supabaseInput = z.object({
  projectRef: z.string().max(100),
  poolerRegion: z.string().max(40),
  poolerPrefix: z.string().max(10),
  roleName: z.string().max(100).optional(),
  password: optionalSecret,
});
const calendarsInput = z.object({
  publicCalendarId: z.string().max(300).nullable().optional(),
  internalCalendarId: z.string().max(300).nullable().optional(),
});

async function run(
  orgId: string,
  fn: (actor: OrgActor) => Promise<SetupResult>,
): Promise<SetupResult> {
  try {
    const actor = await resolveActor(idSchema.parse(orgId));
    return await fn(actor);
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, error: error.message };
    if (error instanceof NotFoundError) return { ok: false, error: "Not found." };
    if (error instanceof z.ZodError) return { ok: false, error: "Invalid input." };
    throw error;
  }
}

/** Turns an integration result into a setup result, attaching the fix for a failure. */
function withFix(step: SetupStepId, result: IntegrationResult): SetupResult {
  if (result.ok) return { ok: true, message: result.message };
  const d = diagnose(step, result.error);
  return { ok: false, error: d.reason, fix: d.fix, field: d.field };
}

// ---------------------------------------------------------------- Connect

/**
 * Saves the website data source, tests it, and — only when the test passed
 * — queues the org's first sync. The sync is a heavy job kind: it runs in
 * its own invocation, never inside this request.
 */
export async function connectDataSourceAction(
  orgId: string,
  input: z.input<typeof supabaseInput>,
): Promise<SetupResult> {
  return run(orgId, async (actor) => {
    const result = await saveSupabase(orgId, actor, supabaseInput.parse(input));
    if (!result.ok) return withFix("data", result);
    await onProviderConnected(orgId, actor.userId, IntegrationProvider.SUPABASE_SOURCE);
    const synced = await startFirstSync(orgId, actor.userId);
    return {
      ok: true,
      message: synced
        ? "Connected. Pulling your data in now."
        : "Connected. The first sync will run shortly.",
      synced,
    };
  });
}

export async function connectClaudeAction(
  orgId: string,
  input: z.input<typeof claudeInput>,
): Promise<SetupResult> {
  return run(orgId, async (actor) => {
    const result = await saveClaude(orgId, actor, claudeInput.parse(input));
    if (result.ok) await onProviderConnected(orgId, actor.userId, IntegrationProvider.CLAUDE);
    return withFix("claude", result);
  });
}

export async function connectEmailAction(
  orgId: string,
  input: z.input<typeof emailInput>,
): Promise<SetupResult> {
  return run(orgId, async (actor) => {
    const result = await saveEmailSender(orgId, actor, emailInput.parse(input));
    if (result.ok) await onProviderConnected(orgId, actor.userId, IntegrationProvider.EMAIL_RESEND);
    return withFix("email", result);
  });
}

export async function sendSetupTestEmailAction(orgId: string): Promise<SetupResult> {
  return run(orgId, async (actor) => withFix("email", await sendTestEmail(orgId, actor)));
}

export async function saveSetupCalendarsAction(
  orgId: string,
  input: z.input<typeof calendarsInput>,
): Promise<SetupResult> {
  return run(orgId, async (actor) => {
    const result = await saveGoogleCalendars(orgId, actor, calendarsInput.parse(input));
    if (result.ok) {
      await onProviderConnected(orgId, actor.userId, IntegrationProvider.GOOGLE_CALENDAR);
    }
    return withFix("calendar", result);
  });
}

/**
 * Re-runs a step's connection test. The error carries the fix for that
 * step. A data source that starts working — whether it was just fixed or
 * was saved earlier and never proved — gets its first sync queued here too,
 * so "it works now" and "the data is arriving" are one action, not two.
 */
export async function testSetupStepAction(orgId: string, step: string): Promise<SetupResult> {
  const id = stepSchema.parse(step) as SetupStepId;
  return run(orgId, async (actor) => {
    const result = await testProvider(orgId, actor, setupStep(id).provider);
    if (!result.ok) return withFix(id, result);
    await onProviderConnected(orgId, actor.userId, setupStep(id).provider);
    if (id !== "data") return withFix(id, result);
    const synced = await startFirstSync(orgId, actor.userId);
    return {
      ok: true,
      message: synced ? "It works. Pulling your data in now." : (result.message ?? "It works."),
      synced,
    };
  });
}

// ---------------------------------------------------------------- Disconnect

/** OWNER-only for every step except Google, where an ADMIN may disconnect. */
export async function disconnectSetupStepAction(orgId: string, step: string): Promise<SetupResult> {
  const id = stepSchema.parse(step) as SetupStepId;
  return run(orgId, async (actor) => {
    const provider = setupStep(id).provider;
    if (provider === IntegrationProvider.GOOGLE_CALENDAR) {
      return withFix(id, await disconnectGoogle(orgId, actor));
    }
    return withFix(id, await removeProvider(orgId, actor, provider));
  });
}

// ---------------------------------------------------------------- Progress

export async function skipSetupStepAction(orgId: string, step: string): Promise<SetupResult> {
  const id = stepSchema.parse(step) as SetupStepId;
  return run(orgId, async () =>
    withOrgTx(orgId, async (ctx) => {
      requirePermission(ctx, "integrations.write");
      await skipStep(ctx.db, orgId, ctx.userId, id);
      return { ok: true as const, message: "Skipped. You can come back to it any time." };
    }),
  );
}

export async function resumeSetupStepAction(orgId: string, step: string): Promise<SetupResult> {
  const id = stepSchema.parse(step) as SetupStepId;
  return run(orgId, async () =>
    withOrgTx(orgId, async (ctx) => {
      requirePermission(ctx, "integrations.write");
      await unskipStep(ctx.db, orgId, ctx.userId, id);
      return { ok: true as const };
    }),
  );
}

export async function finishSetupAction(orgId: string, done: boolean): Promise<SetupResult> {
  return run(orgId, async () =>
    withOrgTx(orgId, async (ctx) => {
      requirePermission(ctx, "integrations.write");
      await setSetupCompleted(ctx.db, orgId, ctx.userId, z.boolean().parse(done));
      return {
        ok: true as const,
        message: done ? "Setup closed. Everything stays where it is." : "Setup reopened.",
      };
    }),
  );
}

// ---------------------------------------------------------------- Polling

/**
 * What the result screen polls while the first sync runs. Read-only, in the
 * caller's own app_user transaction, so RLS bounds every count to the org
 * and a member gets nothing.
 */
export async function syncProgressAction(orgId: string): Promise<SyncProgressView | null> {
  try {
    idSchema.parse(orgId);
    return await withOrgTx(orgId, async (ctx) => {
      if (!ctx.role || (ctx.role !== "OWNER" && ctx.role !== "ADMIN")) return null;
      const counts = await loadDataCounts(ctx.db, orgId);
      const sync = await loadSyncStatus(ctx.db, orgId);
      const pending = await syncPending(ctx.db, orgId);
      const times = (sync?.streams ?? [])
        .map((s) => s.lastSyncedAt)
        .filter((d): d is Date => d instanceof Date);
      return {
        syncing: pending,
        counts,
        syncedAt: times.length
          ? new Date(Math.max(...times.map((d) => d.getTime()))).toISOString()
          : null,
        lastError: sync?.lastError ?? null,
        streams: (sync?.streams ?? []).map((s) => ({
          label: s.label,
          rows: s.rowsUpserted,
          lastSynced: s.lastSyncedAt ? s.lastSyncedAt.toISOString() : null,
          error: s.lastError,
        })),
      } satisfies SyncProgressView;
    });
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) return null;
    throw error;
  }
}
