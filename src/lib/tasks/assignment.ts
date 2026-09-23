/**
 * Hand-down classification along the published org chart ('Tasks owner,
 * status, and mentions' decision; Phase 6b). Pure and client-safe, so the
 * dialog can warn before saving with exactly the rule the server enforces.
 *
 * The server builds a ViewerChart for the acting user from the published
 * chart (src/server/tasks/assignment-policy.ts, using getReportingSubtree's
 * pure core) and classifies every assignment path with relationFor():
 *
 *   SELF           assigning yourself (the self-assign carve-out; never flagged)
 *   DOWN_LINE      the assignee is below you in the chart (a lead or VP handing down)
 *   ABOVE          the assignee is one of your managers, or sits at a higher
 *                  level in another line: allowed, but FLAGGED
 *   PEER           both on the chart, neither above the other
 *   OUTSIDE_CHART  no published chart, or either person holds no position
 *                  (advisors sit outside the hierarchy)
 *
 * Only ABOVE is flagged (the plan's default).
 */

export const ASSIGNMENT_RELATIONS = ["SELF", "DOWN_LINE", "PEER", "ABOVE", "OUTSIDE_CHART"] as const;

export type AssignmentRelationValue = (typeof ASSIGNMENT_RELATIONS)[number];

/** A published chart position, as far as classification needs it. */
export interface ChartNode {
  id: string;
  userId: string | null;
  reportsToId: string | null;
  isAdvisor: boolean;
}

/** The acting user's view of the chart (serializable; passed to the client). */
export interface ViewerChart {
  viewerId: string;
  hasChart: boolean;
  /** Everyone below the viewer (the hand-down targets). */
  subtree: string[];
  /** The viewer's managers, nearest first. */
  managers: string[];
  /** Depth of each person's highest non-advisor position (root = 0). */
  depth: Record<string, number>;
}

export function emptyViewerChart(viewerId: string): ViewerChart {
  return { viewerId, hasChart: false, subtree: [], managers: [], depth: {} };
}

/** Depth of each position (root 0), following reportsTo; advisors excluded. */
export function positionDepths(positions: readonly ChartNode[]): Map<string, number> {
  const byId = new Map(positions.map((p) => [p.id, p]));
  const depth = new Map<string, number>();
  const visit = (p: ChartNode, seen: Set<string>): number => {
    const known = depth.get(p.id);
    if (known !== undefined) return known;
    const parent = p.reportsToId ? byId.get(p.reportsToId) : undefined;
    let d = 0;
    if (parent && !parent.isAdvisor && !seen.has(parent.id)) {
      seen.add(p.id);
      d = visit(parent, seen) + 1;
    }
    depth.set(p.id, d);
    return d;
  };
  for (const p of positions) if (!p.isAdvisor) visit(p, new Set([p.id]));
  return depth;
}

/** Each member's highest (smallest) depth over their non-advisor positions. */
export function userDepths(positions: readonly ChartNode[]): Record<string, number> {
  const depths = positionDepths(positions);
  const out: Record<string, number> = {};
  for (const p of positions) {
    if (!p.userId || p.isAdvisor) continue;
    const d = depths.get(p.id);
    if (d === undefined) continue;
    if (out[p.userId] === undefined || d < out[p.userId]!) out[p.userId] = d;
  }
  return out;
}

/** How assigning `targetId` relates to the viewer. */
export function relationFor(chart: ViewerChart, targetId: string): AssignmentRelationValue {
  if (targetId === chart.viewerId) return "SELF";
  if (!chart.hasChart) return "OUTSIDE_CHART";
  const mine = chart.depth[chart.viewerId];
  const theirs = chart.depth[targetId];
  if (mine === undefined || theirs === undefined) return "OUTSIDE_CHART";
  if (chart.subtree.includes(targetId)) return "DOWN_LINE";
  if (chart.managers.includes(targetId)) return "ABOVE";
  if (theirs < mine) return "ABOVE";
  return "PEER";
}

export function isFlaggedRelation(relation: AssignmentRelationValue | null | undefined): boolean {
  return relation === "ABOVE";
}

export const RELATION_LABELS: Record<AssignmentRelationValue, string> = {
  SELF: "Self-assigned",
  DOWN_LINE: "Handed down",
  PEER: "Peer",
  ABOVE: "Above your level",
  OUTSIDE_CHART: "Outside the chart",
};
