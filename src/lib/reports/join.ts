import { z } from "zod";

import { sourceKeySchema, type ReportField, type SourceSummary } from "./catalog";
import { cellText, type LoadedSource } from "./compute";

/**
 * A report's second database, joined on a shared field: each row of the
 * report's own database picks up the fields of the row in the second one
 * whose field reads the same (Expenses' "Paid to" against Sponsors'
 * "Name", ignoring case and spaces), so a widget can split money by sponsor
 * tier or count tasks by owner team. Like a spreadsheet lookup: the first
 * match wins and a row with none just has those fields empty. Pure: the
 * walkthrough shows the joined fields with it and the server joins with it.
 */

export interface ReportJoin {
  source: string;
  /** The field of the report's own database. */
  field: string;
  /** The field of the second database it's matched against. */
  otherField: string;
}

export const reportJoinSchema = z
  .object({ source: sourceKeySchema, field: z.string().max(64), otherField: z.string().max(64) })
  .strict();

export function readJoin(raw: unknown): ReportJoin | null {
  const parsed = reportJoinSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** A joined field's id: the second database's field id behind "j.". */
export const JOINED = "j.";

const MATCHABLE = new Set(["TEXT", "EMAIL", "PHONE", "URL", "SELECT", "MEMBER", "NUMBER"]);

/** Fields a join can match on: one value a row is known by. */
export function matchableFields(source: Pick<SourceSummary, "fields">): ReportField[] {
  return source.fields.filter((f) => MATCHABLE.has(f.type) && !f.id.startsWith(JOINED));
}

function joinedFields(other: SourceSummary, join: ReportJoin): ReportField[] {
  return other.fields
    .filter((f) => f.id !== join.otherField && !f.id.startsWith(JOINED))
    .map((f) => ({ ...f, id: `${JOINED}${f.id}`, name: `${f.name} (${other.name})` }));
}

/** The report's database with the second one's fields added, for picking widgets. */
export function joinedSummary(
  primary: SourceSummary,
  other: SourceSummary,
  join: ReportJoin,
): SourceSummary {
  return { ...primary, fields: [...primary.fields, ...joinedFields(other, join)] };
}

function key(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Each row of `primary` with its match's fields from `other`. */
export function applyJoin(
  primary: LoadedSource,
  other: LoadedSource,
  join: ReportJoin,
): LoadedSource {
  const mine = primary.fields.find((f) => f.id === join.field);
  const theirs = other.fields.find((f) => f.id === join.otherField);
  if (!mine || !theirs) return primary;
  const lookup = new Map<string, Record<string, unknown>>();
  for (const r of other.records) {
    const k = key(cellText(other, theirs, r.values[theirs.id]));
    if (k && !lookup.has(k)) lookup.set(k, r.values);
  }
  const fields = joinedFields(other, join);
  return {
    ...primary,
    fields: [...primary.fields, ...fields],
    members: { ...other.members, ...primary.members },
    records: primary.records.map((r) => {
      const match = lookup.get(key(cellText(primary, mine, r.values[mine.id])));
      if (!match) return r;
      const extra: Record<string, unknown> = {};
      for (const f of fields) {
        const v = match[f.id.slice(JOINED.length)];
        if (v !== undefined) extra[f.id] = v;
      }
      return { ...r, values: { ...r.values, ...extra } };
    }),
  };
}

/** How many of the report's rows found a match, for the walkthrough and the report. */
export function matchCount(primary: LoadedSource): number {
  return primary.records.filter((r) => Object.keys(r.values).some((k) => k.startsWith(JOINED)))
    .length;
}
