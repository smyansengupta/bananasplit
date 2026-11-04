import "server-only";

import { z } from "zod";

import type { Cell, ColumnView } from "@/components/databases/column-config";
import type { DatabaseKind } from "@/generated/prisma/client";
import { displayText, type FieldDef } from "@/lib/databases/fields";
import { DB_FILTER_OPS, dbViewQuery, type DbViewFilter } from "@/lib/databases/href";
import { loadFields, loadRecords } from "@/server/databases/custom";
import { sourceFor } from "@/server/databases/sources";
import {
  canViewBallotRows,
  columnViews,
  getDatabase,
  listDatabases,
  queryFor,
  viewContextFor,
  viewerColumns,
  type DatabaseSummary,
  type SearchParams,
} from "@/server/databases/views";
import type { OrgContext } from "@/server/db/context";
import { AppError } from "@/server/db/errors";

import { decodeCursor, encodeCursor, listFingerprint, pageOf, type CursorPosition } from "./cursor";
import { itemId, refOf, type ItemRef } from "./ids";
import {
  ConnectorInputError,
  cursorArg,
  itemArg,
  limitArg,
  nextCursor,
  READ_ONLY,
  readResult,
  spaceArg,
  spaceRef,
  urlField,
  type ConnectorSession,
  type FetchedItem,
  type ToolRegistrar,
} from "./shared";
import { inSpace, type ToolSpace } from "./space";

/**
 * list_databases and query_database (docs/features/ai-connectors.md): the
 * databases the member may open, and their rows, as the database pages
 * read them. getDatabase applies app.can_view_database and member
 * visibility; viewerColumns drops columns hidden from members; RLS masks
 * contact emails below the club's privacy tier; individual ballots need
 * the tier Privacy allows. Built-in databases filter and sort through the
 * view grammar (src/lib/databases/href.ts); club-made ones search only.
 */

export const DATABASES = { feature: "databases", section: "databases" } as const;

const KIND_OUT: Record<DatabaseKind, string> = {
  ATTENDANCE: "attendance",
  BALLOTS: "ballots",
  SIGNUPS: "signups",
  SESSIONS: "sessions",
  PEOPLE: "people",
  CUSTOM: "custom",
};

const databaseSummary = z.object({
  id: z.string().describe("The database's id, for query_database and fetch."),
  name: z.string(),
  kind: z
    .string()
    .describe(
      "attendance, ballots, signups, sessions or people (built in), or custom (organization-made).",
    ),
  description: z.string().nullable(),
  url: urlField,
});

const listOutput = z.object({
  space: spaceRef,
  databases: z.array(databaseSummary),
  nextCursor,
});

export const valueField = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);

const columnField = z.object({
  key: z.string().describe("The column's key: in each row's values, and for filters and sort."),
  label: z.string(),
  type: z.string(),
  filterable: z.boolean(),
  sortable: z.boolean(),
  ops: z.array(z.string()).describe("The filter operators this column takes."),
  options: z.array(z.string()).optional().describe("The values a choice column has."),
});

const queryOutput = z.object({
  space: spaceRef,
  database: databaseSummary,
  columns: z.array(columnField),
  rows: z.array(z.object({ id: z.string(), values: z.record(z.string(), valueField) })),
  total: z.number().int().describe("Rows matching, on every page."),
  nextCursor,
});

type DatabaseOutput = z.infer<typeof databaseSummary>;
type Column = z.infer<typeof columnField>;
export type Value = z.infer<typeof valueField>;

function summaryOf(space: ToolSpace, d: DatabaseSummary): DatabaseOutput {
  return {
    id: itemId("database", space.id, d.key),
    name: d.name,
    kind: KIND_OUT[d.kind],
    description: d.description,
    url: space.url(`/databases/${d.key}`),
  };
}

// ---------------------------------------------------------------- list_databases

const listInput = z.object({ space: spaceArg, limit: limitArg, cursor: cursorArg });

