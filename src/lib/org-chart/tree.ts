import { effectiveParents } from "./layout";
import { compareRank } from "./types";

/**
 * Navigating a chart's positions (list view, side panel, editor outline).
 * Pure; tolerates missing managers and loops like the layout does.
 */

export interface TreeNode {
  id: string;
  key: string;
  reportsToId: string | null;
  alsoReportsToIds?: readonly string[];
  isAdvisor: boolean;
  rank: string;
}

export interface ChartIndex<T extends TreeNode> {
  byId: Map<string, T>;
  byKey: Map<string, T>;
  /** Positions with no (valid) manager, advisors excluded, by rank. */
  roots: T[];
  /** Non-advisor direct reports, by rank. */
  reportsOf(id: string): T[];
  /** Advisors beside this position, by rank. */
  advisorsOf(id: string): T[];
  managerOf(id: string): T | null;
  /** Extra managers (dotted lines) that are in the chart, by rank. */
  alsoManagersOf(id: string): T[];
  /** Positions with a dotted line to this one, by rank. */
  dottedReportsOf(id: string): T[];
  /** The managers above, nearest first. */
  chainOf(id: string): T[];
}

export function indexChart<T extends TreeNode>(nodes: readonly T[]): ChartIndex<T> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const parents = effectiveParents(nodes.map((n) => ({ ...n, reportsToId: n.reportsToId })));
  const reports = new Map<string, T[]>();
  const advisors = new Map<string, T[]>();
  const roots: T[] = [];
  const sorted = [...nodes].sort(compareRank);
  for (const n of sorted) {
    const parent = parents.get(n.id) ?? null;
    if (parent === null) {
      roots.push(n);
    } else if (n.isAdvisor) {
      advisors.set(parent, [...(advisors.get(parent) ?? []), n]);
    } else {
      reports.set(parent, [...(reports.get(parent) ?? []), n]);
    }
  }
  const alsoManagers = new Map<string, T[]>();
  const dottedReports = new Map<string, T[]>();
  for (const n of sorted) {
    for (const m of new Set(n.alsoReportsToIds ?? [])) {
      const manager = byId.get(m);
      if (!manager || m === n.id || m === parents.get(n.id)) continue;
      alsoManagers.set(n.id, [...(alsoManagers.get(n.id) ?? []), manager]);
      dottedReports.set(m, [...(dottedReports.get(m) ?? []), n]);
    }
  }
  for (const list of alsoManagers.values()) list.sort(compareRank);
  const managerOf = (id: string) => {
    const parent = parents.get(id);
    return parent ? (byId.get(parent) ?? null) : null;
  };
  return {
    byId,
    byKey,
    roots,
    reportsOf: (id) => reports.get(id) ?? [],
    advisorsOf: (id) => advisors.get(id) ?? [],
    managerOf,
    alsoManagersOf: (id) => alsoManagers.get(id) ?? [],
    dottedReportsOf: (id) => dottedReports.get(id) ?? [],
    chainOf: (id) => {
      const chain: T[] = [];
      const seen = new Set<string>([id]);
      let current = managerOf(id);
      while (current && !seen.has(current.id)) {
        chain.push(current);
        seen.add(current.id);
        current = managerOf(current.id);
      }
      return chain;
    },
  };
}

/** Ids of `id` and everything below it (reports and advisors). */
export function descendantIds(nodes: readonly TreeNode[], id: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.reportsToId) children.set(n.reportsToId, [...(children.get(n.reportsToId) ?? []), n.id]);
  }
  const out = new Set<string>([id]);
  const queue = [id];
  while (queue.length > 0) {
    const next = queue.shift() as string;
    for (const c of children.get(next) ?? []) {
      if (!out.has(c)) {
        out.add(c);
        queue.push(c);
      }
    }
  }
  return out;
}
