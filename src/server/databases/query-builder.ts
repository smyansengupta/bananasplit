import { TZDate } from "@date-fns/tz";

import type { DbFilterOp, DbViewSort, ParsedDbFilter, ParsedDbViewParams } from "@/lib/databases/href";

/**
 * The allowlisted query builder for database views (Phase 4a).
 *
 * It turns the view URL grammar (src/lib/databases/href.ts: f=col:op:value,
 * sort, q, from, to, page, plus this section's size, cols and nd) into a
 * typed Prisma where / orderBy / skip / take for one database, using ONLY
 * that database's static field map:
 *
 * - A column sorts or filters server-side only when its key (or alias) is in
 *   the field map with sortable / filterable set. Anything else is rejected
 *   and reported, never passed through.
 * - Values are parsed per field kind (enum values against the enum, numbers,
 *   booleans, dates in the org timezone) and handed to Prisma, which binds
 *   them. There is no raw SQL here: no $queryRaw, no Prisma.raw, no
 *   identifier ever comes from the URL.
 * - Derived columns (stamp numbers, term totals, first visits, lapsed,
 *   attendance counts, days to first attendance) are real columns maintained
 *   by app.refresh_contact_rollups / app.refresh_lapsed, so they sort and
 *   filter on indexes like any other column. A flag derived from one (People
 *   "lapsed" = lapsedSince is set) uses a custom `where` in its field spec.
 *
 * Dates: a yyyy-mm-dd value is an org-local calendar day. `eq` means that
 * day, `gte`/`lt` start at its local midnight, `gt`/`lte` at the next local
 * midnight, so DST days (23 or 25 hours) are handled by the timezone rules,
 * not by adding 24 hours.
 */

export type FieldKind =
  | "string"
  | "text"
  | "int"
  | "float"
  | "datetime"
  | "boolean"
  | "enum"
  | "jsonArray";

type Where = Record<string, unknown>;

export interface FieldSpec {
  /** Prisma path from the model: ["checkedInAt"] or ["contact", "displayName"]. */
  path: readonly string[];
  kind: FieldKind;
  enumValues?: readonly string[];
  sortable?: boolean;
  filterable?: boolean;
  /** Operators accepted (default: every operator that makes sense for the kind). */
  ops?: readonly DbFilterOp[];
  /** The column may be NULL (isnull allowed; sorts put NULLs last). */
  nullable?: boolean;
  /** jsonArray: the key inside the JSON column, e.g. ["colleges"]. */
  jsonPath?: readonly string[];
  /** A custom filter for derived flags; receives the parsed value. */
  where?: (op: DbFilterOp, value: ParsedValue) => Where | null;
  /** A custom sort (e.g. a derived flag sorts by its source column). */
  orderBy?: (dir: "asc" | "desc") => Where[];
}

export type ParsedValue = string | number | boolean | Date | (string | number | boolean)[] | DayRange | null;

/** An org-local calendar day: [start, end). */
export interface DayRange {
  day: string;
  start: Date;
  end: Date;
}

export interface QuerySpec {
  fields: Readonly<Record<string, FieldSpec>>;
  /** Other names accepted in URLs (for readable report links): alias -> key. */
  aliases?: Readonly<Record<string, string>>;
  /** Field keys searched by ?q= (string or text kinds). */
  search?: readonly string[];
  /** Extra search conditions (e.g. an email through a related table). */
  searchExtra?: (q: string) => Where[];
  /** The field that ?from= / ?to= filter (a datetime field key). */
  dateField?: string;
  defaultSort: DbViewSort;
  /** A unique, stable tiebreaker appended to every sort. */
  tiebreak: (dir: "asc" | "desc") => Where[];
  /**
   * Filters applied when the URL has no filter on that column and does not
   * name it in nd=. `skipIf` lists other keys whose explicit filter also
   * turns the default off; `onlyUnfiltered` applies it only when the URL has
   * no explicit filter at all (a report deep link states everything it
   * means, e.g. People's current-term default).
   */
  defaultFilters?: readonly DefaultFilter[];
}

export interface DefaultFilter extends ParsedDbFilter {
  skipIf?: readonly string[];
  onlyUnfiltered?: boolean;
}

