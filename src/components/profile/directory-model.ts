import { NO_TEAM } from "@/lib/org-chart/teams";
import type { DirectoryPerson, DirectoryTeam } from "@/server/profiles/directory";

import { NO_TEAM_KEY, type DirectoryQuery } from "./directory-query";

/**
 * The directory's pure list logic: the instant local match shown while
 * the server search is on its way, the filters, the four sorts and the
 * groups (teams, letters, one "newest first" run, or online and then
 * everyone else by when they were last here). Client-safe.
 */

export const ROLE_WORDS = { OWNER: "owner", ADMIN: "admin", TREASURER: "treasurer", MEMBER: "member" } as const;

export function teamName(person: Pick<DirectoryPerson, "teamKey">, teams: ReadonlyMap<string, DirectoryTeam>): string {
  return (person.teamKey && teams.get(person.teamKey)?.name) || NO_TEAM;
}

function hay(p: DirectoryPerson, teams: ReadonlyMap<string, DirectoryTeam>): string {
  return [
    p.name,
    p.title,
    p.teamKey ? teams.get(p.teamKey)?.name : null,
    p.major,
    p.gradYear ? `${p.gradYear} class of ${p.gradYear}` : null,
    p.pronouns,
    ROLE_WORDS[p.role],
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Every word of `q` somewhere in the person's fields (the instant preview). */
export function localMatch(
  people: readonly DirectoryPerson[],
  q: string,
  teams: ReadonlyMap<string, DirectoryTeam>,
): DirectoryPerson[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...people];
  return people.filter((p) => {
    const h = hay(p, teams);
    return words.every((w) => h.includes(w));
  });
}

export function applyFilters(people: readonly DirectoryPerson[], query: DirectoryQuery): DirectoryPerson[] {
  return people.filter(
    (p) =>
      (!query.team || (query.team === NO_TEAM_KEY ? p.teamKey === null : p.teamKey === query.team)) &&
      (!query.role || p.role === query.role) &&
      (!query.year || p.gradYear === query.year) &&
      (!query.free || p.freeNow === true) &&
      (!query.online || p.online),
  );
}

export interface PeopleGroup {
  key: string;
  label: string;
  /** var(--chart-N) for a team. */
  color: string | null;
  people: DirectoryPerson[];
}

const byName = (a: DirectoryPerson, b: DirectoryPerson) =>
  (a.name ?? "￿").localeCompare(b.name ?? "￿", undefined, { sensitivity: "base" }) ||
  (a.id < b.id ? -1 : 1);

export function letterOf(p: Pick<DirectoryPerson, "name">): string {
  const ch = (p.name ?? "").trim().charAt(0).normalize("NFD").charAt(0).toUpperCase();
  return /[A-Z]/.test(ch) ? ch : "#";
}

/**
 * Groups for the sort. `ranked` keeps the given order inside each group
 * (search relevance); otherwise team groups sort by name.
 */
export function groupPeople(
  people: readonly DirectoryPerson[],
  sort: DirectoryQuery["sort"],
  teams: readonly DirectoryTeam[],
  { ranked = false }: { ranked?: boolean } = {},
): PeopleGroup[] {
  if (sort === "new") {
    const list = [...people].sort((a, b) => (a.joinedAt < b.joinedAt ? 1 : a.joinedAt > b.joinedAt ? -1 : byName(a, b)));
    return list.length ? [{ key: "new", label: "Newest first", color: null, people: list }] : [];
  }
  if (sort === "active") {
    // Online first by name, then everyone else by when they were last here.
    const online = people.filter((p) => p.online).sort(byName);
    const away = people
      .filter((p) => !p.online)
      .sort((a, b) =>
        a.lastSeenAt === b.lastSeenAt
          ? byName(a, b)
          : !a.lastSeenAt
            ? 1
            : !b.lastSeenAt
              ? -1
              : a.lastSeenAt < b.lastSeenAt
                ? 1
                : -1,
      );
    return [
      ...(online.length ? [{ key: "online", label: "Online now", color: "var(--success)", people: online }] : []),
      ...(away.length ? [{ key: "away", label: "Not online", color: null, people: away }] : []),
    ];
  }
  if (sort === "name") {
    const list = [...people].sort(byName);
    const groups = new Map<string, DirectoryPerson[]>();
    for (const p of list) {
      const l = letterOf(p);
      groups.set(l, [...(groups.get(l) ?? []), p]);
    }
    return [...groups]
      .sort(([a], [b]) => (a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b)))
      .map(([letter, list]) => ({ key: `letter-${letter}`, label: letter, color: null, people: list }));
  }
  const out: PeopleGroup[] = [];
  for (const t of teams) {
    const list = people.filter((p) => p.teamKey === t.key);
    if (list.length) {
      out.push({
        key: `team-${t.key}`,
        label: t.name,
        color: `var(--chart-${((t.slot - 1) % 5) + 1})`,
        people: ranked ? list : list.sort(byName),
      });
    }
  }
  const known = new Set(teams.map((t) => t.key));
  const rest = people.filter((p) => !p.teamKey || !known.has(p.teamKey));
  if (rest.length) out.push({ key: "team-none", label: NO_TEAM, color: null, people: ranked ? rest : rest.sort(byName) });
  return out;
}
