import type { CrmEventPayload } from "../events";

/**
 * The outgoing webhooks' events (src/server/crm/webhooks), kept apart and
 * free of imports so the event bus (src/server/crm/events.ts) can ask
 * whether an event could interest a webhook without loading the rest.
 */

export const WEBHOOK_EVENTS = [
  "person.created",
  "person.updated",
  "company.created",
  "deal.created",
  "deal.stage_changed",
  "deal.closed",
  "activity.logged",
  "call.logged",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_EVENT_LABEL: Record<WebhookEvent, string> = {
  "person.created": "A person is added",
  "person.updated": "A person changes",
  "company.created": "A company is added",
  "deal.created": "An item is added",
  "deal.stage_changed": "An item moves stage",
  "deal.closed": "An item is won or lost",
  "activity.logged": "Something lands on a timeline",
  "call.logged": "A call is logged",
};

export function isWebhookEvent(v: unknown): v is WebhookEvent {
  return typeof v === "string" && (WEBHOOK_EVENTS as readonly string[]).includes(v);
}

/**
 * The webhook events a CRM event could be (no database). deal.closed is a
 * candidate on any stage move; the listener keeps it only when the new
 * stage is a won or lost one.
 */
export function webhookEventsFor(e: Pick<CrmEventPayload, "type" | "targetKind" | "fields">): WebhookEvent[] {
  if (e.type === "call.logged") return ["call.logged"];
  if (e.type === "activity.logged") return ["activity.logged"];
  if (e.type !== "record.changed") return [];
  const created = e.fields.includes("created");
  if (e.targetKind === "person") return created ? ["person.created"] : ["person.updated"];
  if (e.targetKind === "company") return created ? ["company.created"] : [];
  if (created) return ["deal.created"];
  return e.fields.includes("stageId") ? ["deal.stage_changed", "deal.closed"] : [];
}
