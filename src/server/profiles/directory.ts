import { Prisma, type Role } from "@/generated/prisma/client";
import { can } from "@/lib/auth/permissions";
import { chartTeams, parseNamedTeams, type ChartTeams } from "@/lib/org-chart/teams";
import { parseStoredLinks, type ProfileLink } from "@/lib/profile/links";
import { effectiveTimezone } from "@/lib/profile/timezone";
import { parseQuery } from "@/lib/search/text";
import { dueDateKey, localDateKey } from "@/lib/tasks/dates";
import { withOrgTx } from "@/server/db/context";
import { userPublicSelect } from "@/server/members";
import { getOpenTasks } from "@/server/org-chart/service";

import { isFreeNow } from "./presence";
import { termTrigrams } from "./trigrams";

/**
 * The people directory (Moonstone 12.1) and the profile sheet (12.2).
 *
 * Every read runs in the viewer's withOrgTx (app_user, RLS): a non-member
 * is refused before anything is read, the Membership join keeps former
 * members and other orgs' users out, and busy hours come only through
 * app.member_busy_hours (the org's setting, admins, the person), with
 * app.member_availability_shared saying whether there is anything to see
 * (a member who never filled it in is not "free now"). Emails
 * are selected only when the viewer may see them (the person themselves,
 * owners and admins, or everyone when Privacy > "Members see each other's
 * emails" is on), exactly as Settings > Members decides.
 */

type Db = Prisma.TransactionClient;

/** The most members the directory loads at once (search still covers everyone). */
export const DIRECTORY_LIMIT = 2000;
/** A "close match" needs every typed word this similar to something (pg_trgm word_similarity). */
export const CLOSE_MATCH_THRESHOLD = 0.3;
/** The same for the hand-rolled score (the share of a word's trigrams found). */
export const FALLBACK_CLOSE_MATCH_THRESHOLD = 0.5;
const CLOSE_MATCH_LIMIT = 50;

export interface DirectoryPerson {
  id: string;
  name: string | null;
  image: string | null;
  avatar: Prisma.JsonValue | null;
  pronouns: string | null;
  major: string | null;
  gradYear: number | null;
  role: Role;
  /** This org's title. */
  title: string | null;
  /** ISO timestamp of joining this org. */
  joinedAt: string;
  /** The chart team (ChartTeam.key), or null when not on the published chart. */
  teamKey: string | null;
  /** null when the viewer may not see their busy hours, or they never shared any. */
  freeNow: boolean | null;
}

export interface DirectoryTeam {
  key: string;
  name: string;
  /** var(--chart-{slot}). */
  slot: number;
}

export interface Directory {
  people: DirectoryPerson[];
  /** Teams in chart order (those with at least one member). */
  teams: DirectoryTeam[];
  /** Every current member, even past DIRECTORY_LIMIT. */
  total: number;
}

const ROLE_WORDS: Record<Role, string> = {
  OWNER: "owner",
  ADMIN: "admin",
  TREASURER: "treasurer",
  MEMBER: "member",
};

// ---------------------------------------------------------------- teams

export interface ChartForPeople {
  teams: ChartTeams;
  positions: {
    id: string;
    title: string;
    userId: string | null;
    personName: string | null;
    reportsToId: string | null;
    alsoReportsToIds: string[];
    isAdvisor: boolean;
    isOpen: boolean;
    rank: string;
    key: string;
    user: { id: string; name: string | null; image: string | null; avatar: Prisma.JsonValue | null } | null;
  }[];
}

/** The published chart's positions (RLS: members read only the published version) and its teams. */
export async function loadChartForPeople(db: Db, organizationId: string): Promise<ChartForPeople> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { activeOrgChartVersionId: true },
  });
  const versionId = org?.activeOrgChartVersionId;
  const positions = versionId
    ? await db.orgChartPosition.findMany({
        where: { organizationId, versionId },
        orderBy: [{ rank: "asc" }, { id: "asc" }],
        select: {
          id: true,
          key: true,
          title: true,
          userId: true,
          personName: true,
          reportsToId: true,
          alsoReportsToIds: true,
          isAdvisor: true,
          isOpen: true,
          rank: true,
          teamId: true,
          user: { select: userPublicSelect },
        },
      })
    : [];
  const named = versionId
    ? parseNamedTeams(
        (
          await db.orgChartVersion.findFirst({
            where: { id: versionId, organizationId },
            select: { teams: true },
          })
        )?.teams,
      )
    : [];
  return { positions, teams: chartTeams(positions, named) };
}

