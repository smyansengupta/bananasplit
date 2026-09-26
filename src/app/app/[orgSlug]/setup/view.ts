import type { SetupStepId } from "@/server/setup/catalog";
import type { SetupStepStatus } from "@/server/setup/progress";

/**
 * The serializable shapes the setup pages hand their client components.
 *
 * Nothing here ever carries a secret: a credential reaches the client as
 * `hasSecret` plus `last4` and nothing else, exactly as Settings does. The
 * step's copy is not in the DTO either — the panels read it from
 * @/server/setup/catalog, which is pure data and client-safe.
 */

export interface SetupStepView {
  id: SetupStepId;
  status: SetupStepStatus;
  hasSecret: boolean;
  last4: string | null;
  /** ISO, formatted on the client in the org's timezone. */
  lastVerifiedAt: string | null;
  lastError: string | null;
  /** Whitelisted, non-secret provider config. */
  config: Record<string, unknown>;
  connectedByName: string | null;
}

export interface SetupProgressView {
  steps: SetupStepView[];
  connectedCount: number;
  totalCount: number;
  attention: SetupStepId[];
  completedAt: string | null;
  nextStep: SetupStepId | null;
  allDecided: boolean;
}

export interface DataCountsView {
  checkIns: number;
  signups: number;
  sessions: number;
  people: number;
  ballots: number;
}

export interface DatabaseLinksView {
  sessions: string | null;
  attendance: string | null;
  signups: string | null;
  ballots: string | null;
  people: string | null;
}

/** What the result screen polls for while the first sync runs. */
export interface SyncProgressView {
  syncing: boolean;
  counts: DataCountsView;
  syncedAt: string | null;
  /** Sanitized where it was written. */
  lastError: string | null;
  streams: { label: string; rows: number; lastSynced: string | null; error: string | null }[];
}
