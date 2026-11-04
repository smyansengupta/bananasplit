import type { TxClient } from "@/server/db/context";

import type { QueueItem } from "./queue";

/**
 * Shapes the outreach pages hand their client parts: plain values, no
 * Dates, nothing a member may not see.
 */

export async function composeTemplates(db: TxClient, organizationId: string) {
  const rows = await db.crmTemplate.findMany({
    where: { organizationId, archivedAt: null, channel: "email" },
    orderBy: [{ name: "asc" }],
    take: 50,
    select: { id: true, name: true, subject: true, body: true },
  });
  return rows;
}

function ago(d: Date | null, now: Date): string | null {
  if (!d) return null;
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days <= 0) return "Talked today";
  if (days === 1) return "Talked yesterday";
  return `Talked ${days} days ago`;
}

export function queueRows(items: readonly QueueItem[], names: ReadonlyMap<string, string>, now: Date = new Date()) {
  return items.map((i) => ({
    key: i.key,
    targetKind: i.targetKind,
    id: i.id,
    name: i.name,
    sub: i.sub,
    email: i.email,
    phone: i.phone,
    blocked: i.doNotContact ? "Do not contact" : i.unsubscribed ? "Unsubscribed from email" : !i.email && i.targetKind === "person" ? "No email" : null,
    owner: i.ownerId ? (names.get(i.ownerId) ?? null) : null,
    lastTalked: ago(i.lastContactedAt, now),
    urgent: i.urgent,
    reasons: i.reasons.map((r) => ({ kind: r.kind, label: r.label, ref: r.ref })),
  }));
}
