import type { TxClient } from "@/server/db/context";

import type { RoleOwner } from "../owners";
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
    const path = i.targetKind === "company" ? "companies" : "people";
    return {
      key: i.key,
      id: i.id,
      title: i.name,
      meta: i.reasons.map((r) => r.label).join(", "),
      href: `/app/${orgSlug}/crm/${path}/${i.id}`,
      urgent: i.urgent,
      group: first.kind === "reply" || first.kind === "step" || i.urgent ? "overdue" : first.kind === "followup" ? "today" : "review",
    };
  });
}