export async function listDatabasesTool(
  session: ConnectorSession,
  raw: z.input<typeof listInput>,
): Promise<z.infer<typeof listOutput>> {
  const args = listInput.parse(raw);
  const list = listFingerprint("list_databases", { space: args.space });
  const position = decodeCursor(args.cursor, list);
  return inSpace(session, args.space, DATABASES, async (ctx, space) => {
    const all = await listDatabases(ctx.db, space.id, ctx.role);
    const page = pageOf(
      all.slice(position.offset, position.offset + args.limit + 1),
      args.limit,
      list,
      position,
    );
    return {
      space: { id: space.id, name: space.name },
      databases: page.items.map((d) => summaryOf(space, d)),
      nextCursor: page.nextCursor,
    };
  });
}

// ---------------------------------------------------------------- query_database

const filterArg = z.object({
  column: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9_.]{0,63}$/, "Use a column key from query_database's columns")
    .describe("A column key from query_database's columns."),
  op: z.enum(DB_FILTER_OPS).describe("One of the column's ops."),
  value: z
    .union([
      z.string().max(500),
      z.number(),
      z.boolean(),
      z.array(z.union([z.string().max(200), z.number()])).max(100),
    ])
    .optional()
    .describe('The value; a list for "in"; true or false for "isnull"; days as yyyy-mm-dd.'),
});

const queryInput = z.object({
  id: itemArg("database"),
  query: z.string().max(100).optional().describe("Words to look for across the rows."),
  filters: z
    .array(filterArg)
    .max(20)
    .optional()
    .describe("Built-in databases only: every filter must match."),
  sort: z
    .object({ column: filterArg.shape.column, direction: z.enum(["asc", "desc"]) })
    .optional()
    .describe("Built-in databases only."),
  limit: limitArg,
  cursor: cursorArg,
});

type QueryInput = z.output<typeof queryInput>;

/** Individual ballots: only for the tier Admin panel › Privacy allows. */
class BallotRowsHiddenError extends AppError {
  constructor(spaceName: string) {
    super(
      `${spaceName} keeps who voted for what private from your role. The results are on the database's page in Bananasplit.`,
      403,
      "CONNECTOR_BALLOTS_PRIVATE",
    );
    this.name = "BallotRowsHiddenError";
  }
}

/** A rendered cell as a plain value: the text a person sees in the table. */
function cellValue(cell: Cell | undefined): Value {
  if (!cell) return null;
  switch (cell.t) {
    case "text":
    case "badge":
      return cell.v;
    case "number":
      return cell.v ?? cell.text ?? null;
    case "bool":
      return cell.v;
    case "badges":
      return cell.v;
    case "person":
      return cell.name;
    case "link":
      return cell.label;
  }
}

function columnOf(c: ColumnView): Column {
  return {
    key: c.key,
    label: c.label,
    type: c.type,
    filterable: c.filterable,
    sortable: c.sortable,
    ops: c.ops,
    ...(c.options ? { options: c.options.map((o) => o.label) } : {}),
  };
}

/** The view grammar's search params for these arguments (validated, never echoed back). */
function viewParams(args: Pick<QueryInput, "filters" | "sort" | "query">): SearchParams {
  const filters: DbViewFilter[] = (args.filters ?? []).map((f) => ({
    col: f.column,
    op: f.op,
    value: f.value,
  }));
  filters.forEach((filter, i) => {
    try {
      dbViewQuery({ filters: [filter] });
    } catch {
      throw new ConnectorInputError(
        `Filter ${i + 1} isn't valid: check its value for the operator ("in" takes a list without commas in its items, "isnull" true or false).`,
      );
    }
  });
  const search = new URLSearchParams(
    dbViewQuery({
      filters,
      sort: args.sort ? { col: args.sort.column, dir: args.sort.direction } : undefined,
      q: args.query,
    }),
  );
  return {
    f: search.getAll("f"),
    sort: search.get("sort") ?? undefined,
    q: search.get("q") ?? undefined,
  };
}

interface Rows {
  columns: Column[];
  rows: { id: string; values: Record<string, Value> }[];
  total: number;
  nextCursor: string | null;
}

function viewContext(ctx: OrgContext, space: ToolSpace, database: DatabaseSummary) {
  return viewContextFor(
    { id: space.id, slug: space.slug, timezone: space.orgZone },
    ctx.role,
    database,
  );
}