export interface QueryOptions {
  timezone: string;
  /** Rows per page (size param); defaults to 50, capped at 100. */
  size?: number;
  /** Column keys named in the nd= param: their default filter is off. */
  noDefaults?: readonly string[];
}

export interface AppliedFilter {
  col: string;
  op: DbFilterOp;
  value: string;
  /** Came from the database's defaults, not the URL. */
  isDefault?: boolean;
}

export interface Rejection {
  part: string;
  reason: string;
}

export interface BuiltQuery {
  where: Where;
  orderBy: Where[];
  skip: number;
  take: number;
  page: number;
  size: number;
  sort: DbViewSort;
  filters: AppliedFilter[];
  rejected: Rejection[];
  q?: string;
  from?: string;
  to?: string;
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
const MAX_IN_VALUES = 100;

export class DbQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbQueryError";
  }
}

/** The operators each field kind accepts when the spec does not narrow them. */
export function defaultOps(kind: FieldKind, nullable = false): DbFilterOp[] {
  const withNull = (ops: DbFilterOp[]): DbFilterOp[] => (nullable ? [...ops, "isnull"] : ops);
  switch (kind) {
    case "string":
      return withNull(["eq", "neq", "contains", "in"]);
    case "text":
      return withNull(["contains", "eq"]);
    case "int":
    case "float":
      return withNull(["eq", "neq", "gt", "gte", "lt", "lte", "in"]);
    case "datetime":
      return withNull(["eq", "gt", "gte", "lt", "lte"]);
    case "boolean":
      return withNull(["eq", "neq"]);
    case "enum":
      return withNull(["eq", "neq", "in"]);
    case "jsonArray":
      return ["contains", "eq", "in"];
  }
}

export function allowedOps(spec: FieldSpec): DbFilterOp[] {
  return spec.ops ? [...spec.ops] : defaultOps(spec.kind, spec.nullable);
}

/** Resolves a URL column name (or alias) to a field key. */
export function resolveKey(spec: QuerySpec, col: string): string | null {
  if (Object.prototype.hasOwnProperty.call(spec.fields, col)) return col;
  const alias = spec.aliases?.[col];
  if (alias && Object.prototype.hasOwnProperty.call(spec.fields, alias)) return alias;
  return null;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})?$/;

/** The org-local day [start, end) of a yyyy-mm-dd string, or null. */
export function localDay(day: string, timezone: string): DayRange | null {
  if (!DATE_ONLY.test(day)) return null;
  const [y, m, d] = day.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const start = new TZDate(y, m - 1, d, timezone || "UTC");
  if (start.getDate() !== d) return null; // 2026-02-31
  const end = new TZDate(y, m - 1, d + 1, timezone || "UTC");
  return { day, start: new Date(start.getTime()), end: new Date(end.getTime()) };
}

function parseScalar(spec: FieldSpec, raw: string, timezone: string): ParsedValue | undefined {
  const value = raw.trim();
  switch (spec.kind) {
    case "string":
    case "text":
    case "jsonArray":
      return value.length > 0 && value.length <= 500 ? value : undefined;
    case "int": {
      if (!/^-?\d{1,9}$/.test(value)) return undefined;
      return Number.parseInt(value, 10);
    }
    case "float": {
      const n = Number(value);
      return value !== "" && Number.isFinite(n) ? n : undefined;
    }
    case "boolean": {
      const v = value.toLowerCase();
      if (["true", "1", "yes"].includes(v)) return true;
      if (["false", "0", "no"].includes(v)) return false;
      return undefined;
    }
    case "enum": {
      const found = spec.enumValues?.find((e) => e.toLowerCase() === value.toLowerCase());
      return found ?? undefined;
    }
    case "datetime": {
      if (DATE_ONLY.test(value)) return localDay(value, timezone) ?? undefined;
      if (DATE_TIME.test(value)) {
        const d = new Date(value.replace(" ", "T"));
        return Number.isNaN(d.getTime()) ? undefined : d;
      }
      return undefined;
    }
  }
}

function isDayRange(v: unknown): v is DayRange {
  return typeof v === "object" && v !== null && "start" in v && "end" in v && "day" in v;
}

/** Wraps a leaf condition in the field's relation path: ["contact","x"] -> { contact: { x: cond } }. */
function nest(path: readonly string[], leaf: unknown): Where {
  let out: unknown = leaf;
  for (let i = path.length - 1; i >= 0; i--) out = { [path[i]]: out };
  return out as Where;
}

