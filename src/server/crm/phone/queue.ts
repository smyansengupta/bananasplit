import type { Prisma } from "@/generated/prisma/client";
import { inWindow, type PhoneSettings } from "@/lib/crm/phone";
import type { TxClient } from "@/server/db/context";

import type { RoleOwner } from "../owners";
import { parseListQuery, peopleWhere } from "../queries";

/**
 * Who the dialer calls next (docs/features/crm.md module 5): a saved view
 * of people (CrmView, the same filters as the People list) or the
 * follow-ups due, keeping only people with a number who haven't asked not
 * to be contacted. Read as the member (RLS), so OWN access dials only
 * their own people.
 */

const PARAM: Record<string, (op: string, value: string) => [string, string] | null> = {
  owner: (_op, v) => ["owner", v],
  followUp: (op) => (op === "lte" ? ["due", "due"] : null),
  relationship: (_op, v) => ["rel", v],
  status: (_op, v) => ["status", v],
};

/** A saved view's filters as the People list's query. */
export function viewQuery(filters: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of (Array.isArray(filters) ? filters : []) as { col?: string; op?: string; value?: unknown }[]) {
    const hit = f.col && PARAM[f.col]?.(f.op ?? "eq", String(f.value ?? ""));
    if (hit) out[hit[0]] = hit[1];
  }
  return out;
}

export interface QueuePerson {
  id: string;
  name: string;
  phone: string;
  title: string | null;
  companyName: string | null;
  lastContactedAt: Date | null;
}

export async function dialQueue(
  db: TxClient,
  organizationId: string,
  viewerId: string,
  roles: ReadonlyMap<string, RoleOwner>,
  list: { kind: "due" } | { kind: "view"; filters: unknown },
  take = 200,
): Promise<QueuePerson[]> {
  const sp = list.kind === "due" ? { due: "due" } : viewQuery(list.filters);
  const where: Prisma.CrmPersonWhereInput = {
    AND: [peopleWhere(organizationId, parseListQuery(sp), viewerId, roles), { phone: { not: null } }, { doNotContact: false }],
  };
  const rows = await db.crmPerson.findMany({
    where,
    orderBy: [{ nextFollowUpAt: { sort: "asc", nulls: "last" } }, { lastContactedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
    take,
    select: { id: true, name: true, phone: true, title: true, lastContactedAt: true, company: { select: { name: true } } },
  });
  return rows
    .filter((r): r is typeof r & { phone: string } => Boolean(r.phone))
    .map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      title: r.title,
      companyName: r.company?.name ?? null,
      lastContactedAt: r.lastContactedAt,
    }));
}

/** "It's 20:15 where your organization is; calls are best between 09:00 and 18:00." or null. */
export function callingHoursHint(settings: Pick<PhoneSettings, "callStart" | "callEnd">, timeZone: string, now = new Date()): string | null {
  if (inWindow(now, timeZone, settings.callStart, settings.callEnd)) return null;
  return `It's outside your organization's calling hours (${settings.callStart} to ${settings.callEnd}). People may not pick up.`;
}