/** A built-in database's source and the columns this member sees of it. */
function builtInView(ctx: OrgContext, space: ToolSpace, database: DatabaseSummary) {
  const vctx = viewContext(ctx, space, database);
  const source = sourceFor(database.kind);
  if (!source) throw new ConnectorInputError("This database can't be read here.");
  const configs = viewerColumns(source, database.columns, vctx.tier);
  const columns = columnViews(
    configs,
    source,
    vctx,
    configs.map((c) => c.key),
  );
  return { vctx, source, columns };
}

/** Individual ballots: the tier Admin panel › Privacy allows. */
function ballotRowsOpen(ctx: OrgContext, space: ToolSpace, database: DatabaseSummary) {
  if (database.kind !== "BALLOTS") return Promise.resolve(true);
  return canViewBallotRows(ctx.db, space.id, viewContext(ctx, space, database).tier);
}

async function builtInRows(
  ctx: OrgContext,
  space: ToolSpace,
  database: DatabaseSummary,
  args: QueryInput,
  list: string,
  position: CursorPosition,
): Promise<Rows> {
  if (!(await ballotRowsOpen(ctx, space, database))) throw new BallotRowsHiddenError(space.name);
  const { vctx, source, columns } = builtInView(ctx, space, database);
  const { built, where } = queryFor(source, vctx, viewParams(args));
  const refused = built.rejected[0];
  if (refused) {
    throw new ConnectorInputError(
      `Part of the query wasn't applied (${refused.reason}). Each column lists whether it can be filtered or sorted, and its operators.`,
    );
  }
  // One after another: a transaction has one connection.
  const rows = await source.list(
    ctx.db,
    { where, orderBy: built.orderBy, skip: position.offset, take: args.limit + 1 },
    vctx,
  );
  const total = await source.count(ctx.db, where, vctx);
  const page = pageOf(rows, args.limit, list, position);
  return {
    columns: columns.map(columnOf),
    rows: page.items.map((r) => ({
      id: r.id,
      values: Object.fromEntries(columns.map((c) => [c.key, cellValue(r.cells[c.key])])),
    })),
    total,
    nextCursor: page.nextCursor,
  };
}

/** Field names as column keys, the second of a name as "Name (2)". */
export function fieldKeys(fields: readonly FieldDef[]): string[] {
  const seen = new Map<string, number>();
  return fields.map((f) => {
    const n = (seen.get(f.name) ?? 0) + 1;
    seen.set(f.name, n);
    return n === 1 ? f.name : `${f.name} (${n})`;
  });
}

/** A club-made database's fields as columns: searched with query, never filtered or sorted. */
function customColumns(fields: readonly FieldDef[]): Column[] {
  const keys = fieldKeys(fields);
  return fields.map((f, i) => ({
    key: keys[i]!,
    label: f.name,
    type: f.type.toLowerCase(),
    filterable: false,
    sortable: false,
    ops: [],
    ...(f.options.choices ? { options: f.options.choices.map((c) => c.label) } : {}),
  }));
}

/** The club's members by id, for member cells (only read when there is a member field). */
export async function memberNames(
  ctx: OrgContext,
  spaceId: string,
  fields: readonly FieldDef[],
): Promise<Map<string, string>> {
  if (!fields.some((f) => f.type === "MEMBER")) return new Map();
  const members = await ctx.db.membership.findMany({
    where: { organizationId: spaceId },
    select: { userId: true, user: { select: { name: true } } },
  });
  return new Map(members.map((m) => [m.userId, m.user.name ?? "Member"]));
}

async function customRows(
  ctx: OrgContext,
  space: ToolSpace,
  database: DatabaseSummary,
  args: QueryInput,
  list: string,
  position: CursorPosition,
): Promise<Rows> {
  if ((args.filters?.length ?? 0) > 0 || args.sort) {
    throw new ConnectorInputError(
      "An organization-made database is searched with query; filters and sort are for the built-in ones.",
    );
  }
  const actor = { db: ctx.db, organizationId: space.id, userId: ctx.userId, role: ctx.role };
  // One after another: a transaction has one connection.
  const fields = await loadFields(ctx.db, space.id, database.id);
  const page = await loadRecords(actor, database.id, {
    q: args.query,
    after: position.after ?? null,
    limit: args.limit,
  });
  const names = await memberNames(ctx, space.id, fields);
  const keys = fieldKeys(fields);
  return {
    columns: customColumns(fields),
    rows: page.records.map((r) => ({
      id: r.id,
      values: Object.fromEntries(
        fields.map((f, i) => [keys[i]!, displayText(f, r.values[f.id], names) || null]),
      ),
    })),
    total: page.total,
    nextCursor: page.next
      ? encodeCursor(list, { offset: position.offset + args.limit, after: page.next })
      : null,
  };
}