function leafCondition(spec: FieldSpec, op: DbFilterOp, value: ParsedValue): unknown {
  const insensitive = spec.kind === "string" || spec.kind === "text" ? { mode: "insensitive" } : {};
  if (spec.kind === "datetime") {
    const asRange = isDayRange(value);
    const at = (which: "start" | "end") => (asRange ? (value as DayRange)[which] : (value as Date));
    switch (op) {
      case "eq":
        return asRange ? { gte: at("start"), lt: at("end") } : { equals: value };
      case "gt":
        return asRange ? { gte: at("end") } : { gt: value };
      case "gte":
        return { gte: at("start") };
      case "lt":
        return { lt: at("start") };
      case "lte":
        return asRange ? { lt: at("end") } : { lte: value };
      default:
        return undefined;
    }
  }
  switch (op) {
    case "eq":
      // Free text compares case-insensitively; ids and codes ("string") exactly.
      return spec.kind === "text" ? { equals: value, ...insensitive } : { equals: value };
    case "neq":
      return { not: value };
    case "gt":
      return { gt: value };
    case "gte":
      return { gte: value };
    case "lt":
      return { lt: value };
    case "lte":
      return { lte: value };
    case "contains":
      return { contains: value, ...insensitive };
    case "in":
      return { in: value };
    default:
      return undefined;
  }
}

/** The where fragment for one filter on one field, or null when it cannot apply. */
export function filterWhere(spec: FieldSpec, op: DbFilterOp, value: ParsedValue): Where | null {
  if (spec.where) return spec.where(op, value);
  if (op === "isnull") {
    return nest(spec.path, value === true ? null : { not: null });
  }
  if (spec.kind === "jsonArray") {
    const jsonPath = [...(spec.jsonPath ?? [])];
    const one = (v: string | number | boolean) => nest(spec.path, { path: jsonPath, array_contains: [v] });
    if (op === "in" && Array.isArray(value)) return { OR: value.map(one) };
    if ((op === "contains" || op === "eq") && typeof value === "string") return one(value);
    return null;
  }
  if (spec.kind === "boolean" && op === "neq" && !spec.nullable) {
    return nest(spec.path, { equals: !value });
  }
  const leaf = leafCondition(spec, op, value);
  if (leaf === undefined) return null;
  return nest(spec.path, leaf);
}

/** Parses one filter's value(s) for the field; undefined when invalid. */
export function parseFilterValue(
  spec: FieldSpec,
  filter: ParsedDbFilter,
  timezone: string,
): ParsedValue | undefined {
  if (filter.op === "isnull") {
    if (filter.value === "true") return true;
    if (filter.value === "false") return false;
    return undefined;
  }
  if (filter.op === "in") {
    const raw = filter.values ?? filter.value.split(",");
    if (raw.length === 0 || raw.length > MAX_IN_VALUES) return undefined;
    const parsed: (string | number | boolean)[] = [];
    for (const r of raw) {
      const v = parseScalar(spec, r, timezone);
      if (v === undefined || v === null || v instanceof Date || isDayRange(v) || Array.isArray(v)) {
        return undefined;
      }
      parsed.push(v);
    }
    return parsed;
  }
  return parseScalar(spec, filter.value, timezone);
}

function sortFor(spec: FieldSpec, dir: "asc" | "desc"): Where[] {
  if (spec.orderBy) return spec.orderBy(dir);
  const leaf = spec.nullable ? { sort: dir, nulls: "last" } : dir;
  return [nest(spec.path, leaf)];
}

/**
 * Builds the Prisma query for a view. Invalid parts are dropped and listed in
 * `rejected` (the page shows them); with `strict` the first one throws.
 */
