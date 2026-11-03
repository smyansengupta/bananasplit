import { readRelation, type FieldDef } from "@/lib/databases/fields";
import { fieldLabel, formatMoney, STATUS_LABELS, type CrmObject, type RecordStatus } from "@/lib/crm/fields";
import type { TxClient } from "@/server/db/context";

import type { TimelineEntry } from "./activity";
import type { HistoryEntry } from "./history";

/**
 * Record pages, readable: field history as "Title: Intern to Lead", and the
 * timeline's other records by name. Server-side, so the client gets text.
 */

export interface PresentedHistory {
  id: string;
  field: string;
  label: string;
  oldValue: string;
  newValue: string;
  by: string | null;
  source: string;
  changedAt: string;
}

const SKIP = new Set(["stageEnteredAt", "closedAt", "updatedById"]);

function show(
  key: string,
  value: unknown,
  ctx: { stages: ReadonlyMap<string, string>; names: ReadonlyMap<string, string>; custom: ReadonlyMap<string, FieldDef> },
): string {
  if (value === null || value === undefined || value === "") return "";
  if (key === "stageId") return ctx.stages.get(String(value)) ?? "A removed stage";
  if (key === "ownerId") return ctx.names.get(String(value)) ?? "A former member";
  if (key === "status") return STATUS_LABELS[value as RecordStatus] ?? String(value);
  if (key === "amountCents" && typeof value === "number") return formatMoney(value);
  if (key === "doNotContact") return value === true ? "Yes" : "No";
  if (key === "merged" && typeof value === "object") return `Merged in ${(value as { name?: string }).name ?? "a duplicate"}`;
  if (key.startsWith("custom.")) {
    const f = ctx.custom.get(key.slice(7));
    if (f?.type === "RELATION") {
      const n = readRelation(value).length;
      return n === 1 ? "1 link" : `${n} links`;
    }
    if (f?.options.choices) {
      const ids = Array.isArray(value) ? value : [value];
      return ids.map((i) => f.options.choices!.find((c) => c.id === i)?.label ?? "").filter(Boolean).join(", ");
    }
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  if (typeof value === "object") return JSON.stringify(value).slice(0, 120);
  return String(value).slice(0, 300);
}

export function presentHistory(
  entries: readonly HistoryEntry[],
  object: CrmObject,
  fields: readonly FieldDef[],
  names: ReadonlyMap<string, string>,
  stages: ReadonlyMap<string, string> = new Map(),
): PresentedHistory[] {
  const custom = new Map(fields.map((f) => [f.id, f]));
  const customNames = new Map(fields.map((f) => [f.id, f.name]));
  const labelOf = (key: string) => {
    if (key === "stageId") return "Stage";
    if (key === "ownerId") return "Owner";
    if (key === "ownerRoleKey") return "Owner (role)";
    if (key === "companyId") return "Company";
    if (key === "primaryPersonId") return "Person";
    if (key === "amountCents") return "Amount";
    if (key === "created") return "Added";
    if (key === "merged") return "Merged";
    if (key === "mergedInto") return "Merged into another";
    if (key === "deletedAt") return "Trash";
    if (key.startsWith("kept.")) return `Kept ${fieldLabel(object, key.slice(5), customNames)}`;
    return fieldLabel(object, key, customNames);
  };
  return entries
    .filter((e) => !SKIP.has(e.field))
    .map((e) => ({
      id: e.id,
      field: e.field,
      label: labelOf(e.field),
      oldValue: e.field === "deletedAt" ? (e.oldValue ? "In the trash" : "") : show(e.field, e.oldValue, { stages, names, custom }),
      newValue: e.field === "deletedAt" ? (e.newValue ? "In the trash" : "Restored") : show(e.field, e.newValue, { stages, names, custom }),
      by: e.changedById ? (names.get(e.changedById) ?? "A former member") : null,
      source: e.source,
      changedAt: e.changedAt.toISOString(),
    }));
}

export interface PresentedEntry {
  id: string;
  kind: string;
  subject: string | null;
  body: string | null;
  occurredAt: string;
  actorId: string | null;
  sourceKind: string | null;
  targets: { kind: "person" | "company" | "deal"; id: string; label?: string }[];
}

/** The timeline with the other records it's about named. */
export async function presentTimeline(
  db: TxClient,
  organizationId: string,
  entries: readonly TimelineEntry[],
): Promise<PresentedEntry[]> {
  const ids = (k: string) => [...new Set(entries.flatMap((e) => e.targets.filter((t) => t.kind === k).map((t) => t.id)))];
  const labels = new Map<string, string>();
  const people = ids("person");
  if (people.length) {
    for (const p of await db.crmPerson.findMany({ where: { organizationId, id: { in: people } }, select: { id: true, name: true } })) {
      labels.set(`person:${p.id}`, p.name);
    }
  }
  const companies = ids("company");
  if (companies.length) {
    for (const c of await db.crmCompany.findMany({ where: { organizationId, id: { in: companies } }, select: { id: true, name: true } })) {
      labels.set(`company:${c.id}`, c.name);
    }
  }
  const deals = ids("deal");
  if (deals.length) {
    for (const d of await db.crmDeal.findMany({ where: { organizationId, id: { in: deals } }, select: { id: true, title: true } })) {
      labels.set(`deal:${d.id}`, d.title);
    }
  }
  return entries.map((e) => ({
    id: e.id,
    kind: e.kind,
    subject: e.subject,
    body: e.body,
    occurredAt: e.occurredAt.toISOString(),
    actorId: e.actorId,
    direction: e.direction,
    sourceKind: e.sourceKind,
    targets: e.targets.map((t) => ({ ...t, label: labels.get(`${t.kind}:${t.id}`) })),
  }));
}
