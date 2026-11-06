import { crmApprovalsHref, crmRecordHref, crmTodayHref } from "@/lib/crm/href";
import { hrefWithOpen } from "@/lib/crm/overlay";
import { formatNumber, phoneKey } from "@/lib/crm/phone";
import type { TxClient } from "@/server/db/context";

import type { RoleOwner } from "../owners";
import { REVIEW_WHERE } from "../review";
import { followUpQueue } from "./queue";

/**
 * The member's follow-up queue as Inbox rows (kind "crm", key "crm:{id}",
 * the same key the CRM home snoozes): replies and sequence steps first,
 * then follow-ups and new people, then texts from numbers that aren't in
 * the CRM (key "crm:text-{id}", one row per number, opening the text's card
 * with Add them to the CRM). Only the CRM add-on's organizations.
 */
export interface CrmInboxItem {
  key: string;
  id: string;
  title: string;
  meta: string;
  href: string;
  urgent: boolean;
  group: "overdue" | "today" | "review";
}

export async function crmInboxItems(
  db: TxClient,
  organizationId: string,
  userId: string,
  orgSlug: string,
  roles: ReadonlyMap<string, RoleOwner>,
  now: Date = new Date(),
): Promise<CrmInboxItem[]> {
  const crm = await db.crmSettings.findUnique({ where: { organizationId }, select: { setupDoneAt: true } });
  if (!crm?.setupDoneAt) return [];
  // Cold people and cadences stay on the CRM's home; the Inbox gets what needs you now.
  const items = (await followUpQueue(db, organizationId, userId, roles, { mine: true, limit: 40, now }))
    .map((i) => ({ ...i, reasons: i.reasons.filter((r) => r.kind !== "cold" && r.kind !== "cadence") }))
    .filter((i) => i.reasons.length > 0)
    .slice(0, 20);
  const rows: CrmInboxItem[] = items.map((i) => {
    const first = i.reasons[0]!;
    return {
      key: i.key,
      id: i.id,
      title: i.name,
      meta: i.reasons.map((r) => r.label).join(", "),
      href: crmRecordHref(orgSlug, i.targetKind === "company" ? "company" : "person", i.id),
      urgent: i.urgent,
      group: first.kind === "reply" || first.kind === "step" || i.urgent ? "overdue" : first.kind === "followup" ? "today" : "review",
    };
  });
  return [...rows, ...(await looseTexts(db, organizationId, orgSlug, now))];
}

const TEXT_DAYS = 30;

/**
 * Texts from numbers that aren't in the CRM, in the last month: one row per
 * number (its latest text, and how many came in), for whoever can see them.
 * Adding the person takes the texts onto their timeline, and the row goes.
 */
async function looseTexts(db: TxClient, organizationId: string, orgSlug: string, now: Date): Promise<CrmInboxItem[]> {
  const texts = await db.crmTextMessage.findMany({
    where: {
      organizationId,
      direction: "INBOUND",
      personId: null,
      sentAt: { gte: new Date(now.getTime() - TEXT_DAYS * 86_400_000) },
    },
    orderBy: { sentAt: "desc" },
    take: 50,
    select: { id: true, fromNumber: true, body: true },
  });
  const byNumber = new Map<string, { id: string; fromNumber: string; body: string; count: number }>();
  for (const t of texts) {
    const key = phoneKey(t.fromNumber) ?? t.fromNumber;
    const seen = byNumber.get(key);
    if (seen) seen.count++;
    else if (byNumber.size < 5) byNumber.set(key, { ...t, count: 1 });
  }
  return [...byNumber.values()].map((t) => {
    const words = t.body.replace(/\s+/g, " ").trim();
    const said = words.length > 80 ? `${words.slice(0, 79)}…` : words;
    return {
      key: `crm:text-${t.id}`,
      id: `text-${t.id}`,
      title: `A text from ${formatNumber(t.fromNumber)}`,
      meta: `${t.count > 1 ? `${t.count} texts, not in the CRM yet` : "Not in the CRM yet"}: "${said}"`,
      href: hrefWithOpen(crmTodayHref(orgSlug), "", { kind: "text", id: t.id }),
      urgent: false,
      group: "today",
    };
  });
}

/**
 * The CRM's Review suggestions assigned to this member (an AI draft, an
 * automation's email to look over, someone new from their mail), as one
 * Inbox row with the count, key "crm:review" (snoozed like any other row).
 * Signals are their own rows; null when nothing waits.
 */
export async function crmReviewRow(
  db: TxClient,
  organizationId: string,
  userId: string,
  orgSlug: string,
): Promise<CrmInboxItem | null> {
  const n = await db.crmSuggestion.count({
    where: { organizationId, ...REVIEW_WHERE, status: "PENDING", assigneeId: userId },
  });
  if (n === 0) return null;
  return {
    key: "crm:review",
    id: "review",
    title: n === 1 ? "1 thing to approve in the CRM" : `${n} things to approve in the CRM`,
    meta: "Drafts, changes and new people waiting for your OK",
    href: crmApprovalsHref(orgSlug),
    urgent: false,
    group: "review",
  };
}
