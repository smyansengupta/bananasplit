import { splitAmong, type Routing, type RoutingRule } from "./outreach/assign";
import { setupKindsFor, type SetupKind } from "./templates";

/**
 * "Who looks after new people?" in Get your CRM started (docs/features/crm.md,
 * "Getting started"): split the people brought in evenly among the members,
 * give each relationship type to one member, or leave them with nobody for
 * now. The same choice becomes the routing for people who come in later
 * (CRM settings > Team). Pure.
 */

export type OwnerMode = "split" | "rel" | "none";

export const OWNER_MODES: readonly { id: OwnerMode; title: string; text: string }[] = [
  {
    id: "split",
    title: "Split evenly",
    text: "Everyone gets a fair share, matched to who already knows them.",
  },
  {
    id: "rel",
    title: "By type of person",
    text: "Clients to one person, partners to another. Change it later in settings.",
  },
  {
    id: "none",
    title: "Leave them for now",
    text: "Nobody owns them yet. Today reminds managers to hand them out.",
  },
];

export interface OwnerPlan {
  /** Person id to their new owner (null: nobody). */
  assign: Map<string, string | null>;
  /** What new people get from now on. */
  routing: Routing;
}

/**
 * Who gets whom. `people` are the ones setup brought in; `knows` is who
 * already looks after someone (kept when they're one of the members, as
 * splitAmong does). By relationship deals the types out in turn, biggest
 * type first, and people with no type are split evenly.
 */
export function planOwners(
  mode: OwnerMode,
  people: readonly { id: string; relationship: string | null; knows?: string | null }[],
  memberIds: readonly string[],
): OwnerPlan {
  const pool = [...new Set(memberIds)];
  if (mode === "none" || pool.length === 0) {
    return {
      assign: new Map(people.map((p) => [p.id, null])),
      routing: { mode: "off", pool: [], rules: [] },
    };
  }
  if (mode === "split") {
    const split = splitAmong(
      people.map((p) => ({ id: p.id, ownerId: p.knows ?? null })),
      pool,
    );
    return { assign: new Map(split), routing: { mode: "round-robin", pool, rules: [] } };
  }
  const byType = new Map<string, string[]>();
  const loose: { id: string; ownerId: string | null }[] = [];
  for (const p of people) {
    if (!p.relationship) {
      loose.push({ id: p.id, ownerId: p.knows ?? null });
      continue;
    }
    byType.set(p.relationship, [...(byType.get(p.relationship) ?? []), p.id]);
  }
  const types = [...byType.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );
  const load = new Map(pool.map((m) => [m, 0]));
  const assign = new Map<string, string | null>();
  const rules: RoutingRule[] = [];
  for (const [type, ids] of types) {
    let best = pool[0]!;
    for (const m of pool) if (load.get(m)! < load.get(best)!) best = m;
    load.set(best, load.get(best)! + ids.length);
    for (const id of ids) assign.set(id, best);
    rules.push({ field: "relationship", op: "is", value: type, ownerId: best });
  }
  for (const [id, owner] of splitAmong(loose, pool, load)) assign.set(id, owner);
  return { assign, routing: { mode: "rules", pool, rules } };
}

/**
 * What setup starts with picked ("We filled in what we could"): what was
 * picked before; else Partners and deals when Finance has partners, and
 * members (an organization) or clients (a Personal space).
 */
export function startingKinds(
  personal: boolean,
  picked: readonly string[],
  hasPartners: boolean,
): SetupKind[] {
  const offered = setupKindsFor(personal);
  const before = offered.filter((k) => picked.includes(k));
  if (before.length) return before;
  const first: SetupKind = personal ? "clients" : "members";
  return offered.filter((k) => k === first || (hasPartners && k === "sponsors"));
}
