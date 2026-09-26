import type { ColumnConfig, RowView } from "@/components/databases/column-config";
import type { DatabaseKind, Role } from "@/generated/prisma/client";
import type { TxClient } from "@/server/db/context";

import type { QuerySpec } from "./query-builder";

/** The viewer's tier for privacy decisions: TREASURER reads as MEMBER. */
export type Tier = "OWNER" | "ADMIN" | "MEMBER";

export function tierOf(role: Role | null | undefined): Tier | null {
  if (!role) return null;
  if (role === "OWNER") return "OWNER";
  if (role === "ADMIN") return "ADMIN";
  return "MEMBER";
}

/** Everything a source needs to query and render one view. */
export interface ViewContext {
  organizationId: string;
  orgSlug: string;
  timezone: string;
  role: Role;
  tier: Tier;
  /** OWNER/ADMIN and the database allows edits. */
  canEdit: boolean;
  now: Date;
}

export interface ListArgs {
  where: Record<string, unknown>;
  orderBy: Record<string, unknown>[];
  skip?: number;
  take: number;
  /** Keyset export: the previous page's last row. */
  cursor?: unknown;
}

/** One exported row: CSV values by column key (already formatted, formula-guarded later). */
export type CsvValues = Record<string, string | number | boolean | null>;

export interface MappedRow extends RowView {
  csv: CsvValues;
  /** Keyset cursor of this row (for the export's next page). */
  cursor: unknown;
}

/**
 * A database kind's data source: the column set, the allowlisted field map
 * (QuerySpec) and the typed Prisma reads. The generic table, the export and
 * the drawer are driven by this; a new database type is a new source plus a
 * DatabaseDefinition row.
 */
export interface DatabaseSource {
  kind: DatabaseKind;
  /** A sub-view name for kinds with several (ballots: choices, ballots). */
  view?: string;
  columns: ColumnConfig[];
  query: (ctx: ViewContext) => QuerySpec;
  /** Tenant and lifecycle scope every query starts from (RLS applies as well). */
  baseWhere: (ctx: ViewContext) => Record<string, unknown>;
  list: (db: TxClient, args: ListArgs, ctx: ViewContext) => Promise<MappedRow[]>;
  count: (db: TxClient, where: Record<string, unknown>, ctx: ViewContext) => Promise<number>;
  /** CSV header label per column (dates name the timezone). */
  csvHeader?: (column: ColumnConfig, ctx: ViewContext) => string;
}