export function buildQuery(
  spec: QuerySpec,
  params: ParsedDbViewParams,
  options: QueryOptions & { strict?: boolean },
): BuiltQuery {
  const rejected: Rejection[] = [];
  const reject = (part: string, reason: string) => {
    if (options.strict) throw new DbQueryError(`${part}: ${reason}`);
    rejected.push({ part, reason });
  };
  const tz = options.timezone || "UTC";
  const and: Where[] = [];
  const filters: AppliedFilter[] = [];
  const filteredKeys = new Set<string>();

  for (const f of params.filters) {
    const part = `${f.col}:${f.op}:${f.value}`;
    const key = resolveKey(spec, f.col);
    if (!key) {
      reject(part, "unknown column");
      continue;
    }
    const field = spec.fields[key];
    if (!field.filterable) {
      reject(part, "this column cannot be filtered");
      continue;
    }
    if (!allowedOps(field).includes(f.op)) {
      reject(part, `the ${f.op} operator does not apply to this column`);
      continue;
    }
    const value = parseFilterValue(field, f, tz);
    if (value === undefined) {
      reject(part, "invalid value");
      continue;
    }
    const where = filterWhere(field, f.op, value);
    if (!where) {
      reject(part, "invalid filter");
      continue;
    }
    and.push(where);
    filters.push({ col: key, op: f.op, value: f.value });
    filteredKeys.add(key);
  }

  const noDefaults = new Set(options.noDefaults ?? []);
  for (const f of spec.defaultFilters ?? []) {
    const key = resolveKey(spec, f.col);
    if (!key || filteredKeys.has(key) || noDefaults.has(key)) continue;
    if (f.skipIf?.some((k) => filteredKeys.has(k))) continue;
    if (f.onlyUnfiltered && filters.length > 0) continue;
    const field = spec.fields[key];
    const value = parseFilterValue(field, f, tz);
    const where = value === undefined ? null : filterWhere(field, f.op, value);
    if (!where) continue;
    and.push(where);
    filters.push({ col: key, op: f.op, value: f.value, isDefault: true });
  }

  let q: string | undefined;
  if (params.q) {
    q = params.q.trim().slice(0, 100);
    if (q) {
      const or: Where[] = [];
      for (const key of spec.search ?? []) {
        const field = spec.fields[key];
        if (!field || (field.kind !== "string" && field.kind !== "text")) continue;
        or.push(nest(field.path, { contains: q, mode: "insensitive" }));
      }
      or.push(...(spec.searchExtra?.(q) ?? []));
      if (or.length) and.push({ OR: or });
    } else {
      q = undefined;
    }
  }

  let from: string | undefined;
  let to: string | undefined;
  if ((params.from || params.to) && spec.dateField) {
    const field = spec.fields[spec.dateField];
    if (params.from) {
      const r = localDay(params.from, tz);
      if (r) {
        and.push(nest(field.path, { gte: r.start }));
        from = params.from;
      } else reject(`from=${params.from}`, "invalid date");
    }
    if (params.to) {
      const r = localDay(params.to, tz);
      if (r) {
        and.push(nest(field.path, { lt: r.end }));
        to = params.to;
      } else reject(`to=${params.to}`, "invalid date");
    }
  } else if (params.from || params.to) {
    reject("from/to", "this database has no date column");
  }

  let sort = spec.defaultSort;
  if (params.sort) {
    const key = resolveKey(spec, params.sort.col);
    const field = key ? spec.fields[key] : undefined;
    if (!key || !field) reject(`sort=${params.sort.col}`, "unknown column");
    else if (!field.sortable) reject(`sort=${params.sort.col}`, "this column cannot be sorted");
    else sort = { col: key, dir: params.sort.dir };
  }
  const sortField = spec.fields[sort.col];
  const orderBy = [...(sortField ? sortFor(sortField, sort.dir) : []), ...spec.tiebreak(sort.dir)];

  const size = Math.min(Math.max(1, Math.trunc(options.size ?? DEFAULT_PAGE_SIZE)), MAX_PAGE_SIZE);
  const page = Math.max(1, params.page);

  return {
    where: and.length ? { AND: and } : {},
    orderBy,
    skip: (page - 1) * size,
    take: size,
    page,
    size,
    sort,
    filters,
    rejected,
    q,
    from,
    to,
  };
}

/** Parses the size= param (25, 50 or 100 in the UI; anything 1-100 accepted). */
export function parseSize(raw: string | string[] | undefined): number {
  const v = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(v) && v >= 1 ? Math.min(v, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
}

/** Parses a comma list param (cols=, nd=) into keys of the given set. */
export function parseKeyList(raw: string | string[] | undefined, allowed: Iterable<string>): string[] | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return null;
  const set = new Set(allowed);
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => set.has(s));
}