async function readRows(
  ctx: OrgContext,
  space: ToolSpace,
  key: string,
  args: QueryInput,
  list: string,
  position: CursorPosition,
) {
  const database = await getDatabase(ctx.db, space.id, ctx.role, key);
  const rows =
    database.kind === "CUSTOM"
      ? await customRows(ctx, space, database, args, list, position)
      : await builtInRows(ctx, space, database, args, list, position);
  return { database: summaryOf(space, database), ...rows };
}

export async function queryDatabase(
  session: ConnectorSession,
  raw: z.input<typeof queryInput>,
): Promise<z.infer<typeof queryOutput>> {
  const args = queryInput.parse(raw);
  const ref = refOf(args.id, "database");
  const list = listFingerprint("query_database", { ...args, limit: undefined, cursor: undefined });
  const position = decodeCursor(args.cursor, list);
  return inSpace(session, ref.spaceId, DATABASES, async (ctx, space) => ({
    space: { id: space.id, name: space.name },
    ...(await readRows(ctx, space, ref.id, args, list, position)),
  }));
}

/** What fetch says of a database: its columns and how many rows match its default view. */
async function describeDatabase(ctx: OrgContext, space: ToolSpace, key: string) {
  const database = await getDatabase(ctx.db, space.id, ctx.role, key);
  // One after another: a transaction has one connection.
  if (database.kind === "CUSTOM") {
    const fields = await loadFields(ctx.db, space.id, database.id);
    const total = await ctx.db.databaseRecord.count({
      where: { organizationId: space.id, databaseId: database.id, deletedAt: null },
    });
    return { database, columns: customColumns(fields), total };
  }
  const { vctx, source, columns } = builtInView(ctx, space, database);
  if (!(await ballotRowsOpen(ctx, space, database))) {
    return { database, columns: columns.map(columnOf), total: null };
  }
  const { where } = queryFor(source, vctx, {});
  return {
    database,
    columns: columns.map(columnOf),
    total: await source.count(ctx.db, where, vctx),
  };
}

/** A database for fetch: what it is, its columns and how many rows it has (not the rows). */
export async function fetchDatabase(session: ConnectorSession, ref: ItemRef): Promise<FetchedItem> {
  const { space, database, columns, total } = await inSpace(
    session,
    ref.spaceId,
    DATABASES,
    async (ctx, space) => ({ space, ...(await describeDatabase(ctx, space, ref.id)) }),
  );
  const summary = summaryOf(space, database);
  const text = [
    `# ${summary.name}`,
    summary.description,
    `Columns: ${columns.map((c) => `${c.label} (${c.type})`).join(", ")}`,
    total === null
      ? "Who voted for what is private from this member's role; the results are on its page."
      : `${total} ${total === 1 ? "row" : "rows"}; query_database reads them.`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    id: summary.id,
    title: summary.name,
    text,
    url: summary.url,
    metadata: {
      kind: "database",
      spaceId: space.id,
      space: space.name,
      type: summary.kind,
      rows: total,
    },
  };
}

// ---------------------------------------------------------------- registration

export const registerDatabaseTools: ToolRegistrar = (server, session) => {
  server.registerTool(
    "list_databases",
    {
      title: "List databases",
      description:
        "Lists the databases in one space that the member can open: the organization's built-in ones (sessions, attendance, sign-ups, ballots, people) and the ones it made.",
      inputSchema: listInput,
      outputSchema: listOutput,
      annotations: READ_ONLY,
    },
    (args) => readResult("list_databases", () => listDatabasesTool(session, args)),
  );
  server.registerTool(
    "query_database",
    {
      title: "Query a database",
      description:
        "Reads rows of one database, with its columns. Words in query search every row; built-in databases also take filters and a sort, by the column keys and operators the columns list.",
      inputSchema: queryInput,
      outputSchema: queryOutput,
      annotations: READ_ONLY,
    },
    (args) => readResult("query_database", () => queryDatabase(session, args)),
  );
};
