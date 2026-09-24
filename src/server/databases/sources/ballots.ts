import { defineColumns } from "@/components/databases/column-config";
import { DatabaseKind, RecordSource, type Prisma } from "@/generated/prisma/client";
import type { DbFilterOp } from "@/lib/databases/href";
import type { TxClient } from "@/server/db/context";

import { definitionLabels, exclusionLabel, readDefinition } from "../ballot-definitions";
import { contactName, csvDateTime, dateTimeCell, num, options, personCell, SOURCE_LABELS, text } from "../format";
import type { ParsedValue, QuerySpec } from "../query-builder";
import type { DatabaseSource, MappedRow, ViewContext } from "../types";
import { contactSelect } from "./shared";

/**
 * Ballots (Phase 4b), for viewers allowed to see individual votes (RLS on
 * Ballot and BallotChoice: app.can_view_ballot_rows, OWNER only by default).
 * Everyone else gets the aggregate results view instead (ballot-results.ts,
 * app.ballot_tally with k-suppression); these sources return no rows for
 * them anyway.
 *
 *   choices  long format: one row per ballot, question and chosen option,
 *            with rank for ranked (slots) questions
 *   ballots  "group by ballot": one row per ballot, choices summarized
 *
 * Voter is 'Anonymous' when the source records none (every CBC website
 * ballot). Excluded ballots (test data, out of window) are hidden by default.
 */

type Labels = ReturnType<typeof definitionLabels>;

async function loadDefinitions(db: TxClient, organizationId: string) {
  const defs = await db.ballotDefinition.findMany({
    where: { organizationId },
    select: { id: true, slug: true, title: true, definition: true },
  });
  const byId = new Map<string, { title: string; slug: string; labels: Labels }>();
  for (const d of defs) {
    byId.set(d.id, { title: d.title, slug: d.slug, labels: definitionLabels(readDefinition(d.definition)) });
  }
  return byId;
}

/**
 * The poll filter takes a BallotDefinition id or a poll slug (report links
 * may carry either): eq/in match either column.
 */
function pollWhere(
  op: DbFilterOp,
  value: ParsedValue,
  bySlug: (slug: string | { in: string[] }) => Record<string, unknown>,
): Record<string, unknown> | null {
  if (op === "isnull") return { ballotDefinitionId: value === true ? null : { not: null } };
  if (op === "eq" && typeof value === "string") {
    return { OR: [{ ballotDefinitionId: value }, bySlug(value)] };
  }
  if (op === "in" && Array.isArray(value)) {
    const list = value.map(String);
    return { OR: [{ ballotDefinitionId: { in: list } }, bySlug({ in: list })] };
  }
  return null;
}

const excludedField = {
  kind: "boolean" as const,
  filterable: true,
  ops: ["eq" as const],
};

// ---- Long format ------------------------------------------------------------

export const choiceColumns = defineColumns([
  { key: "poll", label: "Poll", type: "text", filterable: true, sortable: true },
  { key: "question", label: "Question", type: "text", sortable: true, filterable: true },
  { key: "choice", label: "Choice", type: "text", sortable: true, filterable: true, searchable: true },
  { key: "rank", label: "Rank", type: "number", sortable: true, filterable: true, align: "right" },
  { key: "castAt", label: "Cast at", type: "datetime", sortable: true, filterable: true },
  { key: "voter", label: "Voter", type: "person" },
  { key: "freeText", label: "Free text", type: "boolean", filterable: true, hiddenByDefault: true },
  { key: "ballot", label: "Ballot", type: "text", filterable: true, hiddenByDefault: true },
  { key: "excluded", label: "Excluded", type: "text", filterable: true, hiddenByDefault: true },
]);

const choiceSpec: QuerySpec = {
  fields: {
    id: { path: ["id"], kind: "string", filterable: true, ops: ["eq", "in"] },
    poll: {
      path: ["ballotDefinitionId"],
      kind: "string",
      nullable: true,
      filterable: true,
      sortable: true,
      ops: ["eq", "in", "isnull"],
      where: (op, v) => pollWhere(op, v, (slug) => ({ ballot: { pollSlug: slug } })),
      orderBy: (dir) => [{ ballot: { pollSlug: dir } }],
    },
    pollSlug: { path: ["ballot", "pollSlug"], kind: "string", filterable: true, ops: ["eq", "in"] },
    question: { path: ["questionKey"], kind: "string", sortable: true, filterable: true, ops: ["eq", "in"] },
    choice: { path: ["choiceKey"], kind: "string", nullable: true, sortable: true, filterable: true },
    rank: { path: ["rank"], kind: "int", nullable: true, sortable: true, filterable: true },
    castAt: { path: ["ballot", "castAt"], kind: "datetime", sortable: true, filterable: true },
    freeText: { path: ["isFreeText"], kind: "boolean", filterable: true },
    ballot: { path: ["ballotId"], kind: "string", filterable: true, ops: ["eq", "in"] },
    excluded: {
      path: ["ballot", "excludedReason"],
      ...excludedField,
      where: (_op, v) => ({ ballot: { excludedReason: v === true ? { not: null } : null } }),
    },
  },
  aliases: {
    ballotDefinitionId: "poll",
    definition: "poll",
    questionKey: "question",
    choiceKey: "choice",
    option: "choice",
    date: "castAt",
    ballotId: "ballot",
    slug: "pollSlug",
  },
  searchExtra: (q) => [
    { choiceKey: { contains: q, mode: "insensitive" } },
    { choiceText: { contains: q, mode: "insensitive" } },
    { questionKey: { contains: q, mode: "insensitive" } },
  ],
  dateField: "castAt",
  defaultSort: { col: "castAt", dir: "desc" },
  tiebreak: (dir) => [{ id: dir }],
  defaultFilters: [{ col: "excluded", op: "eq", value: "false" }],
};

