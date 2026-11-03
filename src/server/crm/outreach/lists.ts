import type { Prisma } from "@/generated/prisma/client";
import type { TxClient } from "@/server/db/context";

import { CrmError, type CrmActor } from "../access";
import type { RoleOwner } from "../owners";
import { parseListQuery, peopleWhere } from "../queries";

/**
 * Lists (docs/features/crm.md, module 5, "Lists and campaigns"): a list is
 * a saved view of people (CrmView, objectKind "people"); its filters are
 * the People page's own (owner, follow-up due, relationship, status), so a
 * list always holds whoever matches it today. Campaigns, bulk email and
 * keep-in-touch in bulk all start from one.
 */

export interface ListFilters {
  relationship?: string | null;
  status?: "ACTIVE" | "INACTIVE" | "ALUMNI" | "all" | null;
  /** "me", "none" or a member id. */
  owner?: string | null;
  due?: "due" | "cold" | "new" | null;
}

type ViewFilter = { col?: string; op?: string; value?: string };

/** A view's stored filters as the People page's URL parameters. */
export function viewParams(filters: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of (Array.isArray(filters) ? filters : []) as ViewFilter[]) {
    const v = String(f.value ?? "");
    if (f.col === "owner") out.owner = v;
    else if (f.col === "followUp" && f.op === "lte") out.due = "due";
    else if (f.col === "due" && ["due", "cold", "new"].includes(v)) out.due = v;
    else if (f.col === "relationship") out.rel = v;
    else if (f.col === "status") out.status = v;
  }
  return out;
}

export function filtersToView(f: ListFilters): ViewFilter[] {
  const out: ViewFilter[] = [];
  if (f.owner) out.push({ col: "owner", op: "eq", value: f.owner });
  if (f.due) out.push({ col: "due", op: "eq", value: f.due });
  if (f.relationship) out.push({ col: "relationship", op: "eq", value: f.relationship });
  if (f.status) out.push({ col: "status", op: "eq", value: f.status });
  return out;
}

/** Whoever is on a list right now, as a where (the viewer's RLS still applies). */
export async function listWhere(
  db: TxClient,
  organizationId: string,
  viewId: string,
  viewerId: string,
  roles: ReadonlyMap<string, RoleOwner>,
): Promise<Prisma.CrmPersonWhereInput> {
  const view = await db.crmView.findFirst({
    where: { id: viewId, organizationId, objectKind: "people" },
    select: { filters: true },
  });
  if (!view) throw new CrmError("That list isn't here any more.");
  return peopleWhere(organizationId, parseListQuery(viewParams(view.filters)), viewerId, roles);
}

export interface ListSummary {
  id: string;
  name: string;
  count: number;
  emailable: number;
  shared: boolean;
  mine: boolean;
}

export async function listsWithCounts(
  db: TxClient,
  organizationId: string,
  viewerId: string,
  roles: ReadonlyMap<string, RoleOwner>,
): Promise<ListSummary[]> {
  const views = await db.crmView.findMany({
    where: { organizationId, objectKind: "people" },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: { id: true, name: true, filters: true, shared: true, createdById: true },
  });
  const out: ListSummary[] = [];
  for (const v of views) {
    const where = peopleWhere(organizationId, parseListQuery(viewParams(v.filters)), viewerId, roles);
    out.push({
      id: v.id,
      name: v.name,
      count: await db.crmPerson.count({ where }),
      emailable: await db.crmPerson.count({
        where: { AND: [where, { primaryEmail: { not: null }, doNotContact: false, unsubscribedAt: null }] },
      }),
      shared: v.shared,
      mine: v.createdById === viewerId,
    });
  }
  return out;
}

export async function saveList(actor: CrmActor, name: string, filters: ListFilters, shared = true): Promise<{ id: string }> {
  const n = name.trim().slice(0, 80);
  if (!n) throw new CrmError("Give the list a name.", ["name"]);
  return actor.db.crmView.create({
    data: {
      organizationId: actor.organizationId,
      objectKind: "people",
      name: n,
      filters: filtersToView(filters) as Prisma.InputJsonArray,
      shared,
      createdById: actor.userId,
    },
    select: { id: true },
  });
}

/** Up to `max` people of a list, owner first, for a campaign or a send. */
export async function listPeople(
  db: TxClient,
  organizationId: string,
  viewId: string,
  viewerId: string,
  roles: ReadonlyMap<string, RoleOwner>,
  max = 2000,
): Promise<{ id: string; ownerId: string | null; name: string; primaryEmail: string | null }[]> {
  const where = await listWhere(db, organizationId, viewId, viewerId, roles);
  return db.crmPerson.findMany({
    where,
    orderBy: [{ strength: "desc" }, { name: "asc" }],
    take: max,
    select: { id: true, ownerId: true, name: true, primaryEmail: true },
  });
}
