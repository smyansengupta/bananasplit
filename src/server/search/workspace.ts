import type { Prisma } from "@/generated/prisma/client";
import type { Role, TaskStatus } from "@/generated/prisma/enums";
import { can } from "@/lib/auth/permissions";
import { formatEventWhen } from "@/lib/calendar/format";
import { DELETED_TRANSACTION_REASON } from "@/lib/finance/deleted";
import { formatCents, parseDollarsToCents } from "@/lib/finance/money";
import { formatFinanceDate } from "@/lib/finance/stats";
import { SECTIONS, type SectionId } from "@/lib/nav/sidebar";
import { ago } from "@/lib/relative-time";
import {
  containsPatterns,
  excerptAround,
  openingLine,
  parseQuery,
  prefixTsQuery,
  scoreFields,
  type ParsedQuery,
} from "@/lib/search/text";
import {
  GROUP_LABELS,
  GROUP_SCOPE,
  GROUP_SECTION,
  SERVER_GROUPS,
  type SearchGroup,
  type SearchHit,
  type SearchKind,
  type SearchResponse,
  type SearchScope,
  type ServerGroupId,
} from "@/lib/search/types";
import { dueDateKey, formatDueKey } from "@/lib/tasks/dates";
import type { TxClient } from "@/server/db/context";
import { listRecent } from "@/server/pins";

import { everyWord } from "./where";

/**
 * Workspace search for the ⌘K palette: notes (full text, prefix-matched),
 * files, folders, tasks, projects and labels, events, polls, people,
 * org-chart roles, databases and finance, as the member under RLS.
 *
 * Every query runs in the caller's transaction (one connection, so one
 * after another), each capped, so a search costs a dozen small indexed
 * reads. The database finds records where every word occurs somewhere;
 * scoreFields() then ranks them, the same way for every kind, so the
 * palette can order whole groups by their best hit.
 *
 * What the database does not enforce, this does: finance beyond the
 * member's own expenses only for owners and treasurers (the RLS policy
 * lets any member read the ledger; the pages gate it), member emails only
 * for admins, and sections the org hid only for owners and admins.
 */

export interface SearchViewer {
  orgId: string;
  orgSlug: string;
  userId: string;
  role: Role;
  /** IANA zones: the viewer's own (or the org's), and the org's. */
  zones: { viewer: string; org: string };
  /** Sections the org turned off in Settings › Sidebar. */
  hiddenSections: ReadonlySet<SectionId>;
  /** The published org chart, if any. */
  orgChartVersionId: string | null;
}

/** Hits per group in "All"; a filtered search shows more. */
const ALL_LIMIT = 5;
const SCOPED_LIMIT = 20;

interface Ctx {
  db: TxClient;
  viewer: SearchViewer;
  q: ParsedQuery;
  /** True with no words: list the latest of a kind instead (a filter chip, no query). */
  browsing: boolean;
  limit: number;
  /** How many rows to rank before keeping `limit`. */
  pool: number;
  base: string;
  now: Date;
}

function join(...parts: (string | null | undefined | false)[]): string | null {
  const kept = parts.filter((p): p is string => Boolean(p && p.trim()));
  return kept.length ? kept.join(" · ") : null;
}

function hit(kind: SearchKind, id: string, fields: Omit<SearchHit, "key" | "kind">): SearchHit {
  return { key: `${kind}:${id}`, kind, ...fields };
}

/** Best first; ties keep the database's order (most recent first). */
function rank<T extends { score: number }>(rows: T[], limit: number): T[] {
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => b.row.score - a.row.score || a.i - b.i)
    .slice(0, limit)
    .map(({ row }) => row);
}

/** Merges two result lists by id, the first list's rows first. */
function unique<T extends { id: string }>(first: T[], second: T[]): T[] {
  const seen = new Set(first.map((r) => r.id));
  return [...first, ...second.filter((r) => !seen.has(r.id))];
}

function group(id: ServerGroupId, hits: SearchHit[], more?: SearchGroup["more"]): SearchGroup {
  return { id, label: GROUP_LABELS[id], hits, more: more ?? null };
}

function moreLink(ctx: Ctx, path: string, what: string): SearchGroup["more"] {
  if (ctx.browsing) return null;
  const sep = path.includes("?") ? "&" : "?";
  return {
    href: `${ctx.base}${path}${sep}q=${encodeURIComponent(ctx.q.text)}`,
    label: `Search all ${what} for “${ctx.q.text}”`,
  };
}

