/**
 * The database view URL grammar, shared by Databases (B4) and Reports (B5):
 *
 *   /app/{slug}/databases/{dbKey}
 *     ?f={col}:{op}:{value}      repeatable; op is eq, neq, gt, gte, lt, lte,
 *                                contains, in or isnull
 *     &sort={col}:{asc|desc}
 *     &q={search}
 *     &from={yyyy-mm-dd}&to={yyyy-mm-dd}
 *     &page={n}
 *     &row={id}
 *
 * Values: `in` takes a comma-separated list (items may not contain commas);
 * `isnull` takes true or false; dates are written yyyy-mm-dd; everything is
 * URL-encoded by URLSearchParams. Only the first two colons of an `f` value
 * are separators, so a value may itself contain colons (times, URLs).
 *
 * Column keys are validated here only for shape. The query builder must
 * still check every key against the database's own field map and bind every
 * value (never interpolate).
 */

export const DB_FILTER_OPS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "in",
  "isnull",
] as const;

export type DbFilterOp = (typeof DB_FILTER_OPS)[number];

export type DbFilterScalar = string | number | boolean | Date;

export interface DbViewFilter {
  col: string;
  op: DbFilterOp;
  /** A scalar, a list for `in`, or a boolean for `isnull` (default true). */
  value?: DbFilterScalar | readonly DbFilterScalar[] | null;
}

export interface DbViewSort {
  col: string;
  dir: "asc" | "desc";
}

export interface DbViewParams {
  filters?: readonly DbViewFilter[];
  sort?: DbViewSort;
  q?: string;
  /** yyyy-mm-dd, or a Date (its UTC calendar date). */
  from?: string | Date;
  to?: string | Date;
  page?: number;
  row?: string;
}

/** The parsed form: every value is a string (lists split for `in`). */
export interface ParsedDbFilter {
  col: string;
  op: DbFilterOp;
  value: string;
  /** Present for `in`. */
  values?: string[];
}

export interface ParsedDbViewParams {
  filters: ParsedDbFilter[];
  sort?: DbViewSort;
  q?: string;
  from?: string;
  to?: string;
  page: number;
  row?: string;
}

const COL = /^[A-Za-z][A-Za-z0-9_.]{0,63}$/;
const DB_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_FILTERS = 20;
const MAX_VALUE = 500;

export class DbViewParamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbViewParamError";
  }
}

function isOp(op: string): op is DbFilterOp {
  return (DB_FILTER_OPS as readonly string[]).includes(op);
}

function toDateString(value: string | Date): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new DbViewParamError("invalid date");
    return value.toISOString().slice(0, 10);
  }
  if (!DATE.test(value)) throw new DbViewParamError(`dates are yyyy-mm-dd (got ${value})`);
  return value;
}

function scalarToString(value: DbFilterScalar): string {
  if (value instanceof Date) return toDateString(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new DbViewParamError("numbers must be finite");
    return String(value);
  }
  return value;
}

function filterValue(filter: DbViewFilter): string {
  const { op, value } = filter;
  if (op === "isnull") {
    if (value === undefined || value === null) return "true";
    if (typeof value !== "boolean") throw new DbViewParamError("isnull takes true or false");
    return value ? "true" : "false";
  }
  if (op === "in") {
    const list = Array.isArray(value)
      ? value
      : value === undefined || value === null
        ? []
        : [value];
    const items = (list as DbFilterScalar[]).map(scalarToString);
    if (items.length === 0) throw new DbViewParamError("in needs at least one value");
    if (items.some((v) => v.includes(","))) {
      throw new DbViewParamError("in values may not contain commas");
    }
    return items.join(",");
  }
  if (value === undefined || value === null || Array.isArray(value)) {
    throw new DbViewParamError(`${op} needs a single value (use isnull for empty)`);
  }
  return scalarToString(value as DbFilterScalar);
}

