import { Prisma } from "@/generated/prisma/client";
import { crmRecordHref } from "@/lib/crm/href";
import {
  NOT_TALKED_OUTCOMES,
  funnelOf,
  groupIssuesExactly,
  isConvertedRelationship,
  readIssue,
  shareOf,
  type Funnel,
} from "@/lib/crm/report-classics";
import type { CrmListPayload, CrmStatPayload, IssueGroup } from "@/lib/reports/crm-widgets";
import { formatCrmValue } from "@/lib/reports/crm-widgets";
import type { TxClient } from "@/server/db/context";

/**
 * The classics on the CRM's People and Deals reports, read as the viewer
 * (RLS decides the rows, private timeline rows included):
 *
 * - People talked to: different people with a real two-way contact in the
 *   range: they wrote back (an email or text in, or a reply to ours), took
 *   a call that connected, or met with you.
 * - Converted: of those people, the ones who became a member, client or
 *   partner (their relationship), have a won deal, or joined from a
 *   campaign; Interested in between: they met with you, booked a time, or
 *   are on a deal.
 * - Top issues: each person's biggest issue (enrichment `_issue`), the most
 *   common first, grouped by exact text here; the report page groups them
 *   by meaning with the organization's AI afterwards (issue-groups.ts).
 */

export interface ClassicsCtx {
  db: TxClient;
  organizationId: string;
  slug: string;
  start: Date;
  end: Date;
  /** The span before, for the comparison (null for all time). */
  previous: { start: Date; end: Date } | null;
  now: Date;
}

const NO_TALK = Prisma.join([...NOT_TALKED_OUTCOMES]);

/** The people talked to in [start, end). */
export async function talkedToIds(c: Pick<ClassicsCtx, "db" | "organizationId" | "now">, b: { start: Date; end: Date }): Promise<string[]> {
  const end = b.end < c.now ? b.end : c.now;
  const rows = await c.db.$queryRaw<{ id: string }[]>`
    SELECT t."targetId" AS id
    FROM "CrmActivityTarget" t
    JOIN "CrmActivity" a ON a.id = t."activityId"
    JOIN "CrmPerson" p ON p.id = t."targetId" AND p."organizationId" = t."organizationId" AND p."deletedAt" IS NULL
    WHERE t."organizationId" = ${c.organizationId} AND t."targetKind" = 'person'
      AND a."deletedAt" IS NULL
      AND a."occurredAt" >= ${b.start} AND a."occurredAt" < ${end}
      AND (
        (a.kind IN ('EMAIL', 'TEXT') AND a.direction = 'INBOUND')
        OR a.kind = 'MEETING'
        OR (a.kind = 'CALL' AND COALESCE(a.meta->>'outcome', '') NOT IN (${NO_TALK}))
      )
    UNION
    SELECT m."personId" AS id
    FROM "CrmEmailMessage" m
    JOIN "CrmPerson" p ON p.id = m."personId" AND p."organizationId" = m."organizationId" AND p."deletedAt" IS NULL
    WHERE m."organizationId" = ${c.organizationId} AND m."personId" IS NOT NULL
      AND m."repliedAt" >= ${b.start} AND m."repliedAt" < ${end}`;
  return rows.map((r) => r.id);
}

async function peopleCount(c: Pick<ClassicsCtx, "db" | "organizationId">): Promise<number> {
  return c.db.crmPerson.count({ where: { organizationId: c.organizationId, deletedAt: null } });
}

