import { randomUUID } from "node:crypto";

import { generateNKeysBetween } from "fractional-indexing";

import { Prisma } from "@/generated/prisma/client";
import type { MatchState } from "@/lib/org-chart/types";

/**
 * Writing a version's positions in one transaction, on either path (the
 * admin's app_user transaction or the parse job's service transaction).
 *
 * Positions are inserted in one createMany with their manager left empty,
 * then every reporting line is set in one UPDATE ... FROM (VALUES ...):
 * the same-org trigger on reportsToId checks each manager row, which then
 * exists. Ids are generated here so references resolve before the insert;
 * a caller may keep existing ids (draft saves).
 */

type Db = Prisma.TransactionClient;

export interface PositionWrite {
  /** Unique within the batch; reportsToRef points at another entry's ref. */
  ref: string;
  /** Keep this row id (a draft save); a new id is generated otherwise. */
  id?: string;
  key: string;
  title: string;
  personName: string | null;
  userId: string | null;
  matchState: MatchState;
  matchScore: number | null;
  suggestedUserIds: string[];
  reportsToRef: string | null;
  isOpen: boolean;
  isAdvisor: boolean;
  responsibilities: string[];
  decidesAlone: string[];
  sourceQuote: string[];
  /** Sibling order; assigned in list order per manager when missing. */
  rank?: string | null;
}

/** Fills missing ranks: each manager's reports in list order. */
export function assignRanks(list: readonly PositionWrite[]): Map<string, string> {
  const ranks = new Map<string, string>();
  const groups = new Map<string, PositionWrite[]>();
  for (const p of list) {
    const group = p.reportsToRef ?? "";
    groups.set(group, [...(groups.get(group) ?? []), p]);
  }
  for (const members of groups.values()) {
    const keys = generateNKeysBetween(null, null, members.length);
    members.forEach((p, i) => ranks.set(p.ref, p.rank || keys[i]));
  }
  return ranks;
}

/** Inserts `list` into the version; returns ref -> row id. */
export async function insertPositions(
  db: Db,
  organizationId: string,
  versionId: string,
  list: readonly PositionWrite[],
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const p of list) ids.set(p.ref, p.id ?? randomUUID());
  if (list.length === 0) return ids;
  const ranks = assignRanks(list);

  await db.orgChartPosition.createMany({
    data: list.map((p) => ({
      id: ids.get(p.ref) as string,
      organizationId,
      versionId,
      key: p.key,
      title: p.title,
      personName: p.personName,
      userId: p.isOpen ? null : p.userId,
      matchState: p.isOpen ? "UNMATCHED" : p.matchState,
      matchScore: p.matchScore,
      suggestedUserIds: p.suggestedUserIds.slice(0, 3),
      isOpen: p.isOpen,
      isAdvisor: p.isAdvisor,
      responsibilities: p.responsibilities,
      decidesAlone: p.decidesAlone,
      sourceQuote: p.sourceQuote,
      rank: ranks.get(p.ref) as string,
    })),
  });

  const links = list
    .filter((p) => p.reportsToRef !== null && ids.has(p.reportsToRef))
    .map((p) => Prisma.sql`(${ids.get(p.ref)}::text, ${ids.get(p.reportsToRef as string)}::text)`);
  if (links.length > 0) {
    await db.$executeRaw`
      UPDATE "OrgChartPosition" AS p
         SET "reportsToId" = v.parent
        FROM (VALUES ${Prisma.join(links)}) AS v(id, parent)
       WHERE p."id" = v.id
         AND p."versionId" = ${versionId}
         AND p."organizationId" = ${organizationId}`;
  }
  return ids;
}

/** The columns every copy and editor read needs. */
export const positionSelect = {
  id: true,
  key: true,
  title: true,
  personName: true,
  userId: true,
  matchState: true,
  matchScore: true,
  suggestedUserIds: true,
  reportsToId: true,
  isOpen: true,
  isAdvisor: true,
  responsibilities: true,
  decidesAlone: true,
  sourceQuote: true,
  rank: true,
} satisfies Prisma.OrgChartPositionSelect;

export type PositionRow = Prisma.OrgChartPositionGetPayload<{ select: typeof positionSelect }>;

/** Rows of one version as writes (fresh ids), for copying a version forward. */
export function rowsToWrites(
  rows: readonly PositionRow[],
  options: { memberIds?: ReadonlySet<string>; userNames?: ReadonlyMap<string, string | null> } = {},
): PositionWrite[] {
  return rows.map((r) => {
    const stillMember = r.userId !== null && (!options.memberIds || options.memberIds.has(r.userId));
    // A member who left becomes a placeholder that keeps their name.
    const personName =
      r.personName ?? (r.userId && !stillMember ? (options.userNames?.get(r.userId) ?? null) : null);
    return {
      ref: r.id,
      key: r.key,
      title: r.title,
      personName,
      userId: stillMember ? r.userId : null,
      matchState: stillMember ? r.matchState : r.matchState === "CONFIRMED" ? "UNMATCHED" : r.matchState,
      matchScore: stillMember ? r.matchScore : null,
      suggestedUserIds: options.memberIds ? r.suggestedUserIds.filter((id) => options.memberIds!.has(id)) : r.suggestedUserIds,
      reportsToRef: r.reportsToId,
      isOpen: r.isOpen,
      isAdvisor: r.isAdvisor,
      responsibilities: r.responsibilities,
      decidesAlone: r.decidesAlone,
      sourceQuote: r.sourceQuote,
      rank: r.rank,
    };
  });
}