/** The query string (without "?") for a database view. */
export function dbViewQuery(params: DbViewParams = {}): string {
  const search = new URLSearchParams();
  const filters = params.filters ?? [];
  if (filters.length > MAX_FILTERS) throw new DbViewParamError("too many filters");
  for (const filter of filters) {
    if (!COL.test(filter.col)) throw new DbViewParamError(`invalid column ${filter.col}`);
    if (!isOp(filter.op)) throw new DbViewParamError(`invalid operator ${String(filter.op)}`);
    const value = filterValue(filter);
    if (value.length > MAX_VALUE) throw new DbViewParamError("filter value too long");
    search.append("f", `${filter.col}:${filter.op}:${value}`);
  }
  if (params.sort) {
    if (!COL.test(params.sort.col)) throw new DbViewParamError(`invalid sort column`);
    if (params.sort.dir !== "asc" && params.sort.dir !== "desc") {
      throw new DbViewParamError("sort direction is asc or desc");
    }
    search.set("sort", `${params.sort.col}:${params.sort.dir}`);
  }
  if (params.q) search.set("q", params.q.slice(0, MAX_VALUE));
  if (params.from !== undefined) search.set("from", toDateString(params.from));
  if (params.to !== undefined) search.set("to", toDateString(params.to));
  if (params.page !== undefined && params.page !== 1) {
    if (!Number.isInteger(params.page) || params.page < 1) {
      throw new DbViewParamError("page is a positive integer");
    }
    search.set("page", String(params.page));
  }
  if (params.row) search.set("row", params.row);
  return search.toString();
}

/**
 * The URL of a database view, e.g.
 *   dbViewHref("claude-builders-club", "attendance",
 *     { filters: [{ col: "eventId", op: "eq", value: id }], sort: { col: "checkedInAt", dir: "desc" } })
 */
export function dbViewHref(slug: string, dbKey: string, params: DbViewParams = {}): string {
  if (!SLUG.test(slug)) throw new DbViewParamError(`invalid org slug ${slug}`);
  if (!DB_KEY.test(dbKey)) throw new DbViewParamError(`invalid database key ${dbKey}`);
  const query = dbViewQuery(params);
  const base = `/app/${slug}/databases/${dbKey}`;
  return query ? `${base}?${query}` : base;
}

type SearchParamsLike =
  | URLSearchParams
  | Record<string, string | string[] | undefined>
  | { get(name: string): string | null; getAll(name: string): string[] };

function getAll(sp: SearchParamsLike, name: string): string[] {
  if (typeof (sp as URLSearchParams).getAll === "function") {
    return (sp as URLSearchParams).getAll(name);
  }
  const v = (sp as Record<string, string | string[] | undefined>)[name];
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

function getOne(sp: SearchParamsLike, name: string): string | undefined {
  return getAll(sp, name)[0];
}

/**
 * Parses a view's search params. Malformed parts are dropped (a hand-edited
 * URL degrades to fewer filters instead of an error page); the caller still
 * validates columns against its field map.
 */
export function parseDbViewParams(sp: SearchParamsLike): ParsedDbViewParams {
  const filters: ParsedDbFilter[] = [];
  for (const raw of getAll(sp, "f").slice(0, MAX_FILTERS)) {
    const first = raw.indexOf(":");
    const second = first < 0 ? -1 : raw.indexOf(":", first + 1);
    if (second < 0) continue;
    const col = raw.slice(0, first);
    const op = raw.slice(first + 1, second);
    const value = raw.slice(second + 1);
    if (!COL.test(col) || !isOp(op) || value.length > MAX_VALUE) continue;
    if (op === "isnull") {
      if (value !== "true" && value !== "false") continue;
      filters.push({ col, op, value });
    } else if (op === "in") {
      const values = value.split(",").filter((v) => v.length > 0);
      if (values.length === 0) continue;
      filters.push({ col, op, value, values });
    } else {
      filters.push({ col, op, value });
    }
  }

  let sort: DbViewSort | undefined;
  const rawSort = getOne(sp, "sort");
  if (rawSort) {
    const [col, dir] = rawSort.split(":");
    if (col && COL.test(col) && (dir === "asc" || dir === "desc")) sort = { col, dir };
  }

  const q = getOne(sp, "q")?.slice(0, MAX_VALUE) || undefined;
  const from = getOne(sp, "from");
  const to = getOne(sp, "to");
  const pageRaw = Number(getOne(sp, "page") ?? "1");
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 && pageRaw <= 100_000 ? pageRaw : 1;
  const row = getOne(sp, "row") || undefined;

  return {
    filters,
    sort,
    q,
    from: from && DATE.test(from) ? from : undefined,
    to: to && DATE.test(to) ? to : undefined,
    page,
    row,
  };
}
