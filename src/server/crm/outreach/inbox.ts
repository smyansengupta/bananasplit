import { crmRecordHref } from "@/lib/crm/href";
import type { TxClient } from "@/server/db/context";

import type { RoleOwner } from "../owners";
import { REVIEW_WHERE } from "../review";
import { followUpQueue } from "./queue";

/**
 * The member's follow-up queue as Inbox rows (kind "crm", key "crm:{id}",
 * the same key the CRM home snoozes): replies and sequence steps first,
 * then follow-ups and new people. Only the CRM add-on's organizations.
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
  return items.map((i) => {
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
    href: `/app/${orgSlug}/crm?show=approve`,
    urgent: false,
    group: "review",
  };
}