const choiceSelect = {
  id: true,
  ballotId: true,
  ballotDefinitionId: true,
  questionKey: true,
  choiceKey: true,
  choiceText: true,
  isFreeText: true,
  rank: true,
  ballot: {
    select: {
      pollSlug: true,
      castAt: true,
      excludedReason: true,
      voter: { select: contactSelect },
    },
  },
} satisfies Prisma.BallotChoiceSelect;

type ChoiceRow = Prisma.BallotChoiceGetPayload<{ select: typeof choiceSelect }>;

function mapChoice(
  c: ChoiceRow,
  ctx: ViewContext,
  defs: Map<string, { title: string; slug: string; labels: Labels }>,
): MappedRow {
  const def = c.ballotDefinitionId ? defs.get(c.ballotDefinitionId) : undefined;
  const poll = def?.title ?? c.ballot.pollSlug;
  const question = def ? def.labels.question(c.questionKey) : c.questionKey;
  const choice = c.isFreeText ? (c.choiceText ?? "") : def ? def.labels.choice(c.questionKey, c.choiceKey) : (c.choiceKey ?? "");
  const voter = c.ballot.voter ? contactName(c.ballot.voter) : "Anonymous";
  return {
    id: c.id,
    cursor: { id: c.id },
    dim: c.ballot.excludedReason !== null,
    cells: {
      poll: text(poll),
      question: text(question, { title: c.questionKey }),
      choice: c.isFreeText ? { t: "text", v: choice, muted: false, title: "Free text" } : text(choice, { title: c.choiceKey ?? undefined }),
      rank: num(c.rank),
      castAt: dateTimeCell(c.ballot.castAt, ctx.timezone),
      voter: c.ballot.voter ? personCell(c.ballot.voter) : { t: "text", v: "Anonymous", muted: true },
      freeText: { t: "bool", v: c.isFreeText },
      ballot: text(c.ballotId.slice(-8), { muted: true, title: c.ballotId }),
      excluded: c.ballot.excludedReason ? { t: "badge", v: exclusionLabel(c.ballot.excludedReason), tone: "warning" } : null,
    },
    csv: {
      poll,
      question,
      choice,
      rank: c.rank,
      castAt: csvDateTime(c.ballot.castAt, ctx.timezone),
      voter,
      freeText: c.isFreeText,
      ballot: c.ballotId,
      excluded: c.ballot.excludedReason ? exclusionLabel(c.ballot.excludedReason) : "",
    },
  };
}

export const ballotChoicesSource: DatabaseSource = {
  kind: DatabaseKind.BALLOTS,
  view: "choices",
  columns: choiceColumns,
  query: () => choiceSpec,
  baseWhere: (ctx) => ({ organizationId: ctx.organizationId }),
  async list(db, args, ctx) {
    const defs = await loadDefinitions(db, ctx.organizationId);
    const rows = await db.ballotChoice.findMany({
      where: args.where as Prisma.BallotChoiceWhereInput,
      orderBy: args.orderBy as Prisma.BallotChoiceOrderByWithRelationInput[],
      skip: args.skip,
      take: args.take,
      ...(args.cursor ? { cursor: args.cursor as Prisma.BallotChoiceWhereUniqueInput, skip: 1 } : {}),
      select: choiceSelect,
    });
    return rows.map((r) => mapChoice(r, ctx, defs));
  },
  count: (db, where) => db.ballotChoice.count({ where: where as Prisma.BallotChoiceWhereInput }),
  csvHeader: (c, ctx) => (c.type === "datetime" ? `${c.label} (${ctx.timezone})` : c.label),
};

// ---- One row per ballot -----------------------------------------------------------

export const ballotColumns = defineColumns([
  { key: "poll", label: "Poll", type: "text", filterable: true, sortable: true },
  { key: "castAt", label: "Cast at", type: "datetime", sortable: true, filterable: true },
  { key: "summary", label: "Choices", type: "longtext" },
  { key: "voter", label: "Voter", type: "person" },
  { key: "source", label: "Source", type: "select", filterable: true, hiddenByDefault: true, options: options(SOURCE_LABELS) },
  { key: "excluded", label: "Excluded", type: "text", filterable: true, hiddenByDefault: true },
]);