// ---------------------------------------------------------------- notes

interface NoteRow {
  id: string;
  title: string;
  visibility: "PRIVATE" | "ORGANIZATION";
  updatedAt: Date;
  folderName: string | null;
  rank: number;
  /** The best passage of the body (ts_headline), or its opening when browsing. */
  passage: string | null;
  /** Where the passage starts in the body (1-based; 0 if not found), and the body's length. */
  passageAt: number;
  bodyLength: number;
}

/**
 * Notes: the body through the full-text index with every word as a prefix
 * ("quart" finds "quarterly"), or every word anywhere in the title or body
 * (inside a word, or a stop word the index drops). PRIVATE notes only for
 * their author, as RLS already guarantees. Raw SQL for the tsvector; every
 * value is a bound parameter.
 */
async function searchNotes(ctx: Ctx): Promise<SearchGroup> {
  const { db, viewer, q } = ctx;
  let rows: NoteRow[];
  if (ctx.browsing) {
    rows = await db.$queryRaw<NoteRow[]>`
      SELECT n.id, n.title, n.visibility, n."updatedAt", f.name AS "folderName",
             0::float8 AS rank, left(n."contentText", 400) AS passage,
             1 AS "passageAt", length(n."contentText") AS "bodyLength"
      FROM "Note" n
      LEFT JOIN "NoteFolder" f ON f.id = n."folderId"
      WHERE n."organizationId" = ${viewer.orgId}
        AND n."deletedAt" IS NULL
        AND (n.visibility = 'ORGANIZATION' OR n."authorId" = ${viewer.userId})
      ORDER BY n."updatedAt" DESC
      LIMIT ${ctx.limit}
    `;
  } else {
    const tsq = prefixTsQuery(q.terms)!;
    // The passage shows where any of the words is: some may be in the title only.
    const passageQuery = prefixTsQuery(q.terms, { any: true })!;
    const patterns = containsPatterns(q.terms);
    rows = await db.$queryRaw<NoteRow[]>`
      SELECT n.id, n.title, n.visibility, n."updatedAt", f.name AS "folderName", n.rank,
             h.passage, strpos(n."contentText", h.passage) AS "passageAt",
             length(n."contentText") AS "bodyLength"
      FROM (
        SELECT id, title, visibility, "updatedAt", "folderId", "contentText",
               ts_rank("searchVector", to_tsquery('english', ${tsq}))::float8 AS rank,
               NOT EXISTS (
                 SELECT 1 FROM unnest(${patterns}::text[]) AS p(pattern) WHERE title NOT ILIKE p.pattern
               ) AS "titleHit"
        FROM "Note"
        WHERE "organizationId" = ${viewer.orgId}
          AND "deletedAt" IS NULL
          AND (visibility = 'ORGANIZATION' OR "authorId" = ${viewer.userId})
          AND (
            "searchVector" @@ to_tsquery('english', ${tsq})
            OR NOT EXISTS (
              SELECT 1 FROM unnest(${patterns}::text[]) AS p(pattern)
              WHERE NOT (title ILIKE p.pattern OR "contentText" ILIKE p.pattern)
            )
          )
        ORDER BY "titleHit" DESC, rank DESC, "updatedAt" DESC
        LIMIT ${ctx.pool}
      ) n
      CROSS JOIN LATERAL (
        SELECT ts_headline('english', n."contentText", to_tsquery('english', ${passageQuery}),
                           'MaxFragments=1, MaxWords=30, MinWords=12, StartSel="", StopSel=""') AS passage
      ) h
      LEFT JOIN "NoteFolder" f ON f.id = n."folderId"
      ORDER BY n."titleHit" DESC, n.rank DESC, n."updatedAt" DESC
    `;
  }

  const hits = rows.map((n) => {
    const title = n.title.trim() || "Untitled note";
    const passage = n.passage ?? "";
    // The passage is a fragment of the body: mark where it was cut from it.
    const at = Number(n.passageAt);
    const framed = `${at > 1 ? "…" : ""}${passage}${at > 0 && at - 1 + passage.length < Number(n.bodyLength) ? "…" : ""}`;
    const matched = ctx.browsing ? null : excerptAround(framed, q.folded, 150);
    const detail = matched ?? openingLine(framed, 140);
    return hit("note", n.id, {
      title,
      href: `${ctx.base}/notes/${n.id}`,
      detail,
      meta: join(n.folderName, n.visibility === "PRIVATE" && "Private"),
      score: ctx.browsing
        ? 0
        : scoreFields(
            [
              { text: title, weight: 3 },
              { text: passage, weight: 1 },
            ],
            q,
          ) +
          Number(n.rank) * 10,
    });
  });
  return group(
    "notes",
    ctx.browsing ? hits : rank(hits, ctx.limit),
    moreLink(ctx, "/notes", "notes"),
  );
}

