import { Prisma } from "@/generated/prisma/client";
import {
  displayText,
  readOptions,
  readRelation,
  type FieldDef,
  type FieldType,
  type RelationKind,
  type RelationRef,
} from "@/lib/databases/fields";
import { dbViewHref } from "@/lib/databases/href";
import { relationKey, relationHref, type RelationLabel } from "@/lib/databases/relations";
import { crmRecordHref } from "@/lib/crm/href";
import type { TxClient } from "@/server/db/context";

export { relationHref, relationKey, type RelationLabel };

/**
 * RELATION fields (src/lib/databases/fields.ts): a cell of any database
 * (a club-made one, or the CRM's People, Companies and pipelines) that
 * points at CRM people, companies, pipeline items, or rows of another
 * database. Values are [{kind, id}].
 *
 * Everything here runs in the caller's transaction as the member, so RLS
 * decides what can be seen: a row of a database the viewer can't open
 * neither resolves to a name nor shows up in a reverse lookup. Every query
 * still names the organization.
 */

const CRM_DB_KINDS = ["CRM_PEOPLE", "CRM_COMPANIES", "CRM_PIPELINE"] as const;

function primaryOf(fields: readonly FieldDef[]): FieldDef | undefined {
  return fields.find((f) => f.isPrimary) ?? fields[0];
}

async function fieldsOf(
  db: TxClient,
  organizationId: string,
  databaseIds: readonly string[],
): Promise<Map<string, FieldDef[]>> {
  const rows = databaseIds.length
    ? await db.databaseField.findMany({
        where: { organizationId, databaseId: { in: [...databaseIds] } },
        orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          name: true,
          type: true,
          options: true,
          isPrimary: true,
          databaseId: true,
        },
      })
    : [];
  const out = new Map<string, FieldDef[]>();
  for (const r of rows) {
    const list = out.get(r.databaseId) ?? [];
    list.push({
      id: r.id,
      name: r.name,
      type: r.type as FieldType,
      options: readOptions(r.options),
      isPrimary: r.isPrimary,
    });
    out.set(r.databaseId, list);
  }
  return out;
}

const NO_NAMES = new Map<string, string>();

/** Every ref's name, batched per kind. Refs the viewer can't see are left out. */
export async function resolveRelationLabels(
  db: TxClient,
  organizationId: string,
  refs: readonly RelationRef[],
): Promise<Map<string, RelationLabel>> {
  const out = new Map<string, RelationLabel>();
  const ids = (kind: RelationKind) => [
    ...new Set(refs.filter((r) => r.kind === kind).map((r) => r.id)),
  ];
  const people = ids("person");
  if (people.length) {
    const rows = await db.crmPerson.findMany({
      where: { organizationId, id: { in: people } },
      select: { id: true, name: true, title: true },
    });
    for (const r of rows) {
      out.set(`person:${r.id}`, {
        kind: "person",
        id: r.id,
        label: r.name || "Unnamed person",
        ...(r.title ? { sub: r.title } : {}),
      });
    }
  }
  const companies = ids("company");
  if (companies.length) {
    const rows = await db.crmCompany.findMany({
      where: { organizationId, id: { in: companies } },
      select: { id: true, name: true, domain: true },
    });
    for (const r of rows) {
      out.set(`company:${r.id}`, {
        kind: "company",
        id: r.id,
        label: r.name || "Unnamed company",
        ...(r.domain ? { sub: r.domain } : {}),
      });
    }
  }
  const deals = ids("deal");
  if (deals.length) {
    const rows = await db.crmDeal.findMany({
      where: { organizationId, id: { in: deals } },
      select: { id: true, title: true, pipeline: { select: { name: true } } },
    });
    for (const r of rows) {
      out.set(`deal:${r.id}`, {
        kind: "deal",
        id: r.id,
        label: r.title || "Untitled",
        sub: r.pipeline.name,
      });
    }
  }
  const records = ids("record");
  if (records.length) {
    const rows = await db.databaseRecord.findMany({
      where: { organizationId, id: { in: records } },
      select: {
        id: true,
        values: true,
        databaseId: true,
        database: { select: { key: true, name: true } },
      },
    });
    const fields = await fieldsOf(db, organizationId, [...new Set(rows.map((r) => r.databaseId))]);
    for (const r of rows) {
      const primary = primaryOf(fields.get(r.databaseId) ?? []);
      const values = (r.values ?? {}) as Record<string, unknown>;
      const text = primary ? displayText(primary, values[primary.id], NO_NAMES) : "";
      out.set(`record:${r.id}`, {
        kind: "record",
        id: r.id,
        label: text || "Untitled row",
        sub: r.database.name,
        dbKey: r.database.key,
      });
    }
  }
  return out;
}

