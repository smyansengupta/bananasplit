import { AsyncLocalStorage } from "node:async_hooks";

import type { TxClient } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";
import { PermanentJobError, type JobHandler } from "@/server/jobs/types";

import { webhookEventsFor } from "./webhooks/events";

/**
 * CRM events: what automations (workflows, docs/features/crm.md module 6)
 * react to. Every change to a person, company or item already passes through
 * writeHistory, which emits `record.changed` here; outreach emits the rest
 * (an email replied to, a meeting booked, a form answered). An event becomes
 * a `crm-event` job only when the organization has a workflow switched on,
 * so a CRM without automations pays one indexed count per change and no
 * jobs. Imports and merges don't fire workflows (a 5,000-row import is not
 * 5,000 "person added" events). Payloads are ids and field names only.
 */

export type CrmEventType =
  | "record.changed"
  | "email.replied"
  | "email.bounced"
  | "meeting.booked"
  | "form.submitted"
  | "sequence.finished"
  | "call.logged"
  | "activity.logged";

export interface CrmEvent {
  type: CrmEventType;
  targetKind: "person" | "company" | "deal";
  targetId: string;
  /** record.changed: the fields that changed ("created" when it's new, "stageId" on a move). */
  fields?: string[];
  /** Who made the change, when a member did. */
  userId?: string | null;
  /** The thing that set it off (an email message, a form response, an event). */
  sourceId?: string;
  /** user | ai | automation | connector | system ... (automation changes don't re-fire their own workflow). */
  source?: string;
}

/**
 * The automation whose step is running now (src/server/crm/workflow-engine.ts
 * sets it around each step), so the changes a step makes carry its workflow
 * id and depth: that workflow never fires on its own change, and a chain of
 * automations stops (MAX_CHAIN_DEPTH in src/lib/crm/workflows.ts).
 */
const automationScope = new AsyncLocalStorage<{ workflowId: string; depth: number }>();

export function withAutomationScope<T>(scope: { workflowId: string; depth: number }, fn: () => Promise<T>): Promise<T> {
  return automationScope.run(scope, fn);
}

/** Sources whose changes never fire workflows. */
const QUIET_SOURCES = new Set(["import", "merge"]);

export async function emitCrmEvent(db: TxClient, organizationId: string, event: CrmEvent): Promise<void> {
  if (event.source && QUIET_SOURCES.has(event.source)) return;
  // A switched-on workflow (CrmSettings.workflowTriggers, kept by the
  // workflow settings: members can't read CrmWorkflow), or an active
  // outgoing webhook that listens for what this could be (webhookEvents).
  const s = await db.crmSettings.findUnique({
    where: { organizationId },
    select: { workflowTriggers: true, webhookEvents: true },
  });
  if (!s) return;
  if (s.workflowTriggers.length === 0 && !webhookWants(s.webhookEvents, event)) return;
  const stamp = Date.now().toString(36);
  const scope = automationScope.getStore();
  await enqueueJob(db, {
    orgId: organizationId,
    kind: "crm-event",
    key: `${event.type}:${event.targetKind}:${event.targetId}:${stamp}:${event.sourceId ?? ""}`,
    payload: {
      type: event.type,
      targetKind: event.targetKind,
      targetId: event.targetId,
      fields: event.fields ?? [],
      userId: event.userId ?? null,
      sourceId: event.sourceId ?? null,
      source: event.source ?? null,
      ...(scope ? { workflowId: scope.workflowId, depth: scope.depth } : {}),
    },
  });
}

function webhookWants(listening: readonly string[], event: CrmEvent): boolean {
  if (listening.length === 0) return false;
  const names = webhookEventsFor({ type: event.type, targetKind: event.targetKind, fields: event.fields ?? [] });
  return names.some((n) => listening.includes(n));
}

export type CrmEventPayload = {
  type: CrmEventType;
  targetKind: CrmEvent["targetKind"];
  targetId: string;
  fields: string[];
  userId: string | null;
  sourceId: string | null;
  source: string | null;
  /** The workflow whose step made this change (it never fires on it again). */
  workflowId?: string;
  /** How many automations deep the change is. */
  depth?: number;
};

/** Listeners other modules register. Each gets the event in the job's organization, and the job's key. */
type Listener = (organizationId: string, event: CrmEventPayload, meta: { jobKey: string }) => Promise<void>;
const listeners: (() => Promise<Listener>)[] = [];

/** Registers a lazily loaded listener (keeps this module free of their imports). */
export function onCrmEvent(load: () => Promise<Listener>): void {
  listeners.push(load);
}

// Outgoing webhooks (Phase 5, src/server/crm/webhooks).
onCrmEvent(() => import("./webhooks").then((m) => m.webhookListener));

export const crmEventJob: JobHandler<CrmEventPayload> = async (run) => {
  const orgId = run.organizationId;
  if (!orgId) throw new PermanentJobError("crm-event needs an organization");
  // The workflows, imported here so they run wherever jobs run.
  const engine = await import("./workflow-engine");
  await engine.handleCrmEvent(orgId, run.payload, { jobKey: run.dedupeKey });
  for (const load of listeners) {
    const listener = await load();
    await listener(orgId, run.payload, { jobKey: run.dedupeKey });
  }
};