async function searchFolders(ctx: Ctx): Promise<SearchGroup> {
  const { db, viewer, q } = ctx;
  const rows = await db.noteFolder.findMany({
    where: {
      organizationId: viewer.orgId,
      ...everyWord<Prisma.NoteFolderWhereInput>(q.terms, (c) => [{ name: c }]),
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, _count: { select: { notes: { where: { deletedAt: null } } } } },
    take: ctx.pool,
  });
  const hits = rows.map((f) =>
    hit("folder", f.id, {
      title: f.name,
      href: `${ctx.base}/notes?folder=${f.id}`,
      detail: "Notes folder",
      meta: `${f._count.notes} ${f._count.notes === 1 ? "note" : "notes"}`,
      score: scoreFields([{ text: f.name, weight: 3 }], q),
    }),
  );
  return group("folders", rank(hits, ctx.limit));
}

async function searchFiles(ctx: Ctx): Promise<SearchGroup> {
  const { db, viewer, q } = ctx;
  const rows = await db.orgFile.findMany({
    where: {
      organizationId: viewer.orgId,
      deletedAt: null,
      ...everyWord<Prisma.OrgFileWhereInput>(q.terms, (c) => [
        { name: c },
        { excerpt: c },
        { folder: { name: c } },
      ]),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, excerpt: true, folder: { select: { name: true } } },
    take: ctx.pool,
  });
  const hits = rows.map((f) => {
    const ext = /\.([A-Za-z0-9]{1,5})$/.exec(f.name)?.[1]?.toUpperCase();
    return hit("file", f.id, {
      title: f.name,
      href: `${ctx.base}/notes/files/${f.id}`,
      detail: excerptAround(f.excerpt, q.folded) ?? f.folder?.name ?? "File",
      meta: ext ?? null,
      score: scoreFields(
        [
          { text: f.name, weight: 3 },
          { text: f.excerpt, weight: 1 },
          { text: f.folder?.name, weight: 1 },
        ],
        q,
      ),
    });
  });
  return group("files", rank(hits, ctx.limit), moreLink(ctx, "/notes?tab=files", "files"));
}

// ---------------------------------------------------------------- tasks

const STATUS_LABEL: Record<TaskStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  COMPLETED: "Done",
};

const taskSelect = {
  id: true,
  title: true,
  description: true,
  status: true,
  dueDate: true,
  visibility: true,
  parentTaskId: true,
  project: { select: { name: true } },
  owner: { select: { name: true } },
  labels: { select: { label: { select: { name: true } } } },
} satisfies Prisma.TaskSelect;

/**
 * Tasks by title, description, project, label or owner. Private tasks
 * reach only their own people and admins (RLS). Title matches are read
 * first, so an exact name is never pushed out by newer tasks that merely
 * mention the words.
 */