function teamNamesByUser(teams: ChartTeams): Map<string, string> {
  const names = new Map(teams.teams.map((t) => [t.key, t.name]));
  return new Map([...teams.teamOfUser].map(([userId, key]) => [userId, names.get(key) ?? ""]));
}

// ---------------------------------------------------------------- directory

/** Every current member of the org for the directory, with team and "free now". */
export async function loadDirectory(
  organizationId: string,
  orgTimezone: string,
  now: Date = new Date(),
): Promise<Directory> {
  return withOrgTx(organizationId, async ({ db }) => {
    const total = await db.membership.count({ where: { organizationId } });
    const rows = await db.membership.findMany({
      where: { organizationId },
      orderBy: [{ user: { name: { sort: "asc", nulls: "last" } } }, { userId: "asc" }],
      take: DIRECTORY_LIMIT,
      select: {
        role: true,
        title: true,
        joinedAt: true,
        user: {
          select: { ...userPublicSelect, pronouns: true, major: true, gradYear: true, timezone: true },
        },
      },
    });
    const busyRows = await db.$queryRaw<
      { id: string; busy: string[] | null; shared: boolean | null }[]
    >`
      SELECT m."userId" AS id, app.member_busy_hours(m."userId") AS busy,
             app.member_availability_shared(m."userId") AS shared
        FROM "Membership" m
       WHERE m."organizationId" = ${organizationId}`;
    const busy = new Map(busyRows.map((r) => [r.id, r]));
    const chart = await loadChartForPeople(db, organizationId);
    const people: DirectoryPerson[] = rows.map(({ user, role, title, joinedAt }) => {
      const { timezone, ...rest } = user;
      return {
        ...rest,
        role,
        title,
        joinedAt: joinedAt.toISOString(),
        teamKey: chart.teams.teamOfUser.get(user.id) ?? null,
        freeNow: isFreeNow(
          busy.get(user.id) ?? { busy: null, shared: null },
          effectiveTimezone({ timezone }, { timezone: orgTimezone }),
          now,
        ),
      };
    });
    const used = new Set(people.map((p) => p.teamKey));
    const teams = chart.teams.teams
      .filter((t) => used.has(t.key))
      .map((t) => ({ key: t.key, name: t.name, slot: t.slot }));
    return { people, teams, total };
  });
}

// ---------------------------------------------------------------- search

export interface PeopleSearchResult {
  /** Matching member ids, best first. */
  ids: string[];
  /** Nothing matched every word, so these are the close (typo-tolerant) matches. */
  close: boolean;
}

/**
 * Search as you type, in the database: each typed word must appear in the
 * member's name, this org's title, team, major, year ("2027", "class of
 * 2027"), pronouns or role. When nothing matches exactly, the close matches
 * are the members for whom every word is at least CLOSE_MATCH_THRESHOLD
 * similar to a word of theirs (pg_trgm word_similarity), so "mya" finds
 * Maya and "jakson" finds Jackson. Runs in the caller's RLS transaction and
 * only ever reads this org's memberships.
 */