/** The labels of every link in some rows' RELATION cells, keyed `${kind}:${id}`. */
export async function labelsForRows(
  db: TxClient,
  organizationId: string,
  fields: readonly FieldDef[],
  rows: readonly { values: Record<string, unknown> }[],
): Promise<Record<string, RelationLabel>> {
  const relation = fields.filter((f) => f.type === "RELATION");
  if (relation.length === 0) return {};
  const refs = rows.flatMap((r) => relation.flatMap((f) => readRelation(r.values[f.id])));
  if (refs.length === 0) return {};
  return Object.fromEntries(await resolveRelationLabels(db, organizationId, refs));
}

/**
 * Why `refs` can't be stored in `field`, or null when every one is a live
 * record of the organization of the kind the field links to (and, when the
 * field names a database, in that database: a pipeline item of that
 * pipeline, a row of that database). Trashed records can't be linked.
 */
export async function relationProblem(
  db: TxClient,
  organizationId: string,
  field: Pick<FieldDef, "options">,
  refs: readonly RelationRef[],
): Promise<string | null> {
  if (refs.length === 0) return null;
  const target = field.options.target;
  if (!target) return "This field doesn't say what it links to. Edit the field first.";
  if (refs.some((r) => r.kind !== target.kind)) return "Pick from what this field links to.";
  const ids = [...new Set(refs.map((r) => r.id))];
  let found = 0;
  switch (target.kind) {
    case "person":
      found = await db.crmPerson.count({
        where: { organizationId, id: { in: ids }, deletedAt: null },
      });
      break;
    case "company":
      found = await db.crmCompany.count({
        where: { organizationId, id: { in: ids }, deletedAt: null },
      });
      break;
    case "deal":
      found = await db.crmDeal.count({
        where: {
          organizationId,
          id: { in: ids },
          deletedAt: null,
          ...(target.databaseId ? { pipeline: { databaseId: target.databaseId } } : {}),
        },
      });
      break;
    case "record":
      if (!target.databaseId) return "This field doesn't say which database it links to.";
      found = await db.databaseRecord.count({
        where: { organizationId, id: { in: ids }, databaseId: target.databaseId, deletedAt: null },
      });
      break;
  }
  return found === ids.length
    ? null
    : "One of those links is to something that's gone or not here.";
}

export interface RelationSearchInput {
  kind: RelationKind;
  /** Narrows "deal" to one pipeline's database; required for "record". */
  databaseId?: string;
  q?: string;
  take?: number;
}

