import type { Prisma } from "@/generated/prisma/client";
import { inWindow, type PhoneSettings } from "@/lib/crm/phone";
import type { TxClient } from "@/server/db/context";

import type { RoleOwner } from "../owners";
import { parseListQuery, peopleWhere } from "../queries";

/**
 * Who the dialer calls next (docs/features/crm.md module 5): a saved view
 * of people (CrmView, the same filters as the People list) or the
 * follow-ups due with the calls a sequence left for the viewer (Phase 2's
 * call steps, first), keeping only people with a number who haven't asked
 * not to be contacted. Read as the member (RLS), so OWN access dials only
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
  /** A sequence's call step waiting on the viewer: logging the call closes it. */
  stepId: string | null;
}

/** The viewer's open call steps from sequences, by person. */
export async function openCallSteps(db: TxClient, organizationId: string, viewerId: string): Promise<Map<string, string>> {
  const steps = await db.crmActivity.findMany({
    where: {
      organizationId,
      kind: "SEQUENCE_STEP",
      deletedAt: null,
      AND: [
        { meta: { path: ["open"], equals: true } },
        { meta: { path: ["step"], equals: "CALL" } },
        { meta: { path: ["ownerId"], equals: viewerId } },
      ],
    },
    orderBy: { occurredAt: "asc" },
    take: 200,
    select: { id: true, targets: { where: { targetKind: "person" }, select: { targetId: true }, take: 1 } },
  });
  const out = new Map<string, string>();
  for (const s of steps) {
    const personId = s.targets[0]?.targetId;
    if (personId && !out.has(personId)) out.set(personId, s.id);
  }
  return out;
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
  const steps = await openCallSteps(db, organizationId, viewerId);
  const listed = peopleWhere(organizationId, parseListQuery(sp), viewerId, roles);
  const where: Prisma.CrmPersonWhereInput = {
    AND: [
      list.kind === "due" && steps.size > 0 ? { OR: [listed, { organizationId, deletedAt: null, id: { in: [...steps.keys()] } }] } : listed,
      { phone: { not: null } },
      { doNotContact: false },
    ],
  };
  const rows = await db.crmPerson.findMany({
    where,
    orderBy: [{ nextFollowUpAt: { sort: "asc", nulls: "last" } }, { lastContactedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
    take,
    select: { id: true, name: true, phone: true, title: true, lastContactedAt: true, company: { select: { name: true } } },
  });
  const out = rows
    .filter((r): r is typeof r & { phone: string } => Boolean(r.phone))
    .map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      title: r.title,
      companyName: r.company?.name ?? null,
      lastContactedAt: r.lastContactedAt,
      stepId: steps.get(r.id) ?? null,
    }));
  // A call a sequence asked for comes first.
  return [...out.filter((p) => p.stepId), ...out.filter((p) => !p.stepId)];
}

/** "It's 20:15 where your organization is; calls are best between 09:00 and 18:00." or null. */
export function callingHoursHint(settings: Pick<PhoneSettings, "callStart" | "callEnd">, timeZone: string, now = new Date()): string | null {
  if (inWindow(now, timeZone, settings.callStart, settings.callEnd)) return null;
  return `It's outside your organization's calling hours (${settings.callStart} to ${settings.callEnd}). People may not pick up.`;
}