export async function searchPeopleInTx(db: Db, organizationId: string, query: string): Promise<PeopleSearchResult> {
  const terms = parseQuery(query).terms;
  if (terms.length === 0) return { ids: [], close: false };
  const chart = await loadChartForPeople(db, organizationId);
  const teamOf = teamNamesByUser(chart.teams);
  const teamUserIds = [...teamOf.keys()];
  const teamNames = teamUserIds.map((id) => teamOf.get(id) ?? "");
  const roleCase = Prisma.sql`CASE m."role"
      WHEN 'OWNER' THEN ${ROLE_WORDS.OWNER}
      WHEN 'ADMIN' THEN ${ROLE_WORDS.ADMIN}
      WHEN 'TREASURER' THEN ${ROLE_WORDS.TREASURER}
      ELSE ${ROLE_WORDS.MEMBER} END`;
  const trgm = await canUseTrigrams(db);
  // pg_trgm's word_similarity when the runtime role may call it; otherwise
  // the same idea by hand: the share of a typed word's trigrams (padded as
  // pg_trgm pads them) found in the member's best-matching word.
  const { grams, gramTerms } = termTrigrams(terms);
  const score = trgm
    ? Prisma.sql`(SELECT min(word_similarity(term, h.text)) FROM unnest(${terms}::text[]) AS term)`
    : Prisma.sql`(SELECT min(per_term.best) FROM (
          SELECT gt.term, max(per_word.hits / gt.n) AS best
            FROM (SELECT g.term, count(*)::float8 AS n
                    FROM unnest(${grams}::text[], ${gramTerms}::int[]) AS g(gram, term)
                   GROUP BY g.term) gt
            CROSS JOIN LATERAL (
              SELECT w.word, count(*) FILTER (WHERE strpos('  ' || w.word || ' ', g.gram) > 0) AS hits
                FROM regexp_split_to_table(h.text, '[^[:alnum:]]+') AS w(word)
                CROSS JOIN unnest(${grams}::text[], ${gramTerms}::int[]) AS g(gram, term)
               WHERE g.term = gt.term AND w.word <> ''
               GROUP BY w.word) per_word
           GROUP BY gt.term) per_term)`;
  const threshold = trgm ? CLOSE_MATCH_THRESHOLD : FALLBACK_CLOSE_MATCH_THRESHOLD;
  const rows = await db.$queryRaw<{ id: string; exact: boolean; score: number }[]>`
    WITH teams(user_id, team) AS (
      SELECT * FROM unnest(${teamUserIds}::text[], ${teamNames}::text[])
    ),
    base AS (
      SELECT m."userId" AS id,
             u."name" AS name,
             lower(concat_ws(' ', u."name", m."title", t.team, u."major", u."gradYear"::text,
                             'class of ' || u."gradYear"::text, u."pronouns", ${roleCase})) AS text
        FROM "Membership" m
        JOIN "User" u ON u."id" = m."userId"
        LEFT JOIN teams t ON t.user_id = m."userId"
       WHERE m."organizationId" = ${organizationId}
    ),
    scored AS (
      SELECT h.id, h.name,
             (SELECT bool_and(strpos(h.text, term) > 0) FROM unnest(${terms}::text[]) AS term) AS exact,
             ${score} AS score
        FROM base h
    )
    SELECT id, exact, score::float8 AS score
      FROM scored
     WHERE exact OR score >= ${threshold}
     ORDER BY exact DESC, score DESC, name ASC NULLS LAST, id ASC
     LIMIT ${DIRECTORY_LIMIT}`;
  const exact = rows.filter((r) => r.exact);
  if (exact.length > 0) return { ids: exact.map((r) => r.id), close: false };
  return { ids: rows.slice(0, CLOSE_MATCH_LIMIT).map((r) => r.id), close: rows.length > 0 };
}

/**
 * Whether the runtime role may call pg_trgm's functions. The extension is
 * installed in public, but EXECUTE on its functions is not granted to
 * app_user yet; until it is, search uses the hand-rolled trigram score.
 */
async function canUseTrigrams(db: Db): Promise<boolean> {
  const rows = await db.$queryRaw<{ ok: boolean | null }[]>`
    SELECT CASE WHEN to_regprocedure('public.word_similarity(text,text)') IS NULL THEN false
                ELSE has_function_privilege('public.word_similarity(text,text)', 'EXECUTE') END AS ok`;
  return rows[0]?.ok === true;
}

/** searchPeopleInTx for the session user (withOrgTx refuses a non-member). */
export async function searchPeople(organizationId: string, query: string): Promise<PeopleSearchResult> {
  return withOrgTx(organizationId, ({ db }) => searchPeopleInTx(db, organizationId, query));
}

// ---------------------------------------------------------------- profile sheet

export interface SheetPositionRef {
  key: string;
  title: string;
  /** The person in it: a member's name, a placeholder name, or null (open). */
  person: string | null;
  userId: string | null;
}

export interface SheetTask {
  id: string;
  title: string;
  /** "2026-10-21", or null. */
  dueKey: string | null;
}

export interface PersonSheet {
  id: string;
  name: string | null;
  image: string | null;
  avatar: Prisma.JsonValue | null;
  pronouns: string | null;
  major: string | null;
  gradYear: number | null;
  bio: string | null;
  links: ProfileLink[];
  role: Role;
  title: string | null;
  joinedAt: string;
  /** Only when the viewer may see it (see the module comment). */
  email: string | null;
  /** null when the viewer may not see their busy hours. */
  busy: string[] | null;
  /** Whether they ever shared their availability (null when the viewer may not see it). */
  availabilityShared: boolean | null;
  freeNow: boolean | null;
  /** Their effective time zone (busy hours are in it). */
  timezone: string;
  team: DirectoryTeam | null;
  /** Their positions on the published chart, in chart order. */
  positions: { key: string; title: string; isAdvisor: boolean }[];
  reportsTo: SheetPositionRef[];
  /** Extra managers (dotted lines on the chart). */
  alsoReportsTo: SheetPositionRef[];
  leads: SheetPositionRef[];
  tasks: SheetTask[];
  taskCount: number;
  /** Today in the org's time zone, for due labels. */
  todayKey: string;
}