async function searchTasks(ctx: Ctx): Promise<SearchGroup> {
  const { db, viewer, q } = ctx;
  const live: Prisma.TaskWhereInput = { organizationId: viewer.orgId, deletedAt: null };
  let rows;
  if (ctx.browsing) {
    rows = await db.task.findMany({
      where: { ...live, status: { not: "COMPLETED" } },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
      select: taskSelect,
      take: ctx.limit,
    });
  } else {
    const byTitle = await db.task.findMany({
      where: { ...live, ...everyWord<Prisma.TaskWhereInput>(q.terms, (c) => [{ title: c }]) },
      orderBy: { updatedAt: "desc" },
      select: taskSelect,
      take: ctx.limit * 2,
    });
    const anywhere = await db.task.findMany({
      where: {
        ...live,
        ...everyWord<Prisma.TaskWhereInput>(q.terms, (c) => [
          { title: c },
          { description: c },
          { project: { name: c } },
          { labels: { some: { label: { name: c } } } },
          { owner: { name: c } },
        ]),
      },
      orderBy: { updatedAt: "desc" },
      select: taskSelect,
      take: ctx.pool,
    });
    rows = unique(byTitle, anywhere);
  }

  const hits = rows.map((t) => {
    const labels = t.labels.map((l) => l.label.name).join(" ");
    const score = scoreFields(
      [
        { text: t.title, weight: 3 },
        { text: t.description, weight: 1 },
        { text: t.project?.name, weight: 1 },
        { text: labels, weight: 1 },
        { text: t.owner?.name, weight: 1 },
      ],
      q,
    );
    return hit("task", t.id, {
      title: t.title,
      href: `${ctx.base}/tasks/${t.id}`,
      detail:
        excerptAround(t.description, q.folded) ??
        join(
          t.project?.name,
          t.owner?.name,
          t.parentTaskId && "Subtask",
          t.visibility === "PRIVATE" && "Private",
        ),
      meta:
        t.status === "COMPLETED"
          ? "Done"
          : t.dueDate
            ? `Due ${formatDueKey(dueDateKey(t.dueDate), dueDateKey(ctx.now))}`
            : STATUS_LABEL[t.status],
      // Finished work ranks below open work that matches as well.
      score: t.status === "COMPLETED" ? score * 0.75 : score,
    });
  });
  return group(
    "tasks",
    ctx.browsing ? hits : rank(hits, ctx.limit),
    moreLink(ctx, "/tasks?view=table&scope=all", "tasks"),
  );
}

