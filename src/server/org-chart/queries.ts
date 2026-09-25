import { unstable_cache } from "next/cache";

import { OrgChartVersionStatus } from "@/generated/prisma/client";
import { orgChart } from "@/server/cache/tags";
import { withSystemOrgTx } from "@/server/db/context";
import { userPublicSelect, type UserPublic } from "@/server/members";

/**
 * Published org chart reads (Phase 3 contract).
 *
 * getPublishedOrgChart(orgId) is a cached loader under the plan-wide
 * contract: unstable_cache tagged tags.orgChart(orgId), invalidated by
 * publish and rollback (invalidate([tags.orgChart(orgId)])). It opens its own
 * withSystemOrgTx(orgId), takes orgId explicitly and never reads the
 * request's transaction context, so a background revalidation computes the
 * same result. The payload is minimal: no emails, no rawParse, no warnings.
 *
 * AUTHORIZE FIRST: the loader runs on the service path and does not check
 * membership. Call it only after getOrgContextBySlug / withOrgTx has
 * established that the viewer belongs to the org.
 *
 * getReportingSubtree(orgId, userId) returns everyone below `userId` in the
 * chart (the Tasks hand-down rule), advisors excluded; an empty chart
 * returns empty sets.
 */

export type ChartPerson = UserPublic;

export interface ChartPosition {
  id: string;
  key: string;
  title: string;
  personName: string | null;
  userId: string | null;
  user: ChartPerson | null;
  reportsToId: string | null;
  isOpen: boolean;
  isAdvisor: boolean;
  responsibilities: string[];
  decidesAlone: string[];
  rank: string;
}

export interface PublishedOrgChart {
  versionId: string;
  number: number;
  /** ISO timestamp (cached payloads are JSON). */
  publishedAt: string | null;
  positions: ChartPosition[];
}

async function loadPublishedOrgChart(orgId: string): Promise<PublishedOrgChart | null> {
  return withSystemOrgTx(orgId, async ({ db }) => {
    const org = await db.organization.findUnique({
      where: { id: orgId },
      select: { activeOrgChartVersionId: true },
    });
    if (!org?.activeOrgChartVersionId) return null;
    const version = await db.orgChartVersion.findFirst({
      where: {
        id: org.activeOrgChartVersionId,
        organizationId: orgId,
        status: OrgChartVersionStatus.PUBLISHED,
      },
      select: { id: true, number: true, publishedAt: true },
    });
    if (!version) return null;
    const positions = await db.orgChartPosition.findMany({
      where: { organizationId: orgId, versionId: version.id },
      orderBy: [{ rank: "asc" }, { id: "asc" }],
      select: {
        id: true,
        key: true,
        title: true,
        personName: true,
        userId: true,
        reportsToId: true,
        isOpen: true,
        isAdvisor: true,
        responsibilities: true,
        decidesAlone: true,
        rank: true,
        user: { select: userPublicSelect },
      },
    });
    return {
      versionId: version.id,
      number: version.number,
      publishedAt: version.publishedAt ? version.publishedAt.toISOString() : null,
      positions,
    };
  });
}

/** The org's published chart, or null when none is published. Cached; see the module comment. */
export async function getPublishedOrgChart(orgId: string): Promise<PublishedOrgChart | null> {
  const cached = unstable_cache(() => loadPublishedOrgChart(orgId), ["published-org-chart", orgId], {
    tags: [orgChart(orgId)],
    revalidate: 3600,
  });
  try {
    return await cached();
  } catch (error) {
    // Outside a Next.js request (scripts, tests) there is no incremental cache.
    if (error instanceof Error && /incrementalCache missing|static generation store missing/i.test(error.message)) {
      return loadPublishedOrgChart(orgId);
    }
    throw error;
  }
}

export interface ReportingSubtree {
  /** Positions below the user's position(s), advisors excluded. */
  positionIds: string[];
  /** Members holding those positions (open and placeholder positions have none). */
  userIds: string[];
}

/**
 * Everyone below `userId` in `positions`: the descendants of every position
 * the user holds, following reportsToId, skipping advisors (and anything
 * below an advisor, which the chart does not allow anyway). The user's own
 * positions are not included. Cycles are tolerated. Pure, for tests.
 */
export function computeReportingSubtree(
  positions: readonly Pick<ChartPosition, "id" | "userId" | "reportsToId" | "isAdvisor">[],
  userId: string,
): ReportingSubtree {
  const children = new Map<string, string[]>();
  for (const p of positions) {
    if (!p.reportsToId || p.isAdvisor) continue;
    children.set(p.reportsToId, [...(children.get(p.reportsToId) ?? []), p.id]);
  }
  const byId = new Map(positions.map((p) => [p.id, p]));
  const roots = positions.filter((p) => p.userId === userId && !p.isAdvisor).map((p) => p.id);
  const own = new Set(roots);

  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    for (const child of children.get(id) ?? []) {
      if (seen.has(child) || own.has(child)) continue;
      seen.add(child);
      queue.push(child);
    }
  }
  const positionIds = [...seen];
  const userIds = [
    ...new Set(
      positionIds
        .map((id) => byId.get(id)?.userId)
        .filter((u): u is string => typeof u === "string" && u !== userId),
    ),
  ];
  return { positionIds, userIds };
}

/**
 * The chain of managers above `userId` (nearest first), advisors excluded:
 * for flagging an assignment "above your level". Pure, for tests.
 */
export function computeManagers(
  positions: readonly Pick<ChartPosition, "id" | "userId" | "reportsToId" | "isAdvisor">[],
  userId: string,
): string[] {
  const byId = new Map(positions.map((p) => [p.id, p]));
  const managers: string[] = [];
  const seen = new Set<string>();
  for (const start of positions.filter((p) => p.userId === userId && !p.isAdvisor)) {
    let current = start.reportsToId ? byId.get(start.reportsToId) : undefined;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      if (current.userId && current.userId !== userId && !managers.includes(current.userId)) {
        managers.push(current.userId);
      }
      current = current.reportsToId ? byId.get(current.reportsToId) : undefined;
    }
  }
  return managers;
}

/** Everyone below `userId` in the org's published chart. */
export async function getReportingSubtree(orgId: string, userId: string): Promise<ReportingSubtree> {
  const chart = await getPublishedOrgChart(orgId);
  if (!chart) return { positionIds: [], userIds: [] };
  return computeReportingSubtree(chart.positions, userId);
}