async function reachedOutCount(c: ClassicsCtx): Promise<number> {
  const end = c.end < c.now ? c.end : c.now;
  const rows = await c.db.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(DISTINCT t."targetId") AS n
    FROM "CrmActivityTarget" t JOIN "CrmActivity" a ON a.id = t."activityId"
    WHERE t."organizationId" = ${c.organizationId} AND t."targetKind" = 'person'
      AND a."deletedAt" IS NULL AND a.direction = 'OUTBOUND' AND a.kind IN ('EMAIL', 'CALL', 'TEXT')
      AND a."occurredAt" >= ${c.start} AND a."occurredAt" < ${end}`;
  return Number(rows[0]?.n ?? 0);
}

export async function talkedToStat(c: ClassicsCtx): Promise<CrmStatPayload> {
  const ids = await talkedToIds(c, c);
  const before = c.previous ? (await talkedToIds(c, c.previous)).length : null;
  const total = await peopleCount(c);
  const reached = await reachedOutCount(c);
  const value = ids.length;
  const share = shareOf(value, total);
  return {
    value,
    format: "number",
    previous: before,
    deltaPct: before ? ((value - before) / before) * 100 : null,
    caption: "Different people who wrote back, took a call or met with you.",
    parts: [
      { label: "Of everyone in People", value: share === null ? "None yet" : formatCrmValue(share, "percent") },
      { label: "Reached out to", value: reached.toLocaleString("en-US") },
    ],
    rows: [],
    empty: value === 0 ? "Nobody has written back, taken a call or met with you in these dates yet." : null,
    line:
      value > 0
        ? {
            tone: "info",
            bold: `${value} ${value === 1 ? "person" : "people"}`,
            text: `You talked to ${value} ${value === 1 ? "person" : "people"}${share !== null ? `, ${formatCrmValue(share, "percent")} of everyone in People` : ""}.`,
          }
        : null,
  };
}

/** Of `ids`, who showed interest and who converted (as of now). */
async function interestAndConversion(
  c: Pick<ClassicsCtx, "db" | "organizationId">,
  ids: readonly string[],
): Promise<{ interested: Set<string>; converted: Set<string> }> {
  const interested = new Set<string>();
  const converted = new Set<string>();
  if (ids.length === 0) return { interested, converted };
  const list = [...ids];
  const settings = await c.db.crmSettings.findUnique({
    where: { organizationId: c.organizationId },
    select: { relationshipTypes: true },
  });
  const types = (Array.isArray(settings?.relationshipTypes) ? settings.relationshipTypes : []) as {
    id: string;
    label: string;
  }[];
  const onBoard = new Set(types.filter((t) => t && typeof t.id === "string" && isConvertedRelationship({ id: t.id, label: String(t.label ?? "") })).map((t) => t.id));
  const people = await c.db.crmPerson.findMany({
    where: { organizationId: c.organizationId, id: { in: list } },
    select: { id: true, relationship: true },
  });
  for (const p of people) if (p.relationship && onBoard.has(p.relationship)) converted.add(p.id);

  const deals = await c.db.crmDeal.findMany({
    where: {
      organizationId: c.organizationId,
      deletedAt: null,
      OR: [{ primaryPersonId: { in: list } }, { people: { some: { personId: { in: list } } } }],
    },
    select: { primaryPersonId: true, people: { select: { personId: true } }, stage: { select: { kind: true } } },
    take: 20_000,
  });
  const wanted = new Set(list);
  for (const d of deals) {
    const on = [d.primaryPersonId, ...d.people.map((p) => p.personId)].filter((x): x is string => Boolean(x && wanted.has(x)));
    for (const id of on) {
      if (d.stage.kind === "WON") converted.add(id);
      else if (d.stage.kind === "OPEN") interested.add(id);
    }
  }

  const met = await c.db.crmActivityTarget.findMany({
    where: {
      organizationId: c.organizationId,
      targetKind: "person",
      targetId: { in: list },
      activity: { kind: "MEETING", deletedAt: null },
    },
    distinct: ["targetId"],
    select: { targetId: true },
  });
  for (const m of met) interested.add(m.targetId);

  const targets = await c.db.crmCampaignTarget.findMany({
    where: { organizationId: c.organizationId, personId: { in: list }, status: { in: ["BOOKED", "CONVERTED"] } },
    select: { personId: true, status: true },
  });
  for (const t of targets) (t.status === "CONVERTED" ? converted : interested).add(t.personId);
  return { interested, converted };
}

export async function funnelFor(c: ClassicsCtx): Promise<Funnel> {
  const ids = await talkedToIds(c, c);
  const { interested, converted } = await interestAndConversion(c, ids);
  return funnelOf(ids, interested, converted);
}

/** "12 of 40" and "30%". */
const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : "0%");

export async function convertedList(c: ClassicsCtx): Promise<CrmListPayload> {
  const f = await funnelFor(c);
  const rate = shareOf(f.converted, f.talked);
  return {
    rows: [
      { key: "talked", label: "Talked to", value: f.talked, display: f.talked.toLocaleString("en-US"), detail: null },
      {
        key: "interested",
        label: "Interested",
        value: f.interested,
        display: f.interested.toLocaleString("en-US"),
        detail: f.talked ? `${pct(f.interested, f.talked)} of talked to` : null,
      },
      {
        key: "converted",
        label: "Converted",
        value: f.converted,
        display: f.converted.toLocaleString("en-US"),
        detail: f.interested ? `${pct(f.converted, f.interested)} of interested` : null,
      },
    ],
    max: f.talked,
    headline: f.talked
      ? { value: f.converted.toLocaleString("en-US"), detail: `${pct(f.converted, f.talked)} of the people talked to` }
      : null,
    caption: "Interested: met with you, booked a time or on a deal. Converted: a member, client or partner now, or a won deal.",
    empty: "Nobody talked to in these dates yet, so nobody to count.",
    line:
      f.talked > 0
        ? {
            tone: rate !== null && rate >= 0.2 ? "good" : "info",
            bold: `${f.converted} of ${f.talked}`,
            text: `${f.converted} of the ${f.talked} people talked to converted (${pct(f.converted, f.talked)}).`,
          }
        : null,
  };
}

/** Everyone's biggest issue, grouped by exact text (the newest 5,000 people with one). */
export async function issueGroups(c: Pick<ClassicsCtx, "db" | "organizationId">): Promise<IssueGroup[]> {
  const rows = await c.db.$queryRaw<{ id: string; name: string; issue: unknown }[]>`
    SELECT id, name, enrichment -> '_issue' AS issue
    FROM "CrmPerson"
    WHERE "organizationId" = ${c.organizationId} AND "deletedAt" IS NULL
      AND enrichment -> '_issue' IS NOT NULL
    ORDER BY "updatedAt" DESC
    LIMIT 5000`;
  const people = rows
    .map((r) => ({ id: r.id, name: r.name, issue: readIssue({ _issue: r.issue })?.text ?? "" }))
    .filter((p) => p.issue);
  return groupIssuesExactly(people);
}

/** At most this many exact groups go to the AI to be grouped by meaning. */
export const MAX_ISSUE_GROUPS = 120;
const TOP = 5;
const LINKS = 5;

/** Top issues from groups (exact, or merged by the AI). */
export function topIssuesPayload(slug: string, groups: readonly IssueGroup[], withIssues: boolean): CrmListPayload {
  const top = groups.slice(0, TOP);
  const people = groups.reduce((n, g) => n + g.people.length, 0);
  const first = top[0];
  return {
    rows: top.map((g, i) => ({
      key: `issue-${i}`,
      label: g.label,
      value: g.people.length,
      display: `${g.people.length} ${g.people.length === 1 ? "person" : "people"}`,
      links: g.people.slice(0, LINKS).map((p) => ({ key: p.id, label: p.name, href: crmRecordHref(slug, "person", p.id) })),
      detail: g.people.length > LINKS ? `and ${g.people.length - LINKS} more` : null,
    })),
    caption: people ? `From ${people} ${people === 1 ? "person" : "people"} with an issue on their record.` : null,
    empty: "No issues found yet. A person's biggest issue shows here once their record is looked up.",
    line: first
      ? {
          tone: "info",
          bold: first.label,
          text: `The most common issue is ${first.label}, for ${first.people.length} ${first.people.length === 1 ? "person" : "people"}.`,
        }
      : null,
    ...(withIssues && groups.length > 1 ? { issues: groups.slice(0, MAX_ISSUE_GROUPS) as IssueGroup[] } : {}),
  };
}
