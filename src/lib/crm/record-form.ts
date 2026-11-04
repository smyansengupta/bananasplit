import type { FieldDef } from "@/lib/databases/fields";

import type { BuiltinType } from "./fields";

/**
 * The editable fields of a record, as the record page and the Databases
 * row panel show them: one list, built on the server (src/server/crm/
 * forms.ts), edited in the browser (src/components/crm/record-fields.tsx),
 * saved back through one action. Client-safe types and the owner encoding.
 */

export type EditKind = BuiltinType | "OWNER" | "CUSTOM";

export interface EditOption {
  value: string;
  label: string;
}

export interface EditField {
  /** A built-in key ("title") or "custom.<fieldId>". */
  key: string;
  label: string;
  kind: EditKind;
  /** As the editor holds it: text, a number, "yyyy-mm-dd", a boolean, an id, or custom JSON. */
  value: unknown;
  /** What the value reads as (a company's name, a stage's name). */
  display?: string | null;
  options?: EditOption[];
  /** CUSTOM: the field itself. */
  field?: FieldDef;
  readOnly?: boolean;
  required?: boolean;
  /** Shown under the fields in "More" rather than up top. */
  more?: boolean;
}

/** An owner is a member ("u:<id>") or an org-chart position ("r:<key>"). */
export function encodeOwner(ownerId: string | null, ownerRoleKey: string | null): string {
  if (ownerRoleKey) return `r:${ownerRoleKey}`;
  if (ownerId) return `u:${ownerId}`;
  return "";
}

export function decodeOwner(value: unknown): { ownerId: string | null; ownerRoleKey: string | null } {
  const s = typeof value === "string" ? value : "";
  if (s.startsWith("r:")) return { ownerId: null, ownerRoleKey: s.slice(2) || null };
  if (s.startsWith("u:")) return { ownerId: s.slice(2) || null, ownerRoleKey: null };
  return { ownerId: null, ownerRoleKey: null };
}

/** A Date as the date input's value (UTC day). */
export function dayValue(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}
