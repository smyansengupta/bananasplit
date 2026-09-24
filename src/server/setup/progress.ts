import { IntegrationStatus, type IntegrationProvider } from "@/generated/prisma/client";
import { writeOrgAuditLog } from "@/server/audit";
import type { TxClient } from "@/server/db/context";
import { providerInfo } from "@/server/integrations/catalog";

import {
  SETUP_STEPS,
  isSetupStepId,
  stepIdForProvider,
  type SetupStepDefinition,
  type SetupStepId,
} from "./catalog";

/**
 * Where an org stands in the guided setup.
 *
 * Progress is DERIVED on every read from the org's OrgIntegration rows, so
 * the flow can never claim a service is connected when its last test failed
 * or its secret was removed. The only stored state is the pair of human
 * choices on OrgSettings: which steps were skipped, and whether someone
 * pressed Finish (see 20260924190000_c1_setup_state).
 *
 * Every read runs on the caller's app_user transaction: OrgIntegration is
 * OWNER/ADMIN-only under RLS, so a member's transaction sees no rows and
 * gets a flow with nothing in it. The pages also check integrations.view.
 */

export type SetupStepStatus =
  /** Tested and working. */
  | "connected"
  /** A credential is stored; its last test failed. */
  | "error"
  /** Google revoked or expired the grant. */
  | "needs_reauth"
  /** Saved but never proved. Only reachable by removing a test result. */
  | "untested"
  /** The org said "not now". */
  | "skipped"
  /** Nothing stored, nothing decided. */
  | "todo";

/** The statuses that mean "this service works right now". */
export function isWorking(status: SetupStepStatus): boolean {
  return status === "connected";
}

/** The statuses that need a human before the service works again. */
export function needsAttention(status: SetupStepStatus): boolean {
  return status === "error" || status === "needs_reauth";
}

export interface SetupStepState {
  step: SetupStepDefinition;
  status: SetupStepStatus;
  hasSecret: boolean;
  /** For recognition only; null for a credential under 16 characters. */
  last4: string | null;
  lastVerifiedAt: Date | null;
  /** Already sanitized where it was written. */
  lastError: string | null;
  /** Whitelisted, non-secret config (catalog.configKeys). */
  config: Record<string, unknown>;
  connectedByName: string | null;
}

export interface SetupState {
  steps: SetupStepState[];
  connectedCount: number;
  totalCount: number;
  /** Neither connected nor skipped. */
  todo: SetupStepId[];
  /** Broken now: error or needs-reauth. */
  attention: SetupStepId[];
  skipped: SetupStepId[];
  completedAt: Date | null;
  /** The step the flow opens on: the first thing still worth doing. */
  nextStep: SetupStepId | null;
  /** Every step is either connected or explicitly skipped. */
  allDecided: boolean;
  /** Whether the overview should still be nagging about setup. */
  promptVisible: boolean;
}

interface IntegrationRow {
  provider: IntegrationProvider;
  status: IntegrationStatus;
  secretFingerprint: string | null;
  secretLast4: string | null;
  lastVerifiedAt: Date | null;
  lastError: string | null;
  config: unknown;
  connectedBy: { name: string | null } | null;
}

function statusOf(row: IntegrationRow | undefined, skipped: boolean): SetupStepStatus {
  if (!row || !row.secretFingerprint) return skipped ? "skipped" : "todo";
  switch (row.status) {
    case IntegrationStatus.CONNECTED:
      return "connected";
    case IntegrationStatus.ERROR:
      return "error";
    case IntegrationStatus.NEEDS_REAUTH:
      return "needs_reauth";
    case IntegrationStatus.DISCONNECTED:
      // A stored credential that was never proved, or was disconnected on
      // purpose. Skipping is the louder statement, so it wins.
      return skipped ? "skipped" : "untested";
  }
}

/** Only the config keys the provider whitelists ever leave the server. */
function safeConfig(provider: IntegrationProvider, raw: unknown): Record<string, unknown> {
  const allowed = providerInfo(provider).configKeys;
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const key of allowed) if (key in obj) out[key] = obj[key];
  return out;
}