async function searchProjects(ctx: Ctx): Promise<SearchGroup> {
  const { db, viewer, q } = ctx;
  const projects = await db.project.findMany({
    where: {
      organizationId: viewer.orgId,
      archivedAt: null,
      ...everyWord<Prisma.ProjectWhereInput>(q.terms, (c) => [{ name: c }, { description: c }]),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, description: true, isIntake: true },
    take: ctx.pool,
  });
  const labels = await db.label.findMany({
    where: {
      organizationId: viewer.orgId,
      ...everyWord<Prisma.LabelWhereInput>(q.terms, (c) => [{ name: c }]),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
    take: ctx.pool,
  });
  const hits = [
    ...projects.map((p) =>
      hit("project", p.id, {
        title: p.name,
        href: `${ctx.base}/tasks?view=board&scope=all&project=${p.id}`,
        detail: excerptAround(p.description, q.folded) ?? openingLine(p.description, 100) ?? null,
        meta: p.isIntake ? "Requests" : "Project",
        score: scoreFields(
          [
            { text: p.name, weight: 3 },
            { text: p.description, weight: 1 },
          ],
          q,
        ),
      }),
    ),
    ...labels.map((l) =>
      hit("label", l.id, {
        title: l.name,
        href: `${ctx.base}/tasks?view=table&scope=all&label=${l.id}`,
        detail: "Tasks with this label",
        meta: "Label",
        score: scoreFields([{ text: l.name, weight: 3 }], q),
      }),
    ),
  ];
  return group("projects", rank(hits, ctx.limit));
}

// ---------------------------------------------------------------- calendar

const eventSelect = {
  id: true,
  title: true,
  description: true,
  location: true,
  hostName: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  host: { select: { name: true } },
} satisfies Prisma.EventSelect;

async function searchEvents(ctx: Ctx): Promise<SearchGroup> {
  const { db, viewer, q, now } = ctx;
  const live: Prisma.EventWhereInput = {
    organizationId: viewer.orgId,
    deletedAt: null,
    mergedIntoId: null,
  };
  let rows;
  if (ctx.browsing) {
    rows = await db.event.findMany({
      where: { ...live, endsAt: { gt: now } },
      orderBy: { startsAt: "asc" },
      select: eventSelect,
      take: ctx.limit,
    });
  } else {
    const byTitle = await db.event.findMany({
      where: { ...live, ...everyWord<Prisma.EventWhereInput>(q.terms, (c) => [{ title: c }]) },
      orderBy: { startsAt: "desc" },
      select: eventSelect,
      take: ctx.limit * 2,
    });
    const anywhere = await db.event.findMany({
      where: {
        ...live,
        ...everyWord<Prisma.EventWhereInput>(q.terms, (c) => [
          { title: c },
          { description: c },
          { location: c },
          { hostName: c },
          { host: { name: c } },
        ]),
      },
      orderBy: { startsAt: "desc" },
      select: eventSelect,
      take: ctx.pool,
    });
    rows = unique(byTitle, anywhere);
  }

  const DAY_MS = 86_400_000;
  const hits = rows.map((e) => {
    const when = formatEventWhen(e, viewer.zones, now);
    const base = scoreFields(
      [
        { text: e.title, weight: 3 },
        { text: e.description, weight: 1 },
        { text: e.location, weight: 1 },
        { text: e.hostName ?? e.host?.name, weight: 1 },
      ],
      q,
    );
    // Among equal matches, the event nearest to today wins (next week's
    // meeting over last year's).
    const days = Math.abs(e.startsAt.getTime() - now.getTime()) / DAY_MS;
    return hit("event", e.id, {
      title: e.title,
      href: `${ctx.base}/calendar/${e.id}`,
      detail: join(when, e.location) ?? excerptAround(e.description, q.folded),
      meta:
        e.endsAt.getTime() > now.getTime() && e.startsAt.getTime() <= now.getTime() ? "Now" : null,
      score: base > 0 ? base + 1 / (1 + days / 30) : 0,
    });
  });
  return group("events", ctx.browsing ? hits : rank(hits, ctx.limit));
}

async function searchPolls(ctx: Ctx): Promise<SearchGroup> {
  const { db, viewer, q, now } = ctx;
  const timePolls = await db.availabilityPoll.findMany({
    where: {
      organizationId: viewer.orgId,
      ...(ctx.browsing ? { finalizedEventId: null } : {}),
      ...everyWord<Prisma.AvailabilityPollWhereInput>(q.terms, (c) => [
        { title: c },
        { description: c },
      ]),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      description: true,
      closesAt: true,
      finalizedEventId: true,
      createdAt: true,
    },
    take: ctx.pool,
  });
  const questions = await db.poll.findMany({
    where: {
      organizationId: viewer.orgId,
      ...(ctx.browsing ? { closedAt: null } : {}),
      ...everyWord<Prisma.PollWhereInput>(q.terms, (c) => [
        { question: c },
        { description: c },
        { options: { some: { label: c } } },
      ]),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      question: true,
      description: true,
      closesAt: true,
      closedAt: true,
      createdAt: true,
      options: { select: { label: true }, orderBy: { sortOrder: "asc" }, take: 12 },
    },
    take: ctx.pool,
  });

  const closed = (closesAt: Date | null) =>
    Boolean(closesAt && closesAt.getTime() <= now.getTime());
  const rows = [
    ...timePolls.map((p) => ({
      createdAt: p.createdAt,
      hit: hit("poll", p.id, {
        title: p.title,
        href: `${ctx.base}/calendar/polls/${p.id}`,
        detail: excerptAround(p.description, q.folded) ?? "Find a time",
        meta: p.finalizedEventId ? "Scheduled" : closed(p.closesAt) ? "Closed" : "Open",
        score: scoreFields(
          [
            { text: p.title, weight: 3 },
            { text: p.description, weight: 1 },
          ],
          q,
        ),
      }),
    })),
    ...questions.map((p) => {
      const options = p.options.map((o) => o.label).join(", ");
      return {
        createdAt: p.createdAt,
        hit: hit("poll", p.id, {
          title: p.question,
          href: `${ctx.base}/calendar/polls/${p.id}`,
          detail:
            excerptAround(p.description, q.folded) ??
            excerptAround(options, q.folded) ??
            "Question",
          meta: p.closedAt || closed(p.closesAt) ? "Closed" : "Open",
          score: scoreFields(
            [
              { text: p.question, weight: 3 },
              { text: p.description, weight: 1 },
              { text: options, weight: 1 },
            ],
            q,
          ),
        }),
      };
    }),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const hits = rows.map((r) => r.hit);
  return group("polls", ctx.browsing ? hits.slice(0, ctx.limit) : rank(hits, ctx.limit));
}

// ---------------------------------------------------------------- people

const ROLE_LABEL: Record<Role, string | null> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  TREASURER: "Treasurer",
  MEMBER: null,
};

/** Members by name, this org's title, major or pronouns; by email only for admins. */
async function searchPeople(ctx: Ctx): Promise<SearchGroup> {
  const { db, viewer, q } = ctx;
  const emails = can({ role: viewer.role }, "members.viewEmails");
  const rows = await db.membership.findMany({
    where: {
      organizationId: viewer.orgId,
      ...everyWord<Prisma.MembershipWhereInput>(q.terms, (c) => [
        { user: { name: c } },
        { title: c },
        { user: { major: c } },
        { user: { pronouns: c } },
        ...(emails ? [{ user: { email: c } }] : []),
      ]),
    },
    orderBy: ctx.browsing ? { joinedAt: "desc" } : { user: { name: "asc" } },
    select: {
      userId: true,
      title: true,
      role: true,
      user: { select: { name: true, major: true, gradYear: true, pronouns: true, email: true } },
    },
    take: ctx.pool,
  });
  const hits = rows.map((m) => {
    // Read for everyone, used only for those allowed to see it.
    const email = emails ? m.user.email : null;
    const name = m.user.name?.trim() || email || "Member";
    const year = m.user.gradYear ? `’${String(m.user.gradYear).slice(-2)}` : null;
    const study = [m.user.major, year].filter(Boolean).join(" ") || null;
    return hit("person", m.userId, {
      title: name,
      href: `${ctx.base}/people/${m.userId}`,
      detail: join(m.title, study, m.user.pronouns),
      meta: ROLE_LABEL[m.role],
      score: scoreFields(
        [
          { text: name, weight: 3 },
          { text: m.title, weight: 2 },
          { text: m.user.major, weight: 1 },
          { text: m.user.pronouns, weight: 1 },
          { text: email, weight: 1 },
        ],
        q,
      ),
    });
  });
  return group(
    "people",
    ctx.browsing ? hits.slice(0, ctx.limit) : rank(hits, ctx.limit),
    moreLink(ctx, "/people", "people"),
  );
}

/**
 * Roles on the published org chart: by title, who holds it, and what it is
 * responsible for ("who handles sponsors?"). A chart is small, so it is read
 * whole and matched here, where the responsibility lists can be searched.
 */
async function searchRoles(ctx: Ctx): Promise<SearchGroup> {
  const { db, viewer, q } = ctx;
  if (!viewer.orgChartVersionId) return group("roles", []);
  const rows = await db.orgChartPosition.findMany({
    where: { organizationId: viewer.orgId, versionId: viewer.orgChartVersionId },
    orderBy: [{ rank: "asc" }, { id: "asc" }],
    select: {
      id: true,
      key: true,
      title: true,
      personName: true,
      isOpen: true,
      isAdvisor: true,
      responsibilities: true,
      decidesAlone: true,
      user: { select: { name: true } },
    },
    take: 400,
  });
  const hits = rows
    .map((p) => {
      const holder = p.user?.name ?? p.personName ?? null;
      const duties = [...p.responsibilities, ...p.decidesAlone].join(" · ");
      const score = ctx.browsing
        ? 1
        : scoreFields(
            [
              { text: p.title, weight: 3 },
              { text: holder, weight: 2 },
              { text: duties, weight: 1 },
            ],
            q,
            { requireAll: true },
          );
      return hit("position", p.id, {
        title: p.title,
        href: `${ctx.base}/org-chart?position=${encodeURIComponent(p.key)}`,
        detail: join(
          p.isOpen || !holder ? "Open position" : holder,
          excerptAround(duties, q.folded, 100),
        ),
        meta: p.isAdvisor ? "Advisor" : null,
        score: ctx.browsing ? 0 : score,
      });
    })
    .filter((h) => ctx.browsing || h.score > 0);
  return group("roles", ctx.browsing ? hits.slice(0, ctx.limit) : rank(hits, ctx.limit));
}

// ---------------------------------------------------------------- data

const DATABASE_KIND: Record<string, string> = {
  ATTENDANCE: "Attendance",
  BALLOTS: "Ballots",
  SIGNUPS: "Sign-ups",
  SESSIONS: "Sessions",
  PEOPLE: "People",
  CUSTOM: "Custom",
};

async function searchDatabases(ctx: Ctx): Promise<SearchGroup> {
  const { db, viewer, q } = ctx;
  const rows = await db.databaseDefinition.findMany({
    where: {
      organizationId: viewer.orgId,
      archivedAt: null,
      ...everyWord<Prisma.DatabaseDefinitionWhereInput>(q.terms, (c) => [
        { name: c },
        { key: c },
        { tag: c },
      ]),
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { key: true, name: true, kind: true, tag: true },
    take: ctx.pool,
  });
  const hits = rows.map((d) =>
    hit("database", d.key, {
      title: d.name,
      href: `${ctx.base}/databases/${d.key}`,
      detail: join(DATABASE_KIND[d.kind] ?? null, d.tag),
      meta: null,
      score: scoreFields(
        [
          { text: d.name, weight: 3 },
          { text: d.tag, weight: 1 },
          { text: d.key, weight: 1 },
        ],
        q,
      ),
    }),
  );
  return group("databases", ctx.browsing ? hits.slice(0, ctx.limit) : rank(hits, ctx.limit));
}

const TX_STATUS: Record<string, string | null> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
  REIMBURSED: "Reimbursed",
  REJECTED: "Rejected",
  NOT_APPLICABLE: null,
};

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** "45", "$45.50", "1,200": the amount in cents, when the whole query is one. */
function amountQuery(text: string): number | null {
  if (!/^\$?\d[\d,]*(\.\d{1,2})?$/.test(text)) return null;
  try {
    const cents = parseDollarsToCents(text);
    return cents > 0 ? cents : null;
  } catch {
    return null;
  }
}

/**
 * Finance. Owners and treasurers: the ledger (description, counterparty,
 * category, or the amount itself) and sponsors. Everyone else: only their
 * own expenses, which open on My reimbursements.
 */
async function searchFinance(ctx: Ctx): Promise<SearchGroup> {
  const { db, viewer, q } = ctx;
  const manager = can({ role: viewer.role }, "finance.manage");
  const cents = ctx.browsing ? null : amountQuery(q.text);
  const words = everyWord<Prisma.TransactionWhereInput>(q.terms, (c) => [
    { description: c },
    { counterparty: c },
    { category: { name: c } },
  ]);
  const transactions = await db.transaction.findMany({
    where: {
      AND: [
        { organizationId: viewer.orgId },
        { OR: [{ voidReason: null }, { voidReason: { not: DELETED_TRANSACTION_REASON } }] },
        manager ? {} : { submittedById: viewer.userId },
        cents && words ? { OR: [{ amountCents: cents }, words] } : (words ?? {}),
      ],
    },
    orderBy: { occurredAt: "desc" },
    select: {
      id: true,
      description: true,
      counterparty: true,
      amountCents: true,
      currency: true,
      direction: true,
      status: true,
      occurredAt: true,
      voidedAt: true,
      category: { select: { name: true } },
    },
    take: ctx.pool,
  });
  const sponsors =
    manager && !ctx.browsing
      ? await db.sponsor.findMany({
          where: {
            organizationId: viewer.orgId,
            ...everyWord<Prisma.SponsorWhereInput>(q.terms, (c) => [
              { name: c },
              { contactName: c },
            ]),
          },
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            contactName: true,
            _count: { select: { sponsorships: true } },
          },
          take: ctx.pool,
        })
      : [];

  const hits = [
    ...transactions.map((t) => {
      const amount = formatCents(t.amountCents, t.currency);
      return hit("transaction", t.id, {
        title: t.description,
        href: manager
          ? // That one day (a date-only end covers the whole day).
            `${ctx.base}/finance/transactions?dateFrom=${dayKey(t.occurredAt)}&dateTo=${dayKey(t.occurredAt)}`
          : `${ctx.base}/finance/my-reimbursements`,
        detail: join(
          formatFinanceDate(t.occurredAt),
          t.counterparty,
          t.category?.name,
          t.voidedAt ? "Voided" : TX_STATUS[t.status],
        ),
        meta: `${t.direction === "IN" ? "+" : "−"}${amount}`,
        score:
          cents === t.amountCents
            ? 12
            : scoreFields(
                [
                  { text: t.description, weight: 3 },
                  { text: t.counterparty, weight: 2 },
                  { text: t.category?.name, weight: 1 },
                ],
                q,
              ),
      });
    }),
    ...sponsors.map((s) =>
      hit("sponsor", s.id, {
        title: s.name,
        href: `${ctx.base}/finance/sponsorships`,
        detail: join("Sponsor", s.contactName),
        meta: `${s._count.sponsorships} ${s._count.sponsorships === 1 ? "sponsorship" : "sponsorships"}`,
        score: scoreFields(
          [
            { text: s.name, weight: 3 },
            { text: s.contactName, weight: 1 },
          ],
          q,
        ),
      }),
    ),
  ];
  return group("finance", ctx.browsing ? hits.slice(0, ctx.limit) : rank(hits, ctx.limit));
}

