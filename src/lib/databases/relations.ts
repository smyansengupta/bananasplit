import { crmRecordHref } from "@/lib/crm/href";

import { dbViewHref } from "./href";
import type { RelationKind, RelationRef } from "./fields";

/**
 * RELATION links as the browser shows them (client-safe): a linked
 * record's name, and where it opens. The server resolves the names
 * (src/server/databases/relations.ts).
 */

/** A linked record, as a chip shows it. */
export interface RelationLabel {
  kind: RelationKind;
  id: string;
  label: string;
  /** A second line: a person's title, a company's domain, an item's pipeline, a row's database. */
  sub?: string;
  /** "record" links: the database's URL key (for its ?row= link). */
  dbKey?: string;
}

export function relationKey(ref: RelationRef): string {
  return `${ref.kind}:${ref.id}`;
}

/** Where a linked record opens, or null when it can't be opened from here. */
export function relationHref(
  orgSlug: string,
  label: RelationRef & { dbKey?: string },
): string | null {
  if (label.kind === "record") {
    return label.dbKey ? dbViewHref(orgSlug, label.dbKey, { row: label.id }) : null;
  }
  return crmRecordHref(orgSlug, label.kind, label.id);
}
