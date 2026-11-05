import "server-only";

import { cache } from "react";

import type { SendingHealth } from "@/lib/crm/settings-prefs";
import { withOrgTx } from "@/server/db/context";

import { checkSender, type SenderCheck } from "./outreach/mailbox";
import { underCap } from "./spend";

/**
 * Whether the CRM's sending is healthy (CRM settings > Automations and sending, and the
 * "Sending is paused" banner): the organization's sender, the spending
 * cap, last week's bounces, and the sends that didn't go. Call outside a
 * transaction (the sender check and the cap open their own).
 */

const WEEK = 7 * 86_400_000;
const FAILED_SINCE = 14 * 86_400_000;

export interface FailedSend {
  id: string;
  channel: "email" | "text";
  personId: string | null;
  name: string;
  /** What didn't go, in words. */
  what: string;
  /** Bounced (the address is bad) or failed (we couldn't send). */
  bounced: boolean;
  at: string;
}

/** Once per request: Today starts it early and its banner reads the same answer. */
export const loadSendingHealth = cache(async (
  organizationId: string,
): Promise<{ health: SendingHealth; sender: SenderCheck }> => {
  const since = new Date(Date.now() - WEEK);
  const group = {
    OR: [
      { campaignId: { not: null } },
      { enrollmentId: { not: null } },
      { workflowId: { not: null } },
    ],
  };
  const [sender, room, byStatus] = await Promise.all([
    checkSender(organizationId).catch((): SenderCheck => ({
      ok: false,
      from: null,
      domain: null,
      problem: "We couldn't check your sender just now.",
    })),
    underCap(organizationId).catch(() => true),
    withOrgTx(organizationId, ({ db }) =>
      db.crmEmailMessage.groupBy({
        by: ["status"],
        where: {
          organizationId,
          direction: "OUTBOUND",
          status: { in: ["SENT", "BOUNCED"] },
          sentAt: { gte: since },
          ...group,
        },
        _count: { _all: true },
      }),
    ),
  ]);
  const bounced = byStatus.find((s) => s.status === "BOUNCED")?._count._all ?? 0;
  const counts = { sent: byStatus.reduce((n, s) => n + s._count._all, 0), bounced };
  return {
    sender,
    health: {
      senderOk: sender.ok,
      senderAddress: sender.from ? (sender.from.match(/<([^>]+)>/)?.[1] ?? sender.from) : null,
      capReached: !room,
      sentLastWeek: counts.sent,
      bouncedLastWeek: counts.bounced,
    },
  };
});

/** Email and texts from the last two weeks that bounced or didn't go, newest first (as the viewer sees them). */
export async function failedSends(organizationId: string, take = 12): Promise<FailedSend[]> {
  const since = new Date(Date.now() - FAILED_SINCE);
  return withOrgTx(organizationId, async ({ db }) => {
    const mail = await db.crmEmailMessage.findMany({
      where: {
        organizationId,
        direction: "OUTBOUND",
        status: { in: ["FAILED", "BOUNCED"] },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        personId: true,
        subject: true,
        status: true,
        error: true,
        toAddresses: true,
        sentAt: true,
        createdAt: true,
        bouncedAt: true,
      },
    });
    const texts = await db.crmTextMessage.findMany({
      where: {
        organizationId,
        direction: "OUTBOUND",
        status: { in: ["failed", "undelivered"] },
        sentAt: { gte: since },
      },
      orderBy: { sentAt: "desc" },
      take,
      select: { id: true, personId: true, toNumber: true, sentAt: true },
    });
    const ids = [
      ...new Set([...mail, ...texts].map((m) => m.personId).filter((x): x is string => Boolean(x))),
    ];
    const people = ids.length
      ? await db.crmPerson.findMany({
          where: { organizationId, id: { in: ids } },
          select: { id: true, name: true },
        })
      : [];
    const nameOf = (id: string | null, fallback: string) =>
      people.find((p) => p.id === id)?.name ?? fallback;
    const out: FailedSend[] = [
      ...mail.map((m) => {
        const bounced = m.status === "BOUNCED";
        const subject = m.subject?.trim() ? `"${m.subject.trim()}"` : "Your email";
        return {
          id: m.id,
          channel: "email" as const,
          personId: m.personId,
          name: nameOf(m.personId, m.toAddresses[0] ?? "Someone"),
          what: bounced
            ? `${subject} bounced: ${m.toAddresses[0] ?? "the address"} doesn't take mail`
            : `${subject} didn't go${m.error && m.error !== "untracked" ? `: ${m.error}` : ""}`,
          bounced,
          at: (m.bouncedAt ?? m.sentAt ?? m.createdAt).toISOString(),
        };
      }),
      ...texts.map((t) => ({
        id: t.id,
        channel: "text" as const,
        personId: t.personId,
        name: nameOf(t.personId, t.toNumber),
        what: `The text to ${t.toNumber} didn't go`,
        bounced: false,
        at: t.sentAt.toISOString(),
      })),
    ];
    return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, take);
  });
}
