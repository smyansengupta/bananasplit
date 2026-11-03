import type { TxClient } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";
import { PermanentJobError, type JobHandler } from "@/server/jobs/types";

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
  | "call.logged";

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

/** Sources whose changes never fire workflows. */
const QUIET_SOURCES = new Set(["import", "merge"]);

export async function emitCrmEvent(db: TxClient, organizationId: string, event: CrmEvent): Promise<void> {
  if (event.source && QUIET_SOURCES.has(event.source)) return;
  const on = await db.crmWorkflow.count({ where: { organizationId, status: "ON" } });
  if (on === 0) return;
  const stamp = Date.now().toString(36);
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
    },
  });
}

export type CrmEventPayload = {
  type: CrmEventType;
  targetKind: CrmEvent["targetKind"];
  targetId: string;
  fields: string[];
  userId: string | null;
  sourceId: string | null;
  source: string | null;
};

/** Listeners other modules register (workflows). Each gets the event in the job's organization. */
type Listener = (organizationId: string, event: CrmEventPayload) => Promise<void>;
const listeners: (() => Promise<Listener>)[] = [];

/** Registers a lazily loaded listener (keeps this module free of their imports). */
export function onCrmEvent(load: () => Promise<Listener>): void {
  listeners.push(load);
}

export const crmEventJob: JobHandler<CrmEventPayload> = async (run) => {
  const orgId = run.organizationId;
  if (!orgId) throw new PermanentJobError("crm-event needs an organization");
  for (const load of listeners) {
    const listener = await load();
    await listener(orgId, run.payload);
  }
};
