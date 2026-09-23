import { stratify, tree, type HierarchyPointNode } from "d3-hierarchy";

/**
 * Top-down tree layout for the chart canvas (d3-hierarchy). Pure.
 *
 * Advisors are left out of the hierarchy and placed beside their manager,
 * to the right on the same row, joined by a dashed edge; the separation
 * function reserves their width so they never overlap a neighbour. Several
 * roots hang off an invisible root. A reference to a missing manager or a
 * loop (possible only in an unsaved draft) makes that position a root.
 */

export const NODE_WIDTH = 240;
export const NODE_HEIGHT = 96;
export const H_GAP = 40;
export const V_GAP = 72;

export interface LayoutInput {
  id: string;
  reportsToId: string | null;
  isAdvisor: boolean;
  rank: string;
}

export interface LaidOutNode {
  id: string;
  /** Top-left corner, as React Flow positions nodes. */
  x: number;
  y: number;
  kind: "main" | "advisor";
}

export interface LaidOutEdge {
  id: string;
  source: string;
  target: string;
  kind: "reports" | "advisor";
}

export interface ChartLayout {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  width: number;
  height: number;
}

const ROOT = "\u0000root";

function byRank(a: LayoutInput, b: LayoutInput): number {
  if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The effective manager of each position after dropping missing refs and loops. */
export function effectiveParents(positions: readonly LayoutInput[]): Map<string, string | null> {
  const byId = new Map(positions.map((p) => [p.id, p]));
  const parent = new Map<string, string | null>();
  for (const p of positions) {
    parent.set(p.id, p.reportsToId && byId.has(p.reportsToId) && p.reportsToId !== p.id ? p.reportsToId : null);
  }
  // Break loops: walk up from each node; a revisit makes the first node on the loop a root.
  for (const p of positions) {
    const seen: string[] = [];
    let current: string | null = p.id;
    while (current !== null) {
      if (seen.includes(current)) {
        parent.set(current, null);
        break;
      }
      seen.push(current);
      current = parent.get(current) ?? null;
    }
  }
  return parent;
}

export function layoutOrgChart(positions: readonly LayoutInput[]): ChartLayout {
  if (positions.length === 0) return { nodes: [], edges: [], width: 0, height: 0 };

  const sorted = [...positions].sort(byRank);
  const parents = effectiveParents(sorted);
  const reportsOf = new Map<string, LayoutInput[]>();
  for (const p of sorted) {
    const parent = parents.get(p.id);
    if (parent) reportsOf.set(parent, [...(reportsOf.get(parent) ?? []), p]);
  }

  // A side-branch advisor has a manager and no reports; anything else stays in the tree.
  const isSideAdvisor = (p: LayoutInput) =>
    p.isAdvisor && parents.get(p.id) !== null && (reportsOf.get(p.id) ?? []).length === 0;
  const advisorsOf = new Map<string, LayoutInput[]>();
  const main: LayoutInput[] = [];
  for (const p of sorted) {
    if (isSideAdvisor(p)) {
      const manager = parents.get(p.id) as string;
      advisorsOf.set(manager, [...(advisorsOf.get(manager) ?? []), p]);
    } else {
      main.push(p);
    }
  }
  // An advisor's manager that is itself a side advisor cannot host it; such
  // chains are invalid (validateChart), so fall back to the main tree.
  const mainIds = new Set(main.map((p) => p.id));
  for (const [manager, list] of [...advisorsOf]) {
    if (!mainIds.has(manager)) {
      advisorsOf.delete(manager);
      for (const p of list) {
        main.push(p);
        mainIds.add(p.id);
      }
    }
  }

  type Datum = { id: string; parentId: string | null };
  const data: Datum[] = [
    { id: ROOT, parentId: null },
    ...main.map((p) => ({ id: p.id, parentId: parents.get(p.id) ?? ROOT })),
  ];
  const root = stratify<Datum>()
    .id((d) => d.id)
    .parentId((d) => d.parentId)(data);

  const unit = NODE_WIDTH + H_GAP;
  const advisorCount = (id: string) => advisorsOf.get(id)?.length ?? 0;
  const laidOut = tree<Datum>()
    .nodeSize([unit, NODE_HEIGHT + V_GAP])
    // Symmetric (d3 calls it with either order): room for the advisors of whichever is on the left.
    .separation(
      (a, b) =>
        (a.parent === b.parent ? 1 : 1.15) + Math.max(advisorCount(a.data.id), advisorCount(b.data.id)),
    )(root);

  const nodes: LaidOutNode[] = [];
  const edges: LaidOutEdge[] = [];
  laidOut.each((n: HierarchyPointNode<Datum>) => {
    if (n.data.id === ROOT) return;
    const x = n.x - NODE_WIDTH / 2;
    const y = (n.depth - 1) * (NODE_HEIGHT + V_GAP);
    nodes.push({ id: n.data.id, x, y, kind: "main" });
    if (n.parent && n.parent.data.id !== ROOT) {
      edges.push({ id: `r:${n.parent.data.id}:${n.data.id}`, source: n.parent.data.id, target: n.data.id, kind: "reports" });
    }
    (advisorsOf.get(n.data.id) ?? []).forEach((advisor, i) => {
      nodes.push({ id: advisor.id, x: x + (i + 1) * unit, y, kind: "advisor" });
      edges.push({ id: `a:${n.data.id}:${advisor.id}`, source: n.data.id, target: advisor.id, kind: "advisor" });
    });
  });

  const minX = Math.min(...nodes.map((n) => n.x));
  for (const n of nodes) n.x -= minX;
  const width = Math.max(...nodes.map((n) => n.x)) + NODE_WIDTH;
  const height = Math.max(...nodes.map((n) => n.y)) + NODE_HEIGHT;
  return { nodes, edges, width, height };
}
