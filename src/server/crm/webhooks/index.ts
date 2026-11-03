import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { withSystemOrgTx, type TxClient } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";
import { sanitize } from "@/server/jobs/sanitize";
import { PermanentJobError, type JobHandler } from "@/server/jobs/types";

import { CrmError } from "../access";
import { loadJson } from "../api/serialize";
import type { CrmEventPayload } from "../events";
import { isWebhookEvent, webhookEventsFor, type WebhookEvent } from "./events";
import { checkWebhookUrl, UnsafeUrlError, webhookTransport } from "./guard";

/**
 * Outgoing webhooks (docs/features/crm.md module 11): what makes Zapier and
 * Make work without us paying for either. An owner or admin adds a URL and
 * picks events; each event becomes one CrmWebhookDelivery row and one
 * crm-webhook job, which POSTs it, signed, with retries and backoff, and
 * records every attempt for the delivery log.
 *
 * The events come from the CRM's event bus (src/server/crm/events.ts): this
 * module registers a listener there, the same way the workflow engine
 * does. The body is JSON:
 *
 *   { "id": "<delivery id>", "event": "person.created", "createdAt": "...",
 *     "data": { ...the record as the API shows it... } }
 *
 * and the request carries
 *
 *   X-Bananasplit-Event: person.created
 *   X-Bananasplit-Delivery: <delivery id>
 *   X-Bananasplit-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">
 *
 * under the webhook's signing secret. A receiver checks the HMAC and that t
 * is recent.
 */

export { WEBHOOK_EVENTS, WEBHOOK_EVENT_LABEL, isWebhookEvent, webhookEventsFor, type WebhookEvent } from "./events";

/** A fresh signing secret. */
export function newSigningSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

/** The X-Bananasplit-Signature value for a body at a time. */
export function signWebhook(secret: string, body: string, timestampSec: number): string {
  const mac = createHmac("sha256", secret).update(`${timestampSec}.${body}`).digest("hex");
  return `t=${timestampSec},v1=${mac}`;
}

/** What a receiver does: true when the signature matches and is under five minutes old. */
export function verifyWebhookSignature(secret: string, body: string, header: string, nowSec = Math.floor(Date.now() / 1000)): boolean {
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(nowSec - t) > 300 || !parts.v1) return false;
  const expected = Buffer.from(signWebhook(secret, body, t).split("v1=")[1]!);
  const given = Buffer.from(parts.v1);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// ---- Settings (owners and admins; RLS enforces it) ------------------------------------

/** Rewrites CrmSettings.webhookEvents from the active webhooks (same transaction). */
export async function syncWebhookEvents(db: TxClient, organizationId: string): Promise<void> {
  const hooks = await db.crmWebhook.findMany({
    where: { organizationId, active: true },
    select: { events: true },
  });
  const events = [...new Set(hooks.flatMap((h) => h.events))].filter(isWebhookEvent).sort();
  await db.crmSettings.updateMany({ where: { organizationId }, data: { webhookEvents: events } });
}

function cleanEvents(events: readonly string[]): WebhookEvent[] {
  const out = [...new Set(events)].filter(isWebhookEvent);
  if (out.length === 0) throw new CrmError("Pick at least one event.");
  return out;
}

function cleanUrl(url: string): string {
  try {
    return checkWebhookUrl(url).toString();
  } catch (error) {
    if (error instanceof UnsafeUrlError) throw new CrmError(error.message);
    throw error;
  }
}

export async function createWebhook(
  db: TxClient,
  organizationId: string,
  userId: string,
  input: { url: string; events: string[] },
): Promise<{ id: string; secret: string }> {
  const count = await db.crmWebhook.count({ where: { organizationId } });
  if (count >= 20) throw new CrmError("An organization can have 20 webhooks.");
  const secret = newSigningSecret();
  const hook = await db.crmWebhook.create({
    data: {
      organizationId,
      url: cleanUrl(input.url),
      events: cleanEvents(input.events),
      signingSecret: secret,
      createdById: userId,
    },
    select: { id: true },
  });
  await syncWebhookEvents(db, organizationId);
  return { id: hook.id, secret };
}

