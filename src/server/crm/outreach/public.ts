import type { Prisma } from "@/generated/prisma/client";
import { withSystemOrgTx, type TxClient } from "@/server/db/context";

import { logActivity } from "../activity";
import { stopEnrollments } from "./inbound";
import { readUnsubscribeToken, sha256, TOKEN_RE } from "./tokens";

/**
 * The CRM's public side, found without an organization context: which
 * organization (and row) a link opens, through app.crm_public_target, and
 * the two things a recipient can do without signing in, which Bananasplit
 * records on their behalf: open or click an email (tracking) and
 * unsubscribe. Every caller rate-limits first; each then acts in that one
 * organization's context.
 */

export type PublicKind = "booking" | "booking-guest" | "self" | "bcc" | "track";

export interface PublicTarget {
  organizationId: string;
  id: string;
}

/** Which organization and row a public key opens (null when none is live). */
export async function publicTarget(kind: PublicKind, key: string): Promise<PublicTarget | null> {
  if (!key || key.length > 128) return null;
  return withSystemOrgTx(null, async ({ db }) => {
    const rows = await db.$queryRaw<PublicTarget[]>`
      SELECT "organizationId", "id" FROM app.crm_public_target(${kind}, ${key})`;
    return rows[0] ?? null;
  });
}

/** A self-update token, looked up by its hash. */
export async function tokenTarget(kind: "self", token: string): Promise<PublicTarget | null> {
  if (!TOKEN_RE.test(token)) return null;
  return publicTarget(kind, sha256(token));
}

// ---- Opens and clicks -----------------------------------------------------------

/**
 * An open (the pixel loaded) or a click. Opens are approximate (Apple Mail
 * and others load every pixel), so the CRM shows them as such and leads
 * with replies, clicks and bookings.
 */
export async function recordTracking(token: string, kind: "open" | "click", url?: string): Promise<boolean> {
  if (!/^[a-f0-9]{24}$/.test(token)) return false;
  const target = await publicTarget("track", token);
  if (!target) return false;
  await withSystemOrgTx(target.organizationId, async ({ db }) => {
    const m = await db.crmEmailMessage.findFirst({
      where: { id: target.id, organizationId: target.organizationId, direction: "OUTBOUND" },
      select: { id: true, status: true, firstOpenedAt: true, clickCount: true, activityId: true, subject: true, campaignId: true },
    });
    if (!m || m.status !== "SENT") return;
    if (kind === "open") {
      await db.crmEmailMessage.update({
        where: { id: m.id },
        data: { openCount: { increment: 1 }, ...(m.firstOpenedAt ? {} : { firstOpenedAt: new Date() }) },
      });
      return;
    }
    await db.crmEmailMessage.update({
      where: { id: m.id },
      data: { clickCount: { increment: 1 }, ...(m.firstOpenedAt ? {} : { firstOpenedAt: new Date() }) },
    });
    // The first click is worth a line on their timeline.
    if (m.clickCount === 0 && m.activityId) {
      const person = await db.crmActivityTarget.findFirst({
        where: { organizationId: target.organizationId, activityId: m.activityId, targetKind: "person" },
        select: { targetId: true },
      });
      if (person) {
        let host = "a link";
        try {
          host = url ? new URL(url).hostname : host;
        } catch {
          /* keep "a link" */
        }
        await logActivity(db, {
          organizationId: target.organizationId,
          kind: "SYSTEM",
          subject: `Clicked ${host} in "${m.subject ?? "an email"}"`,
          targets: [{ kind: "person", id: person.targetId }],
          sourceKind: "crm-click",
          sourceId: m.id,
          meta: { messageId: m.id },
        });
      }
    }
  });
  return true;
}

// ---- Unsubscribe ------------------------------------------------------------------

export interface UnsubscribeView {
  orgName: string;
  firstName: string | null;
  unsubscribed: boolean;
}

export async function unsubscribeView(token: string): Promise<UnsubscribeView | null> {
  const t = readUnsubscribeToken(token);
  if (!t) return null;
  return withSystemOrgTx(t.organizationId, async ({ db }) => {
    const p = await db.crmPerson.findFirst({
      where: { id: t.personId, organizationId: t.organizationId },
      select: { firstName: true, name: true, unsubscribedAt: true },
    });
    if (!p) return null;
    const org = await db.organization.findUnique({ where: { id: t.organizationId }, select: { name: true } });
    return { orgName: org?.name ?? "", firstName: p.firstName ?? p.name.split(" ")[0] ?? null, unsubscribed: Boolean(p.unsubscribedAt) };
  });
}

async function setSubscribed(db: TxClient, organizationId: string, personId: string, subscribed: boolean): Promise<void> {
  const p = await db.crmPerson.findFirst({
    where: { id: personId, organizationId },
    select: { consent: true, unsubscribedAt: true },
  });
  if (!p) return;
  if (!subscribed && p.unsubscribedAt) return;
  if (subscribed && !p.unsubscribedAt) return;
  const consent = { ...((p.consent ?? {}) as Record<string, unknown>) };
  consent.email = {
    ...((consent.email ?? {}) as Record<string, unknown>),
    granted: subscribed,
    at: new Date().toISOString(),
    how: subscribed ? "resubscribed from the unsubscribe page" : "unsubscribe link",
  };
  await db.crmPerson.update({
    where: { id: personId },
    data: { unsubscribedAt: subscribed ? null : new Date(), consent: consent as Prisma.InputJsonObject },
  });
  await db.crmFieldHistory.create({
    data: {
      organizationId,
      targetKind: "person",
      targetId: personId,
      field: "unsubscribedAt",
      oldValue: p.unsubscribedAt ? p.unsubscribedAt.toISOString() : undefined,
      newValue: subscribed ? undefined : new Date().toISOString(),
      source: "system",
    },
  });
  await logActivity(db, {
    organizationId,
    kind: "SYSTEM",
    subject: subscribed ? "Subscribed to email again" : "Unsubscribed from email",
    targets: [{ kind: "person", id: personId }],
  });
  if (!subscribed) {
    await stopEnrollments(db, organizationId, personId, "UNSUBSCRIBED", "they unsubscribed");
    await db.crmEmailMessage.updateMany({
      where: {
        organizationId,
        status: "QUEUED",
        activityId: {
          in: (
            await db.crmActivityTarget.findMany({
              where: { organizationId, targetKind: "person", targetId: personId },
              select: { activityId: true },
              take: 2000,
            })
          ).map((a) => a.activityId),
        },
      },
      data: { status: "FAILED", error: "they unsubscribed" },
    });
    await db.crmCampaignTarget.updateMany({
      where: { organizationId, personId, status: "TODO" },
      data: { status: "SKIPPED" },
    });
  }
}

/** Unsubscribes (or resubscribes) the person a signed link names. */
export async function applyUnsubscribe(token: string, subscribed = false): Promise<boolean> {
  const t = readUnsubscribeToken(token);
  if (!t) return false;
  await withSystemOrgTx(t.organizationId, ({ db }) => setSubscribed(db, t.organizationId, t.personId, subscribed));
  return true;
}
