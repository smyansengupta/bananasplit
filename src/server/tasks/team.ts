import type { TxClient } from "@/server/db/context";
import type { OrgMemberOption, UserPublic } from "@/server/members";
import type { ChartPosition } from "@/server/org-chart/queries";

import { getOpenTasksByOwners, type TaskListItem } from "./queries";

/**
 * The Team view: swimlanes by reporting line. The viewer sees the positions
 * below their own (their reporting subtree, as getReportingSubtree walks
 * it); OWNER/ADMIN may pick any position, or the whole chart. Each lane is
 * one position with its holder's open tasks; open hires show as empty lanes
 * ('Open hire'), advisors as a side lane, and in the whole-chart view an
 * 'Unpositioned' bucket collects tasks owned by members without a position
 * plus unowned tasks. Without a published chart there is one lane per member.
 */

export interface TeamLane {
  key: string;
  positionTitle: string | null;
  person: UserPublic | null;
  personName: string | null;
  isOpen: boolean;
  depth: number;
  tasks: TaskListItem[];
}

export interface TeamView {
  hasChart: boolean;
  /** The position the lanes start at ("all" for the whole chart). */
  scope: string;
  /** Positions an admin can pick. */
  scopeOptions: { id: string; label: string }[];
  lanes: TeamLane[];
  advisors: TeamLane[];
  unpositioned: TaskListItem[] | null;
  /** The viewer holds no position (and isn't an admin). */
  offChart: boolean;
}

export async function getTeamView(
  db: TxClient,
  input: {
    organizationId: string;
    viewerId: string;
    isAdmin: boolean;
    positions: ChartPosition[] | null;
    members: OrgMemberOption[];
    requestedScope: string | null;
  },
): Promise<TeamView> {
  const { organizationId, viewerId, isAdmin, positions, members } = input;

  if (!positions || positions.length === 0) {
    const tasks = await getOpenTasksByOwners(db, organizationId, members.map((m) => m.id));
    const byOwner = groupByOwner(tasks);
    return {
      hasChart: false,
      scope: "all",
      scopeOptions: [],
      lanes: members.map((m) => ({
        key: m.id,
        positionTitle: m.title,
        person: m,
        personName: m.name,
        isOpen: false,
        depth: 0,
        tasks: byOwner.get(m.id) ?? [],
      })),
      advisors: [],
      unpositioned: null,
      offChart: false,
    };
  }

  const byId = new Map(positions.map((p) => [p.id, p]));
  const children = new Map<string | null, ChartPosition[]>();
  for (const p of positions) {
    if (p.isAdvisor) continue;
    const parent = p.reportsToId && byId.has(p.reportsToId) ? p.reportsToId : null;
    children.set(parent, [...(children.get(parent) ?? []), p]);
  }
  for (const list of children.values()) list.sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));

  const mine = positions.filter((p) => p.userId === viewerId && !p.isAdvisor);
  const scopeOptions = isAdmin
    ? [
        { id: "all", label: "Whole chart" },
        ...positions
          .filter((p) => !p.isAdvisor)
          .map((p) => ({ id: p.id, label: `${p.title}${p.user?.name ? ` (${p.user.name})` : p.personName ? ` (${p.personName})` : ""}` })),
      ]
    : [];

  let scope = "all";
  if (input.requestedScope && isAdmin && (input.requestedScope === "all" || byId.has(input.requestedScope))) {
    scope = input.requestedScope;
  } else if (mine.length > 0) {
    scope = mine[0]!.id;
  } else if (!isAdmin) {
    scope = "none";
  }

  // Depth-first from the scope's root(s), advisors excluded.
  const ordered: { position: ChartPosition; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (p: ChartPosition, depth: number) => {
    if (seen.has(p.id)) return;
    seen.add(p.id);
    ordered.push({ position: p, depth });
    for (const c of children.get(p.id) ?? []) walk(c, depth + 1);
  };
  if (scope === "all") for (const root of children.get(null) ?? []) walk(root, 0);
  else if (scope !== "none") walk(byId.get(scope)!, 0);

  const inScope = new Set(ordered.map((o) => o.position.id));
  const advisorPositions = positions.filter((p) => p.isAdvisor && p.reportsToId && inScope.has(p.reportsToId));

  const ownerIds = [
    ...new Set(
      [...ordered.map((o) => o.position.userId), ...advisorPositions.map((p) => p.userId)].filter(
        (u): u is string => Boolean(u),
      ),
    ),
  ];
  const positioned = new Set(positions.map((p) => p.userId).filter((u): u is string => Boolean(u)));

  const tasks = await getOpenTasksByOwners(db, organizationId, ownerIds);
  const byOwner = groupByOwner(tasks);

  const lane = (p: ChartPosition, depth: number): TeamLane => ({
    key: p.id,
    positionTitle: p.title,
    person: p.user,
    personName: p.user?.name ?? p.personName,
    isOpen: p.isOpen,
    depth,
    tasks: p.userId ? (byOwner.get(p.userId) ?? []) : [],
  });

  let unpositioned: TaskListItem[] | null = null;
  if (scope === "all") {
    unpositioned = await getOpenTasksByOwners(db, organizationId, [], {
      includeUnowned: true,
      excludeOwners: [...positioned],
    });
  }

  return {
    hasChart: true,
    scope,
    scopeOptions,
    lanes: ordered.map((o) => lane(o.position, o.depth)),
    advisors: advisorPositions.map((p) => lane(p, 0)),
    unpositioned,
    offChart: scope === "none",
  };
}

function groupByOwner(tasks: TaskListItem[]): Map<string, TaskListItem[]> {
  const out = new Map<string, TaskListItem[]>();
  for (const t of tasks) {
    if (!t.ownerId) continue;
    out.set(t.ownerId, [...(out.get(t.ownerId) ?? []), t]);
  }
  return out;
}