const ballotSpec: QuerySpec = {
  fields: {
    id: { path: ["id"], kind: "string", filterable: true, ops: ["eq", "in"] },
    poll: {
      path: ["ballotDefinitionId"],
      kind: "string",
      nullable: true,
      filterable: true,
      sortable: true,
      ops: ["eq", "in", "isnull"],
      where: (op, v) => pollWhere(op, v, (slug) => ({ pollSlug: slug })),
      orderBy: (dir) => [{ pollSlug: dir }],
    },
    pollSlug: { path: ["pollSlug"], kind: "string", filterable: true, ops: ["eq", "in"] },
    castAt: { path: ["castAt"], kind: "datetime", sortable: true, filterable: true },
    source: { path: ["source"], kind: "enum", enumValues: Object.values(RecordSource), filterable: true },
    excluded: {
      path: ["excludedReason"],
      ...excludedField,
      where: (_op, v) => ({ excludedReason: v === true ? { not: null } : null }),
    },
    excludedReason: { path: ["excludedReason"], kind: "string", nullable: true, filterable: true, ops: ["eq", "in", "isnull"] },
  },
  aliases: { ballotDefinitionId: "poll", definition: "poll", date: "castAt", slug: "pollSlug" },
  searchExtra: (q) => [{ pollSlug: { contains: q, mode: "insensitive" } }],
  dateField: "castAt",
  defaultSort: { col: "castAt", dir: "desc" },
  tiebreak: (dir) => [{ id: dir }],
  defaultFilters: [{ col: "excluded", op: "eq", value: "false" }],
};

const ballotSelect = {
  id: true,
  pollSlug: true,
  ballotDefinitionId: true,
  castAt: true,
  source: true,
  excludedReason: true,
  voter: { select: contactSelect },
  choices: {
    select: { questionKey: true, choiceKey: true, choiceText: true, isFreeText: true, rank: true },
    orderBy: [{ questionKey: "asc" }, { rank: "asc" }],
  },
} satisfies Prisma.BallotSelect;

type BallotRow = Prisma.BallotGetPayload<{ select: typeof ballotSelect }>;

/** "Workshops: 1 Agents, 2 Tools; Theme: Build" */
export function summarizeBallot(choices: BallotRow["choices"], labels: Labels | undefined): string {
  const byQ = new Map<string, string[]>();
  for (const c of choices) {
    const value = c.isFreeText
      ? `"${(c.choiceText ?? "").slice(0, 60)}"`
      : `${c.rank ? `${c.rank} ` : ""}${labels ? labels.choice(c.questionKey, c.choiceKey) : (c.choiceKey ?? "")}`;
    const list = byQ.get(c.questionKey) ?? [];
    list.push(value);
    byQ.set(c.questionKey, list);
  }
  return [...byQ.entries()]
    .map(([q, vs]) => `${labels ? labels.question(q) : q}: ${vs.join(", ")}`)
    .join("; ");
}

function mapBallot(
  b: BallotRow,
  ctx: ViewContext,
  defs: Map<string, { title: string; slug: string; labels: Labels }>,
): MappedRow {
  const def = b.ballotDefinitionId ? defs.get(b.ballotDefinitionId) : undefined;
  const summary = summarizeBallot(b.choices, def?.labels);
  return {
    id: b.id,
    cursor: { id: b.id },
    dim: b.excludedReason !== null,
    cells: {
      poll: text(def?.title ?? b.pollSlug),
      castAt: dateTimeCell(b.castAt, ctx.timezone),
      summary: text(summary),
      voter: b.voter ? personCell(b.voter) : { t: "text", v: "Anonymous", muted: true },
      source: { t: "badge", v: SOURCE_LABELS[b.source] ?? b.source, tone: "secondary" },
      excluded: b.excludedReason ? { t: "badge", v: exclusionLabel(b.excludedReason), tone: "warning" } : null,
    },
    csv: {
      poll: def?.title ?? b.pollSlug,
      castAt: csvDateTime(b.castAt, ctx.timezone),
      summary,
      voter: b.voter ? contactName(b.voter) : "Anonymous",
      source: SOURCE_LABELS[b.source] ?? b.source,
      excluded: b.excludedReason ? exclusionLabel(b.excludedReason) : "",
    },
  };
}

export const ballotsSource: DatabaseSource = {
  kind: DatabaseKind.BALLOTS,
  view: "ballots",
  columns: ballotColumns,
  query: () => ballotSpec,
  baseWhere: (ctx) => ({ organizationId: ctx.organizationId }),
  async list(db, args, ctx) {
    const defs = await loadDefinitions(db, ctx.organizationId);
    const rows = await db.ballot.findMany({
      where: args.where as Prisma.BallotWhereInput,
      orderBy: args.orderBy as Prisma.BallotOrderByWithRelationInput[],
      skip: args.skip,
      take: args.take,
      ...(args.cursor ? { cursor: args.cursor as Prisma.BallotWhereUniqueInput, skip: 1 } : {}),
      select: ballotSelect,
    });
    return rows.map((r) => mapBallot(r, ctx, defs));
  },
  count: (db, where) => db.ballot.count({ where: where as Prisma.BallotWhereInput }),
  csvHeader: (c, ctx) => (c.type === "datetime" ? `${c.label} (${ctx.timezone})` : c.label),
};