/** Reads the whole flow's state in the caller's transaction. */
export async function loadSetupState(db: TxClient, organizationId: string): Promise<SetupState> {
  const [rows, settings] = [
    await db.orgIntegration.findMany({
      where: { organizationId },
      select: {
        provider: true,
        status: true,
        secretFingerprint: true,
        secretLast4: true,
        lastVerifiedAt: true,
        lastError: true,
        config: true,
        connectedBy: { select: { name: true } },
      },
    }),
    await db.orgSettings.findUnique({
      where: { organizationId },
      select: { setupSkipped: true, setupCompletedAt: true },
    }),
  ];

  const byProvider = new Map(rows.map((r) => [r.provider, r as IntegrationRow]));
  const skipped = new Set((settings?.setupSkipped ?? []).filter(isSetupStepId));

  const steps: SetupStepState[] = SETUP_STEPS.map((step) => {
    const row = byProvider.get(step.provider);
    const status = statusOf(row, skipped.has(step.id));
    return {
      step,
      status,
      hasSecret: Boolean(row?.secretFingerprint),
      last4: row?.secretLast4 ?? null,
      lastVerifiedAt: row?.lastVerifiedAt ?? null,
      lastError: row?.lastError ?? null,
      config: safeConfig(step.provider, row?.config),
      connectedByName: row?.connectedBy?.name ?? null,
    };
  });

  const todo = steps
    .filter((s) => s.status === "todo" || s.status === "untested")
    .map((s) => s.step.id);
  const attention = steps.filter((s) => needsAttention(s.status)).map((s) => s.step.id);
  const connectedCount = steps.filter((s) => isWorking(s.status)).length;
  const skippedIds = steps.filter((s) => s.status === "skipped").map((s) => s.step.id);
  const allDecided = todo.length === 0 && attention.length === 0;

  return {
    steps,
    connectedCount,
    totalCount: steps.length,
    todo,
    attention,
    skipped: skippedIds,
    completedAt: settings?.setupCompletedAt ?? null,
    // Broken things come before untouched ones: a club whose sync has been
    // failing for a week should be sent there, not to the next new toy.
    nextStep: attention[0] ?? todo[0] ?? null,
    allDecided,
    promptVisible: !settings?.setupCompletedAt && !allDecided,
  };
}

/**
 * Records "not now" for a step. ADMIN+ (the caller's transaction already
 * checked the permission; OrgSettings UPDATE is OWNER/ADMIN under RLS too).
 */
export async function skipStep(
  db: TxClient,
  organizationId: string,
  userId: string,
  id: SetupStepId,
): Promise<void> {
  const current = await db.orgSettings.findUnique({
    where: { organizationId },
    select: { setupSkipped: true },
  });
  const next = [...new Set([...(current?.setupSkipped ?? []).filter(isSetupStepId), id])];
  await db.orgSettings.update({
    where: { organizationId },
    data: { setupSkipped: next, updatedById: userId },
  });
  await writeOrgAuditLog(db, {
    organizationId,
    action: "setup.step_skipped",
    targetType: "OrgSettings",
    targetId: organizationId,
    diff: { step: id },
  });
}

/** Takes a step off the skipped list, so the flow offers it again. */
export async function unskipStep(
  db: TxClient,
  organizationId: string,
  userId: string,
  id: SetupStepId,
): Promise<void> {
  const current = await db.orgSettings.findUnique({
    where: { organizationId },
    select: { setupSkipped: true },
  });
  const before = (current?.setupSkipped ?? []).filter(isSetupStepId);
  if (!before.includes(id)) return;
  await db.orgSettings.update({
    where: { organizationId },
    data: { setupSkipped: before.filter((s) => s !== id), updatedById: userId },
  });
}

/**
 * Clears the skip for whichever step just connected, so a service the club
 * passed over and later connected stops being listed as skipped. Called
 * from the service path after a successful save (no user transaction open).
 */
export async function clearSkipForProvider(
  db: TxClient,
  organizationId: string,
  provider: IntegrationProvider,
): Promise<void> {
  const id = stepIdForProvider(provider);
  if (!id) return;
  const current = await db.orgSettings.findUnique({
    where: { organizationId },
    select: { setupSkipped: true },
  });
  const before = (current?.setupSkipped ?? []).filter(isSetupStepId);
  if (!before.includes(id)) return;
  await db.orgSettings.update({
    where: { organizationId },
    data: { setupSkipped: before.filter((s) => s !== id) },
  });
}

/** Finish (or dismiss). Only hides the prompt; the flow stays reachable. */
export async function setSetupCompleted(
  db: TxClient,
  organizationId: string,
  userId: string,
  completed: boolean,
): Promise<void> {
  await db.orgSettings.update({
    where: { organizationId },
    data: { setupCompletedAt: completed ? new Date() : null, updatedById: userId },
  });
  await writeOrgAuditLog(db, {
    organizationId,
    action: completed ? "setup.completed" : "setup.reopened",
    targetType: "OrgSettings",
    targetId: organizationId,
    diff: {},
  });
}
