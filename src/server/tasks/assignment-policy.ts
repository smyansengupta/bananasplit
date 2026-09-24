import { OrgChartVersionStatus } from "@/generated/prisma/client";
import {
  emptyViewerChart,
  relationFor,
  userDepths,
  type AssignmentRelationValue,
  type ChartNode,
  type ViewerChart,
} from "@/lib/tasks/assignment";
import type { TxClient } from "@/server/db/context";
import {
  computeManagers,
  computeReportingSubtree,
  getPublishedOrgChart,
  type ChartPosition,
} from "@/server/org-chart/queries";

/**
 * The hand-down policy over the published org chart (Phase 6b), shared by
 * every assignment path (owner change, collaborators, bulk assign, subtask
 * add) through src/server/tasks/service.ts.
 *
 * Actions read the published positions with their own ctx.db (members may
 * read the published version under RLS), so the check runs in the action's
 * transaction with no second connection. Pages use the cached
 * getPublishedOrgChart after getOrgContextBySlug has authorized the viewer.
 * Both reduce the chart to a ViewerChart with getReportingSubtree's pure core
 * (computeReportingSubtree) and computeManagers.
 */

export function buildViewerChart(positions: readonly ChartNode[] | null, userId: string): ViewerChart {
  if (!positions || positions.length === 0) return emptyViewerChart(userId);
  return {
    viewerId: userId,
    hasChart: true,
    subtree: computeReportingSubtree(positions, userId).userIds,
    managers: computeManagers(positions, userId),
    depth: userDepths(positions),
  };
}

/** The published chart's positions, read in the caller's transaction. */
export async function loadChartNodes(db: TxClient, organizationId: string): Promise<ChartNode[] | null> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { activeOrgChartVersionId: true },
  });
  if (!org?.activeOrgChartVersionId) return null;
  const version = await db.orgChartVersion.findFirst({
    where: {
      id: org.activeOrgChartVersionId,
      organizationId,
      status: OrgChartVersionStatus.PUBLISHED,
    },
    select: { id: true },
  });
  if (!version) return null;
  return db.orgChartPosition.findMany({
    where: { organizationId, versionId: version.id },
    select: { id: true, userId: true, reportsToId: true, isAdvisor: true },
  });
}

/** The published chart for a page (cached). AUTHORIZE the viewer first. */
export async function getChartForPage(organizationId: string): Promise<ChartPosition[] | null> {
  const chart = await getPublishedOrgChart(organizationId);
  return chart?.positions ?? null;
}

export interface ClassifiedAssignment {
  userId: string;
  relation: AssignmentRelationValue;
  flagged: boolean;
}

/** Classifies assigning each of `userIds` from the chart's viewer. */
export function classifyAll(chart: ViewerChart, userIds: readonly string[]): ClassifiedAssignment[] {
  return userIds.map((userId) => {
    const relation = relationFor(chart, userId);
    return { userId, relation, flagged: relation === "ABOVE" };
  });
}
