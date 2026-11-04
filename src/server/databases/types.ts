import type { ColumnConfig, RowView } from "@/components/databases/column-config";
import type { DatabaseKind, Prisma, Role } from "@/generated/prisma/client";
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

/**
 * The databases a space lists. Every space has the built-in ones (made with
 * it: app.ensure_org_defaults), but they read a club's own sessions,
 * check-ins, sign-ups, votes and members, so a Personal space lists only
 * the databases its owner makes (CUSTOM) and, once it has the CRM, the
 * CRM's People, Companies and pipelines (filled by its integrations: email,
 * calls, meetings). Spread into a DatabaseDefinition query's where; it only
 * sets NOT, so it can sit beside AND and OR filters.
 */
export const LISTED_DEFINITIONS = {
  NOT: {
    kind: { notIn: ["CUSTOM", "CRM_PEOPLE", "CRM_COMPANIES", "CRM_PIPELINE"] },
    organization: { kind: "PERSONAL" },
  },
} satisfies Prisma.DatabaseDefinitionWhereInput;

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