/** What a RELATION picker offers for `q`: live records of the organization, best matches first. */
export async function searchRelationTargets(
  db: TxClient,
  organizationId: string,
  input: RelationSearchInput,
): Promise<RelationLabel[]> {
  const q = (input.q ?? "").trim().slice(0, 100);
  const take = Math.min(Math.max(input.take ?? 20, 1), 50);
  const contains = { contains: q, mode: "insensitive" as const };
  switch (input.kind) {
    case "person": {
      const rows = await db.crmPerson.findMany({
        where: {
          organizationId,
          deletedAt: null,
          ...(q
            ? { OR: [{ name: contains }, { primaryEmail: { contains: q.toLowerCase() } }] }
            : {}),
        },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take,
        select: { id: true, name: true, title: true },
      });
      return rows.map((r) => ({
        kind: "person",
        id: r.id,
        label: r.name || "Unnamed person",
        ...(r.title ? { sub: r.title } : {}),
      }));
    }
    case "company": {
      const rows = await db.crmCompany.findMany({
        where: {
          organizationId,
          deletedAt: null,
          ...(q ? { OR: [{ name: contains }, { domain: { contains: q.toLowerCase() } }] } : {}),
        },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take,
        select: { id: true, name: true, domain: true },
      });
      return rows.map((r) => ({
        kind: "company",
        id: r.id,
        label: r.name || "Unnamed company",
        ...(r.domain ? { sub: r.domain } : {}),
      }));
    }
    case "deal": {
      const rows = await db.crmDeal.findMany({
        where: {
          organizationId,
          deletedAt: null,
          ...(input.databaseId ? { pipeline: { databaseId: input.databaseId } } : {}),
          ...(q ? { title: contains } : {}),
        },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        take,
        select: { id: true, title: true, pipeline: { select: { name: true } } },
      });
      return rows.map((r) => ({
        kind: "deal",
        id: r.id,
        label: r.title || "Untitled",
        sub: r.pipeline.name,
      }));
    }
    case "record": {
      if (!input.databaseId) return [];
      const def = await db.databaseDefinition.findFirst({
        where: { id: input.databaseId, organizationId, kind: "CUSTOM", archivedAt: null },
        select: { id: true, key: true, name: true },
      });
      if (!def) return [];
      const fields = (await fieldsOf(db, organizationId, [def.id])).get(def.id) ?? [];
      const primary = primaryOf(fields);
      const pattern = `%${q.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;
      const hits = await db.$queryRaw<{ id: string; values: unknown }[]>`
        SELECT r."id", r."values" FROM "DatabaseRecord" r
         WHERE r."organizationId" = ${organizationId} AND r."databaseId" = ${def.id}
           AND r."deletedAt" IS NULL
           ${
             q && primary
               ? Prisma.sql`AND (r."values" ->> (${primary.id}::text)) ILIKE ${pattern}`
               : Prisma.empty
           }
         ORDER BY r."createdAt" DESC, r."id" ASC
         LIMIT ${take}`;
      return hits.map((h) => {
        const values = (h.values ?? {}) as Record<string, unknown>;
        const text = primary ? displayText(primary, values[primary.id], NO_NAMES) : "";
        return {
          kind: "record",
          id: h.id,
          label: text || "Untitled row",
          sub: def.name,
          dbKey: def.key,
        };
      });
    }
  }
}

/** The databases a RELATION field can name: club-made ones and pipelines (for "deal"). */
export interface RelationDatabaseOption {
  id: string;
  name: string;
  /** "record" for a club-made database, "deal" for a pipeline's. */
  kind: "record" | "deal";
}

export async function relationDatabases(
  db: TxClient,
  organizationId: string,
): Promise<RelationDatabaseOption[]> {
  const defs = await db.databaseDefinition.findMany({
    where: { organizationId, archivedAt: null, kind: { in: ["CUSTOM", "CRM_PIPELINE"] } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, kind: true },
  });
  return defs.map((d) => ({
    id: d.id,
    name: d.name,
    kind: d.kind === "CUSTOM" ? "record" : "deal",
  }));
}

// ---- Reverse lookups ---------------------------------------------------------

export interface LinkedRollup {
  fieldName: string;
  kind: "sum" | "latest";
  /** Sums are numbers (money already in dollars), latest a "YYYY-MM-DD" day. */
  value: number | string;
  /** The field is money: show it as $. */
  money?: boolean;
}

export interface LinkedGroup {
  databaseId: string;
  databaseName: string;
  /** The database's URL key (club-made databases), else null. */
  dbKey: string | null;
  fieldId: string;
  fieldName: string;
  rows: { id: string; label: string; href: string | null }[];
  /** Every linking row, shown or not. */
  count: number;
  rollups: LinkedRollup[];
}

/** Rows shown per group; the count covers them all. */
export const LINKED_ROWS_SHOWN = 20;
/** Rows read per group for the rollups. */
const LINKED_ROWS_READ = 1000;

const CRM_TABLE = {
  CRM_PEOPLE: Prisma.sql`"CrmPerson"`,
  CRM_COMPANIES: Prisma.sql`"CrmCompany"`,
  CRM_PIPELINE: Prisma.sql`"CrmDeal"`,
} as const;

function rollupsOf(
  fields: readonly FieldDef[],
  rows: readonly { values: Record<string, unknown> }[],
  extra: LinkedRollup[] = [],
): LinkedRollup[] {
  const out: LinkedRollup[] = [...extra];
  for (const f of fields) {
    if (f.type === "NUMBER" || f.type === "CURRENCY") {
      const nums = rows
        .map((r) => r.values[f.id])
        .filter((v): v is number => typeof v === "number");
      if (nums.length === 0) continue;
      const sum = nums.reduce((a, b) => a + b, 0);
      out.push({
        fieldName: f.name,
        kind: "sum",
        value: Math.round(sum * 10000) / 10000,
        ...(f.type === "CURRENCY" ? { money: true } : {}),
      });
    } else if (f.type === "DATE") {
      const days = rows
        .map((r) => r.values[f.id])
        .filter((v): v is string => typeof v === "string")
        .sort();
      const last = days[days.length - 1];
      if (last) out.push({ fieldName: f.name, kind: "latest", value: last });
    }
  }
  return out;
}

/**
 * Every row (of any database, the CRM's included) whose RELATION cells
 * link to `ref`, grouped by database and field, with the sum of each
 * number and money field and the latest of each date field of those rows.
 * For a person's, company's, pipeline item's or row's page. Containment
 * (`@>`) is served by each table's GIN index.
 */
export async function linkedFrom(
  db: TxClient,
  organizationId: string,
  orgSlug: string,
  ref: RelationRef,
): Promise<LinkedGroup[]> {
  const relationFields = await db.databaseField.findMany({
    where: { organizationId, type: "RELATION" },
    select: {
      id: true,
      name: true,
      options: true,
      databaseId: true,
      database: { select: { id: true, key: true, name: true, kind: true, archivedAt: true } },
    },
    orderBy: [{ createdAt: "asc" }],
  });
  const relevant = relationFields.filter(
    (f) => !f.database.archivedAt && readOptions(f.options).target?.kind === ref.kind,
  );
  if (relevant.length === 0) return [];
  const fieldsByDb = await fieldsOf(db, organizationId, [
    ...new Set(relevant.map((f) => f.databaseId)),
  ]);
  const needle = (fieldId: string) =>
    JSON.stringify({ [fieldId]: [{ kind: ref.kind, id: ref.id }] });
  const groups: LinkedGroup[] = [];

  for (const f of relevant) {
    const def = f.database;
    const fields = fieldsByDb.get(def.id) ?? [];
    let rows: {
      id: string;
      label: string;
      href: string | null;
      values: Record<string, unknown>;
    }[] = [];
    let extra: LinkedRollup[] = [];
    if (def.kind === "CUSTOM") {
      // Skip our own row when it links to itself.
      const hits = await db.$queryRaw<{ id: string; values: unknown }[]>`
        SELECT r."id", r."values" FROM "DatabaseRecord" r
         WHERE r."organizationId" = ${organizationId} AND r."databaseId" = ${def.id}
           AND r."deletedAt" IS NULL AND r."values" @> ${needle(f.id)}::jsonb
         ORDER BY r."createdAt" DESC, r."id" ASC
         LIMIT ${LINKED_ROWS_READ}`;
      const primary = primaryOf(fields);
      rows = hits.map((h) => {
        const values = (h.values ?? {}) as Record<string, unknown>;
        const text = primary ? displayText(primary, values[primary.id], NO_NAMES) : "";
        return {
          id: h.id,
          label: text || "Untitled row",
          href: dbViewHref(orgSlug, def.key, { row: h.id }),
          values,
        };
      });
    } else if ((CRM_DB_KINDS as readonly string[]).includes(def.kind)) {
      const kind = def.kind as (typeof CRM_DB_KINDS)[number];
      const table = CRM_TABLE[kind];
      // A pipeline's database holds only that pipeline's items.
      const pipeline =
        kind === "CRM_PIPELINE"
          ? await db.crmPipeline.findFirst({
              where: { organizationId, databaseId: def.id },
              select: { id: true },
            })
          : null;
      if (kind === "CRM_PIPELINE" && !pipeline) continue;
      const label = kind === "CRM_PIPELINE" ? Prisma.sql`t."title"` : Prisma.sql`t."name"`;
      const hits = await db.$queryRaw<
        { id: string; label: string | null; custom: unknown; amountCents: number | null }[]
      >`
        SELECT t."id", ${label} AS "label", t."custom",
               ${kind === "CRM_PIPELINE" ? Prisma.sql`t."amountCents"` : Prisma.sql`NULL::int`} AS "amountCents"
          FROM ${table} t
         WHERE t."organizationId" = ${organizationId} AND t."deletedAt" IS NULL
           ${pipeline ? Prisma.sql`AND t."pipelineId" = ${pipeline.id}` : Prisma.empty}
           AND t."custom" @> ${needle(f.id)}::jsonb
         ORDER BY t."updatedAt" DESC, t."id" ASC
         LIMIT ${LINKED_ROWS_READ}`;
      const crmKind =
        kind === "CRM_PEOPLE" ? "person" : kind === "CRM_COMPANIES" ? "company" : "deal";
      rows = hits.map((h) => ({
        id: h.id,
        label: h.label || "Untitled",
        href: crmRecordHref(orgSlug, crmKind, h.id),
        values: (h.custom ?? {}) as Record<string, unknown>,
      }));
      if (kind === "CRM_PIPELINE") {
        const amounts = hits.map((h) => h.amountCents).filter((v): v is number => v !== null);
        if (amounts.length > 0) {
          extra = [
            {
              fieldName: "Amount",
              kind: "sum",
              value: amounts.reduce((a, b) => a + b, 0) / 100,
              money: true,
            },
          ];
        }
      }
    } else {
      continue;
    }
    if (ref.kind === "record") rows = rows.filter((r) => r.id !== ref.id);
    if (rows.length === 0) continue;
    let count = rows.length;
    if (rows.length >= LINKED_ROWS_READ) {
      const counted =
        def.kind === "CUSTOM"
          ? await db.$queryRaw<{ n: number }[]>`
              SELECT count(*)::int AS n FROM "DatabaseRecord" r
               WHERE r."organizationId" = ${organizationId} AND r."databaseId" = ${def.id}
                 AND r."deletedAt" IS NULL AND r."values" @> ${needle(f.id)}::jsonb`
          : [{ n: rows.length }];
      count = counted[0]?.n ?? rows.length;
    }
    groups.push({
      databaseId: def.id,
      databaseName: def.name,
      dbKey: def.kind === "CUSTOM" ? def.key : null,
      fieldId: f.id,
      fieldName: f.name,
      rows: rows.slice(0, LINKED_ROWS_SHOWN).map(({ id, label, href }) => ({ id, label, href })),
      count,
      rollups: rollupsOf(fields, rows, extra),
    });
  }
  return groups;
}