export async function updateWebhook(
  db: TxClient,
  organizationId: string,
  id: string,
  input: { url?: string; events?: string[]; active?: boolean; rotateSecret?: boolean },
): Promise<{ secret?: string }> {
  const hook = await db.crmWebhook.findFirst({ where: { id, organizationId }, select: { id: true } });
  if (!hook) throw new CrmError("That webhook isn't here any more.");
  const secret = input.rotateSecret ? newSigningSecret() : undefined;
  await db.crmWebhook.update({
    where: { id: hook.id },
    data: {
      ...(input.url !== undefined ? { url: cleanUrl(input.url) } : {}),
      ...(input.events !== undefined ? { events: cleanEvents(input.events) } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(secret ? { signingSecret: secret } : {}),
    },
  });
  await syncWebhookEvents(db, organizationId);
  return secret ? { secret } : {};
}

export async function deleteWebhook(db: TxClient, organizationId: string, id: string): Promise<void> {
  const r = await db.crmWebhook.deleteMany({ where: { id, organizationId } });
  if (r.count === 0) throw new CrmError("That webhook isn't here any more.");
  await syncWebhookEvents(db, organizationId);
}

/**
 * Queues one delivery of `event` to `webhookId` (service path or the
 * admin's own transaction; CrmWebhookDelivery is written on the service
 * path only, so admins' test sends go through here with a system db).
 */
export async function queueDelivery(
  db: TxClient,
  organizationId: string,
  webhookId: string,
  event: string,
  data: unknown,
): Promise<string> {
  const delivery = await db.crmWebhookDelivery.create({
    data: { organizationId, webhookId, event, payload: {} as Prisma.InputJsonObject, status: "pending" },
    select: { id: true, createdAt: true },
  });
  await db.crmWebhookDelivery.update({
    where: { id: delivery.id },
    data: {
      payload: { id: delivery.id, event, createdAt: delivery.createdAt.toISOString(), data } as Prisma.InputJsonObject,
    },
  });
  await enqueueJob(db, {
    orgId: organizationId,
    kind: "crm-webhook",
    key: delivery.id,
    payload: { deliveryId: delivery.id },
  });
  return delivery.id;
}

/** "Send test": a ping to one webhook, on the service path after the admin's check. */
export async function sendTestDelivery(organizationId: string, webhookId: string, userId: string): Promise<string> {
  return withSystemOrgTx(organizationId, { userId }, async ({ db }) => {
    const hook = await db.crmWebhook.findFirst({ where: { id: webhookId, organizationId }, select: { id: true } });
    if (!hook) throw new CrmError("That webhook isn't here any more.");
    return queueDelivery(db, organizationId, hook.id, "ping", {
      message: "A test from Bananasplit. If you can read this, the webhook works.",
    });
  });
}

// ---- The listener (the CRM event bus) --------------------------------------------------

/** The data an event carries: the record (or the activity) as the API shows it. */
async function dataFor(db: TxClient, organizationId: string, event: WebhookEvent, p: CrmEventPayload) {
  if (event === "activity.logged") {
    return p.sourceId ? loadJson(db, organizationId, "activity", p.sourceId) : null;
  }
  if (event === "call.logged") {
    const call = p.sourceId
      ? await db.crmCall.findFirst({
          where: { id: p.sourceId, organizationId },
          select: {
            id: true,
            personId: true,
            userId: true,
            direction: true,
            status: true,
            provider: true,
            startedAt: true,
            durationSec: true,
            outcome: true,
            notes: true,
            summary: true,
            activityId: true,
          },
        })
      : null;
    return call ? { object: "call", ...call, startedAt: call.startedAt.toISOString() } : null;
  }
  const record = await loadJson(db, organizationId, p.targetKind, p.targetId);
  if (!record) return null;
  if (event === "person.updated") return { ...record, changed: p.fields };
  if (event === "deal.stage_changed" || event === "deal.closed") return { ...record, changed: p.fields };
  return record;
}

/** Turns one CRM event into deliveries for every active webhook that wants it. */
export async function webhookListener(organizationId: string, payload: CrmEventPayload): Promise<void> {
  const names = webhookEventsFor(payload);
  if (names.length === 0) return;
  await withSystemOrgTx(organizationId, async ({ db }) => {
    const hooks = await db.crmWebhook.findMany({
      where: { organizationId, active: true, events: { hasSome: names } },
      select: { id: true, events: true },
    });
    if (hooks.length === 0) return;
    let wanted = names;
    if (names.includes("deal.closed")) {
      const deal = await db.crmDeal.findFirst({
        where: { id: payload.targetId, organizationId },
        select: { stage: { select: { kind: true } } },
      });
      if (!deal || deal.stage.kind === "OPEN") wanted = names.filter((n) => n !== "deal.closed");
    }
    for (const event of wanted) {
      const targets = hooks.filter((h) => h.events.includes(event));
      if (targets.length === 0) continue;
      const data = await dataFor(db, organizationId, event, payload);
      if (!data) continue;
      for (const h of targets) await queueDelivery(db, organizationId, h.id, event, data);
    }
  });
}

// ---- The delivery job -----------------------------------------------------------------

const MAX_ATTEMPTS = 8;

export const crmWebhookJob: JobHandler<{ deliveryId: string }> = async (run) => {
  const orgId = run.organizationId;
  if (!orgId) throw new PermanentJobError("crm-webhook needs an organization");
  const found = await withSystemOrgTx(orgId, ({ db }) =>
    db.crmWebhookDelivery.findFirst({
      where: { id: run.payload.deliveryId, organizationId: orgId },
      include: { webhook: { select: { id: true, url: true, active: true, signingSecret: true } } },
    }),
  );
  if (!found || found.status === "delivered") return;
  const record = (status: string, code: number | null, error: string | null) =>
    withSystemOrgTx(orgId, ({ db }) =>
      db.crmWebhookDelivery.update({
        where: { id: found.id },
        data: {
          status,
          attempts: { increment: 1 },
          responseCode: code,
          lastError: error ? sanitize(error, 300) : null,
          ...(status === "delivered" ? { deliveredAt: new Date() } : {}),
        },
      }),
    );
  if (!found.webhook.active && found.event !== "ping") {
    await record("failed", null, "The webhook was switched off.");
    return;
  }
  let url: URL;
  try {
    url = checkWebhookUrl(found.webhook.url);
  } catch (error) {
    await record("failed", null, error instanceof Error ? error.message : "Not an address we send to.");
    return;
  }
  const body = JSON.stringify(found.payload);
  const t = Math.floor(Date.now() / 1000);
  let status = 0;
  let failure: string | null = null;
  try {
    const res = await webhookTransport.post(url, body, {
      "Content-Type": "application/json",
      "User-Agent": "Bananasplit-Webhooks/1",
      "X-Bananasplit-Event": found.event,
      "X-Bananasplit-Delivery": found.id,
      "X-Bananasplit-Signature": signWebhook(found.webhook.signingSecret, body, t),
    });
    status = res.status;
    if (status < 200 || status >= 300) failure = `The receiver answered ${status}.`;
  } catch (error) {
    failure = error instanceof Error ? error.message : "The receiver couldn't be reached.";
  }
  if (!failure) {
    await record("delivered", status, null);
    return;
  }
  const last = run.attempt >= Math.min(run.maxAttempts, MAX_ATTEMPTS);
  // A 4xx other than 408/429 means the receiver won't take it: stop trying.
  const permanent = status >= 400 && status < 500 && status !== 408 && status !== 429;
  await record(last || permanent ? "failed" : "retrying", status || null, failure);
  if (permanent) throw new PermanentJobError(failure);
  if (!last) throw new Error(failure);
};