export interface SheetViewer {
  id: string;
  role: Role;
  /** OrgSettings.showMemberEmailsToMembers. */
  membersSeeEmails: boolean;
}

function canSeeEmail(viewer: SheetViewer, personId: string): boolean {
  return viewer.id === personId || can({ role: viewer.role }, "members.viewEmails") || viewer.membersSeeEmails;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Everything the profile sheet and the person page show, or null when
 * `userId` is not a current member of the org (another org's user, a
 * former member, or no such user).
 */
export async function getPersonSheet(
  organizationId: string,
  userId: string,
  viewer: SheetViewer,
  orgTimezone: string,
  now: Date = new Date(),
): Promise<PersonSheet | null> {
  if (!ID.test(userId)) return null;
  const withEmail = canSeeEmail(viewer, userId);
  return withOrgTx(organizationId, async ({ db }) => {
    const membership = await db.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: {
        role: true,
        title: true,
        joinedAt: true,
        user: {
          select: {
            ...userPublicSelect,
            pronouns: true,
            major: true,
            gradYear: true,
            bio: true,
            links: true,
            timezone: true,
            email: withEmail,
          },
        },
      },
    });
    if (!membership) return null;
    const { user } = membership;
    const busyRows = await db.$queryRaw<{ busy: string[] | null; shared: boolean | null }[]>`
      SELECT app.member_busy_hours(${userId}) AS busy,
             app.member_availability_shared(${userId}) AS shared`;
    const busy = busyRows[0]?.busy ?? null;
    const availabilityShared = busyRows[0]?.shared ?? null;
    const timezone = effectiveTimezone({ timezone: user.timezone }, { timezone: orgTimezone });

    const chart = await loadChartForPeople(db, organizationId);
    const byId = new Map(chart.positions.map((p) => [p.id, p]));
    const ref = (p: (typeof chart.positions)[number]): SheetPositionRef => ({
      key: p.key,
      title: p.title,
      person: p.isOpen ? null : (p.user?.name ?? p.personName ?? null),
      userId: p.userId,
    });
    const mine = chart.positions.filter((p) => p.userId === userId);
    const mineIds = new Set(mine.map((p) => p.id));
    const reportsTo = mine
      .map((p) => (p.reportsToId ? byId.get(p.reportsToId) : undefined))
      .filter((p): p is NonNullable<typeof p> => Boolean(p) && !mineIds.has(p!.id))
      .filter((p, i, all) => all.findIndex((q) => q.id === p.id) === i)
      .map(ref);
    const reportsToIds = new Set(reportsTo.map((r) => r.key));
    const alsoReportsTo = mine
      .flatMap((p) => p.alsoReportsToIds.flatMap((id) => byId.get(id) ?? []))
      .filter((p, i, all) => !mineIds.has(p.id) && !reportsToIds.has(p.key) && all.findIndex((q) => q.id === p.id) === i)
      .map(ref);
    const leads = chart.positions
      .filter((p) => p.reportsToId && mineIds.has(p.reportsToId) && !mineIds.has(p.id) && !p.isAdvisor)
      .map(ref);
    const teamKey = chart.teams.teamOfUser.get(userId) ?? null;
    const team = chart.teams.teams.find((t) => t.key === teamKey) ?? null;

    const open = await getOpenTasks({ db, organizationId }, userId);
    const tasks = [...open.owned, ...open.involved]
      .filter((t, i, all) => all.findIndex((x) => x.id === t.id) === i)
      .slice(0, 5)
      .map((t) => ({ id: t.id, title: t.title, dueKey: t.dueDate ? dueDateKey(t.dueDate) : null }));

    return {
      id: user.id,
      name: user.name,
      image: user.image,
      avatar: user.avatar,
      pronouns: user.pronouns,
      major: user.major,
      gradYear: user.gradYear,
      bio: user.bio,
      links: parseStoredLinks(user.links),
      role: membership.role,
      title: membership.title,
      joinedAt: membership.joinedAt.toISOString(),
      email: withEmail && "email" in user && typeof user.email === "string" ? user.email : null,
      busy,
      availabilityShared,
      freeNow: isFreeNow({ busy, shared: availabilityShared }, timezone, now),
      timezone,
      team: team ? { key: team.key, name: team.name, slot: team.slot } : null,
      positions: mine.map((p) => ({ key: p.key, title: p.title, isAdvisor: p.isAdvisor })),
      reportsTo,
      alsoReportsTo,
      leads,
      tasks,
      taskCount: open.ownedCount + open.involvedCount,
      todayKey: localDateKey(now, orgTimezone),
    };
  });
}
