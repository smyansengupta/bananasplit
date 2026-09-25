import { z } from "zod";

/**
 * Database column configuration (Phase 4a): the one description of a column
 * that drives the table header, the cell renderer, the filter builder, the
 * CSV export and the row drawer. Pure and client-safe; the server's field map
 * (src/server/databases/sources) decides which columns sort and filter
 * server-side.
 *
 * A DatabaseDefinition's `columns` JSON may override the built-in set per
 * column key (label, hiddenByDefault, memberVisible); an empty array means
 * "the built-in columns from code". Adding a database type is a new
 * definition plus a field map, not a new table component.
 */

export const COLUMN_TYPES = [
  "text",
  "longtext",
  "number",
  "date",
  "datetime",
  "email",
  "url",
  "boolean",
  "select",
  "multiselect",
  "person",
  "relation",
  "link",
] as const;

export type ColumnType = (typeof COLUMN_TYPES)[number];

const option = z.object({ value: z.string(), label: z.string() });

const base = {
  key: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/),
  label: z.string().min(1).max(80),
  /** Sortable server-side (only honoured when the field map has the key). */
  sortable: z.boolean().default(false),
  /** Filterable server-side (same). */
  filterable: z.boolean().default(false),
  /** Included in the ?q= search. */
  searchable: z.boolean().default(false),
  /** Personal data: shown only as far as the viewer's tier allows (RLS decides). */
  pii: z.boolean().default(false),
  /** false hides the column from MEMBER-tier viewers entirely. */
  memberVisible: z.boolean().default(true),
  /** Off in the default column set; the viewer can turn it on. */
  hiddenByDefault: z.boolean().default(false),
  /** Right-aligned numeric look. */
  align: z.enum(["left", "right"]).optional(),
  /** Left out of CSV exports (links, avatars). */
  exportable: z.boolean().default(true),
};

export const columnConfigSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("text") }),
  z.object({ ...base, type: z.literal("longtext") }),
  z.object({ ...base, type: z.literal("number") }),
  z.object({ ...base, type: z.literal("date") }),
  z.object({ ...base, type: z.literal("datetime") }),
  z.object({ ...base, type: z.literal("email") }),
  z.object({ ...base, type: z.literal("url") }),
  z.object({ ...base, type: z.literal("boolean") }),
  z.object({ ...base, type: z.literal("select"), options: z.array(option).default([]) }),
  z.object({ ...base, type: z.literal("multiselect"), options: z.array(option).default([]) }),
  z.object({ ...base, type: z.literal("person") }),
  z.object({ ...base, type: z.literal("relation"), target: z.string().optional() }),
  z.object({ ...base, type: z.literal("link") }),
]);

export type ColumnConfig = z.infer<typeof columnConfigSchema>;
export type ColumnConfigInput = z.input<typeof columnConfigSchema>;

/** Per-org overrides stored in DatabaseDefinition.columns. */
export const columnOverrideSchema = z.object({
  key: z.string(),
  label: z.string().min(1).max(80).optional(),
  hiddenByDefault: z.boolean().optional(),
  memberVisible: z.boolean().optional(),
});

/** Parses a built-in column list (throws on a programming error). */
export function defineColumns(columns: ColumnConfigInput[]): ColumnConfig[] {
  return columns.map((c) => columnConfigSchema.parse(c));
}

/**
 * The effective columns of a database: the built-in set with the org's
 * overrides applied by key. Overrides for unknown keys and malformed entries
 * are ignored (a stale override never breaks the page).
 */
export function resolveColumns(builtin: readonly ColumnConfig[], overrides: unknown): ColumnConfig[] {
  const list = Array.isArray(overrides) ? overrides : [];
  const byKey = new Map<string, z.infer<typeof columnOverrideSchema>>();
  for (const raw of list) {
    const parsed = columnOverrideSchema.safeParse(raw);
    if (parsed.success) byKey.set(parsed.data.key, parsed.data);
  }
  return builtin.map((c) => {
    const o = byKey.get(c.key);
    if (!o) return c;
    return {
      ...c,
      ...(o.label !== undefined ? { label: o.label } : {}),
      ...(o.hiddenByDefault !== undefined ? { hiddenByDefault: o.hiddenByDefault } : {}),
      ...(o.memberVisible !== undefined ? { memberVisible: o.memberVisible } : {}),
    };
  });
}

/** What the client table receives for each column (no server-only detail). */
export interface ColumnView {
  key: string;
  label: string;
  type: ColumnType;
  sortable: boolean;
  filterable: boolean;
  /** Operators the server accepts for this column. */
  ops: string[];
  options?: { value: string; label: string }[];
  align?: "left" | "right";
  visible: boolean;
}

/** One rendered cell. The server formats values (dates in the org timezone). */
export type Cell =
  | null
  | { t: "text"; v: string; title?: string; muted?: boolean }
  | { t: "number"; v: number | null; text?: string }
  | { t: "bool"; v: boolean | null }
  | { t: "badge"; v: string; tone?: "default" | "secondary" | "outline" | "destructive" | "success" | "warning" }
  | { t: "badges"; v: string[] }
  | { t: "person"; name: string; user?: { name: string | null; image: string | null; avatar: unknown } | null; sub?: string }
  | { t: "link"; href: string; label: string; external?: boolean };

export interface RowView {
  id: string;
  cells: Record<string, Cell>;
  /** Row styling: suppressed or excluded rows are dimmed. */
  dim?: boolean;
}
