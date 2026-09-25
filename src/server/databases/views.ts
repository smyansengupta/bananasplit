import type { ColumnConfig, ColumnView, RowView } from "@/components/databases/column-config";
import { resolveColumns } from "@/components/databases/column-config";
import type { DatabaseKind, MemberVisibility, Role } from "@/generated/prisma/client";
import { NotFoundError } from "@/lib/auth/errors";
import { can } from "@/lib/auth/permissions";
import { parseDbViewParams } from "@/lib/databases/href";
import type { TxClient } from "@/server/db/context";

import { allowedOps, buildQuery, parseKeyList, parseSize, resolveKey, type BuiltQuery } from "./query-builder";
import { hasSource } from "./sources";
import { tierOf, type DatabaseSource, type Tier, type ViewContext } from "./types";

/**
 * Database pages: which databases the viewer may see, and one page of one
 * database. Everything runs in the caller's withOrgTx (app_user), so RLS
 * applies to every row read here, including the drawer and the export.
 */

export type SearchParams = Record<string, string | string[] | undefined>;

export interface DatabaseSummary {
  id: string;
  key: string;
  name: string;
  icon: string | null;
  kind: DatabaseKind;
  memberVisibility: MemberVisibility;
  allowEdits: boolean;
  columns: unknown;
  /** OWNER/ADMIN may edit its rows (and the definition allows edits). */
  canEdit: boolean;
}

/** app.can_view_rows for the viewer's tier (the same function the RLS policies call). */
export async function canViewKind(db: TxClient, organizationId: string, kind: string, tier: Tier): Promise<boolean> {
  const rows = await db.$queryRaw<{ ok: boolean }[]>`
    SELECT app.can_view_rows(${organizationId}, ${kind}, ${tier}) AS ok`;
  return rows[0]?.ok === true;
}

/** app.can_view_ballot_rows for the viewer's tier: may they see individual votes? */
export async function canViewBallotRows(db: TxClient, organizationId: string, tier: Tier): Promise<boolean> {
  const rows = await db.$queryRaw<{ ok: boolean }[]>`
    SELECT app.can_view_ballot_rows(${organizationId}, ${tier}) AS ok`;
  return rows[0]?.ok === true;
}

function isListed(memberVisibility: MemberVisibility, tier: Tier, visible: boolean): boolean {
  if (!visible) return false;
  if (memberVisibility === "HIDDEN") return tier !== "MEMBER";
  return true;
}

/** The databases the viewer may open, in sidebar order. */
export async function listDatabases(
  db: TxClient,
  organizationId: string,
  role: Role,
): Promise<DatabaseSummary[]> {
  const tier = tierOf(role);
  if (!tier) return [];
  const defs = await db.databaseDefinition.findMany({
    where: { organizationId, archivedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const out: DatabaseSummary[] = [];
  for (const d of defs) {
    if (!hasSource(d.kind)) continue;
    const visible = await canViewKind(db, organizationId, d.kind, tier);
    if (!isListed(d.memberVisibility, tier, visible)) continue;
    out.push({
      id: d.id,
      key: d.key,
      name: d.name,
      icon: d.icon,
      kind: d.kind,
      memberVisibility: d.memberVisibility,
      allowEdits: d.allowEdits,
      columns: d.columns,
      canEdit: d.allowEdits && can({ role }, "databases.write"),
    });
  }
  return out;
}

/** One database by URL key, or NotFoundError when it does not exist or is not visible to the viewer. */
export async function getDatabase(
  db: TxClient,
  organizationId: string,
  role: Role,
  dbKey: string,
): Promise<DatabaseSummary> {
  const list = await listDatabases(db, organizationId, role);
  const found = list.find((d) => d.key === dbKey);
  if (!found) throw new NotFoundError();
  return found;
}

export function viewContextFor(
  org: { id: string; slug: string; timezone: string },
  role: Role,
  database: Pick<DatabaseSummary, "canEdit">,
  now = new Date(),
): ViewContext {
  return {
    organizationId: org.id,
    orgSlug: org.slug,
    timezone: org.timezone || "UTC",
    role,
    tier: tierOf(role) ?? "MEMBER",
    canEdit: database.canEdit,
    now,
  };
}

/** The columns this viewer may see (memberVisible=false columns are dropped for MEMBER tier). */
export function viewerColumns(source: DatabaseSource, overrides: unknown, tier: Tier): ColumnConfig[] {
  return resolveColumns(source.columns, overrides).filter((c) => tier !== "MEMBER" || c.memberVisible);
}

/** The visible column keys: cols= when given (and valid), otherwise the defaults. */
export function visibleColumnKeys(columns: readonly ColumnConfig[], sp: SearchParams): string[] {
  const listed = parseKeyList(sp.cols, columns.map((c) => c.key));
  if (listed && listed.length > 0) return listed;
  return columns.filter((c) => !c.hiddenByDefault).map((c) => c.key);
}

export function columnViews(
  columns: readonly ColumnConfig[],
  source: DatabaseSource,
  ctx: ViewContext,
  visible: readonly string[],
): ColumnView[] {
  const spec = source.query(ctx);
  const shown = new Set(visible);
  return columns.map((c) => {
    const key = resolveKey(spec, c.key);
    const field = key ? spec.fields[key] : undefined;
    return {
      key: c.key,
      label: c.label,
      type: c.type,
      sortable: Boolean(c.sortable && field?.sortable),
      filterable: Boolean(c.filterable && field?.filterable),
      ops: field?.filterable ? allowedOps(field) : [],
      options: "options" in c ? c.options : undefined,
      align: c.align,
      visible: shown.has(c.key),
    };
  });
}

export interface LoadedView {
  columns: ColumnView[];
  rows: RowView[];
  total: number;
  query: BuiltQuery;
}

/** The query for a view from its search params (shared by the page and the export). */
export function queryFor(source: DatabaseSource, ctx: ViewContext, sp: SearchParams, options: { size?: number } = {}) {
  const params = parseDbViewParams(sp);
  const spec = source.query(ctx);
  const noDefaults = parseKeyList(sp.nd, Object.keys(spec.fields)) ?? [];
  const built = buildQuery(spec, params, {
    timezone: ctx.timezone,
    size: options.size ?? parseSize(sp.size),
    noDefaults,
  });
  const where = { AND: [source.baseWhere(ctx), built.where] };
  return { built, where };
}

/** One page of one database, under the caller's RLS. */
export async function loadView(
  db: TxClient,
  source: DatabaseSource,
  columns: readonly ColumnConfig[],
  ctx: ViewContext,
  sp: SearchParams,
): Promise<LoadedView> {
  const { built, where } = queryFor(source, ctx, sp);
  const [rows, total] = [
    await source.list(db, { where, orderBy: built.orderBy, skip: built.skip, take: built.take }, ctx),
    await source.count(db, where, ctx),
  ];
  const visible = visibleColumnKeys(columns, sp);
  return {
    columns: columnViews(columns, source, ctx, visible),
    rows: rows.map(({ id, cells, dim }) => ({ id, cells, dim })),
    total,
    query: built,
  };
}