// ---------------------------------------------------------------- entry

const SEARCHERS: Record<ServerGroupId, (ctx: Ctx) => Promise<SearchGroup>> = {
  notes: searchNotes,
  folders: searchFolders,
  files: searchFiles,
  tasks: searchTasks,
  projects: searchProjects,
  events: searchEvents,
  polls: searchPolls,
  people: searchPeople,
  roles: searchRoles,
  databases: searchDatabases,
  finance: searchFinance,
};

const RECENT_KIND: Record<string, SearchKind> = {
  page: "page",
  note: "note",
  task: "task",
  event: "event",
  database: "database",
  person: "person",
  file: "file",
  folder: "folder",
};

/** The sidebar section an address under `base` is in: the most specific one (Polls over Calendar). */
function sectionOf(href: string, base: string): SectionId | null {
  const path = href.split(/[?#]/)[0].slice(base.length);
  const match = SECTIONS.filter(
    (s) => s.path && (path === s.path || path.startsWith(`${s.path}/`)),
  ).sort((a, b) => b.path.length - a.path.length)[0];
  return match?.id ?? null;
}

/** Which groups a search reads: the filter's, minus sections the org hid (unless admin). */
export function groupsFor(
  scope: SearchScope,
  viewer: Pick<SearchViewer, "role" | "hiddenSections">,
): ServerGroupId[] {
  const admin = can({ role: viewer.role }, "settings.view");
  return SERVER_GROUPS.filter((id) => {
    if (scope !== "all" && GROUP_SCOPE[id] !== scope) return false;
    const section = GROUP_SECTION[id];
    return admin || !section || !viewer.hiddenSections.has(section);
  });
}

/**
 * Searches everything `viewer` may open for `query`. With no words: in
 * "All", the pages they visited last; under a filter, the latest of
 * that kind (recent notes, upcoming events, open tasks...).
 */
export async function searchWorkspace(
  db: TxClient,
  viewer: SearchViewer,
  input: { query: string; scope: SearchScope },
  now = new Date(),
): Promise<SearchResponse> {
  const q = parseQuery(input.query);
  const browsing = q.terms.length === 0;
  const base = `/app/${viewer.orgSlug}`;

  if (browsing && input.scope === "all") {
    // A page in a section the org has since hidden drops out for members, as in search.
    const admin = can({ role: viewer.role }, "settings.view");
    const recent = (await listRecent(db, viewer.orgId, viewer.orgSlug, viewer.userId, 10))
      .filter((r) => {
        const section = sectionOf(r.href, base);
        return admin || !section || !viewer.hiddenSections.has(section);
      })
      .slice(0, 6);
    const hits: SearchHit[] = recent.map((r) => ({
      // Keyed apart from the same record as a search hit; the icon follows what it is.
      key: `recent:${r.href}`,
      kind: RECENT_KIND[r.kind] ?? "page",
      title: r.label,
      href: r.href,
      detail: null,
      meta: ago(r.visitedAt, now),
      score: 0,
    }));
    return {
      query: q.text,
      scope: input.scope,
      groups: hits.length ? [{ id: "recent", label: GROUP_LABELS.recent, hits, more: null }] : [],
    };
  }

  const limit = input.scope === "all" ? ALL_LIMIT : SCOPED_LIMIT;
  const ctx: Ctx = { db, viewer, q, browsing, limit, pool: Math.min(limit * 4, 40), base, now };
  const groups: SearchGroup[] = [];
  for (const id of groupsFor(input.scope, viewer)) {
    const result = await SEARCHERS[id](ctx);
    if (result.hits.length) groups.push(result);
  }
  return { query: q.text, scope: input.scope, groups };
}
