import type { Prisma } from "@/generated/prisma/client";
import { FIELD_TYPES, LIMITS, parseCell, readRelation, type FieldDef, type FieldType } from "@/lib/databases/fields";
import { customKey, type CrmObject } from "@/lib/crm/fields";
import { CRM_DB_KEYS, pipelineDbKey } from "@/lib/crm/templates";
import { checkFieldOptions, DatabaseInputError, loadFields } from "@/server/databases/custom";
import { relationProblem } from "@/server/databases/relations";
import type { TxClient } from "@/server/db/context";

import { CrmError, requireManager, requireCrm, type CrmActor } from "./access";
import { writeHistory } from "./history";

/**
 * The CRM's databases (docs/features/crm.md, "How it fits into Databases"):
 * one DatabaseDefinition of kind CRM_PEOPLE, one CRM_COMPANIES and one
 * CRM_PIPELINE per pipeline (CrmPipeline.databaseId). Their custom fields
 * are DatabaseField rows; values live in each row's `custom` JSON keyed by
 * field id, checked with the same parseCell as every database.
 */

export interface CrmDatabaseIds {
  people: string | null;
  companies: string | null;
}

export async function crmDatabaseIds(db: TxClient, organizationId: string): Promise<CrmDatabaseIds> {
  const defs = await db.databaseDefinition.findMany({
    where: { organizationId, kind: { in: ["CRM_PEOPLE", "CRM_COMPANIES"] }, archivedAt: null },
    select: { id: true, kind: true },
    orderBy: { createdAt: "asc" },
  });
  return {
    people: defs.find((d) => d.kind === "CRM_PEOPLE")?.id ?? null,
    companies: defs.find((d) => d.kind === "CRM_COMPANIES")?.id ?? null,
  };
}

/** Makes People and Companies in Databases if they aren't there (idempotent, by key). */
export async function ensureCrmDatabases(actor: CrmActor): Promise<CrmDatabaseIds> {
  const { db, organizationId, userId } = actor;
  const have = await crmDatabaseIds(db, organizationId);
  const max = await db.databaseDefinition.aggregate({
    where: { organizationId },
    _max: { sortOrder: true },
  });
  let order = (max._max.sortOrder ?? 0) + 1;
  const make = async (kind: "CRM_PEOPLE" | "CRM_COMPANIES", key: string, name: string, icon: string) => {
    const existing = await db.databaseDefinition.findFirst({
      where: { organizationId, key },
      select: { id: true, kind: true, archivedAt: true },
    });
    if (existing && existing.kind === kind) {
      if (existing.archivedAt) {
        await db.databaseDefinition.update({ where: { id: existing.id }, data: { archivedAt: null } });
      }
      return existing.id;
    }
    const created = await db.databaseDefinition.create({
      data: {
        organizationId,
        key: existing ? `${key}-${Date.now().toString(36)}` : key,
        name,
        icon,
        kind,
        tag: "People",
        description: kind === "CRM_PEOPLE" ? "The CRM's people" : "The CRM's companies",
        sortOrder: order++,
        createdById: userId,
      },
      select: { id: true },
    });
    return created.id;
  };
  return {
    people: have.people ?? (await make("CRM_PEOPLE", CRM_DB_KEYS.people, "People (CRM)", "Users")),
    companies:
      have.companies ?? (await make("CRM_COMPANIES", CRM_DB_KEYS.companies, "Companies (CRM)", "Building2")),
  };
}

/** A pipeline's database (made with the pipeline). */
export async function createPipelineDatabase(
  actor: CrmActor,
  pipeline: { id: string; name: string; icon?: string | null },
): Promise<string> {
  const { db, organizationId, userId } = actor;
  const max = await db.databaseDefinition.aggregate({
    where: { organizationId },
    _max: { sortOrder: true },
  });
  const created = await db.databaseDefinition.create({
    data: {
      organizationId,
      key: pipelineDbKey(pipeline.id),
      name: pipeline.name,
      icon: pipeline.icon ?? "Columns3",
      kind: "CRM_PIPELINE",
      tag: "People",
      description: "A CRM pipeline",
      sortOrder: (max._max.sortOrder ?? 0) + 1,
      createdById: userId,
    },
    select: { id: true },
  });
  await db.crmPipeline.update({
    where: { id: pipeline.id },
    data: { databaseId: created.id },
  });
  return created.id;
}

/** The database a record's custom fields live on. */
export async function databaseFor(
  db: TxClient,
  organizationId: string,
  object: CrmObject,
  pipelineId?: string | null,
): Promise<string | null> {
  if (object === "deal") {
    if (!pipelineId) return null;
    const p = await db.crmPipeline.findFirst({
      where: { id: pipelineId, organizationId },
      select: { databaseId: true },
    });
    return p?.databaseId ?? null;
  }
  const ids = await crmDatabaseIds(db, organizationId);
  return object === "person" ? ids.people : ids.companies;
}

/** The custom fields of a CRM object (a pipeline's for items). */
export async function customFieldsFor(
  db: TxClient,
  organizationId: string,
  object: CrmObject,
  pipelineId?: string | null,
): Promise<FieldDef[]> {
  const databaseId = await databaseFor(db, organizationId, object, pipelineId);
  return databaseId ? loadFields(db, organizationId, databaseId) : [];
}

async function memberIds(db: TxClient, organizationId: string): Promise<Set<string>> {
  const rows = await db.membership.findMany({ where: { organizationId }, select: { userId: true } });
  return new Set(rows.map((r) => r.userId));
}

/**
 * Custom values as they will be stored: each checked against its field
 * (unknown ids refused), links checked to exist in the organization. A
 * null clears the value. Returns the merged JSON.
 */
export async function checkCustomValues(
  db: TxClient,
  organizationId: string,
  fields: readonly FieldDef[],
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const next: Record<string, unknown> = { ...current };
  let members: Set<string> | null = null;
  for (const [id, raw] of Object.entries(patch)) {
    const field = byId.get(id);
    if (!field) throw new CrmError("That field isn't here any more. Reload the page.");
    if (field.type === "MEMBER" && !members) members = await memberIds(db, organizationId);
    const parsed = parseCell(field, raw, members ?? undefined);
    if (!parsed.ok) throw new CrmError(`${field.name}: ${parsed.error}`, [id]);
    if (parsed.value === null) {
      delete next[id];
      continue;
    }
    if (field.type === "RELATION") {
      const problem = await relationProblem(db, organizationId, field, readRelation(parsed.value));
      if (problem) throw new CrmError(`${field.name}: ${problem}`, [id]);
    }
    next[id] = parsed.value;
  }
  if (JSON.stringify(next).length > 60_000) throw new CrmError("That's too much to keep on one record.");
  return next;
}

// ---- Custom fields (CRM settings) ------------------------------------------

/** Field types the CRM's databases take (every type, the CRM's own included). */
export const CRM_FIELD_TYPES: readonly FieldType[] = FIELD_TYPES;

function cleanFieldName(name: string): string {
  const s = name.trim().replace(/\s+/g, " ");
  if (!s) throw new CrmError("Give the field a name.");
  if (s.length > 60) throw new CrmError("Keep the field's name under 60 characters.");
  return s;
}

function options(type: FieldType, raw: unknown) {
  try {
    return checkFieldOptions(type, raw);
  } catch (error) {
    if (error instanceof DatabaseInputError) throw new CrmError(error.message);
    throw error;
  }
}

/** Adds a custom field to People, Companies or one pipeline. */
export async function addCrmField(
  actor: CrmActor,
  target: { object: CrmObject; pipelineId?: string | null },
  input: { name: string; type: string; options?: unknown },
): Promise<FieldDef> {
  requireManager(await requireCrm(actor));
  const { db, organizationId } = actor;
  const databaseId = await databaseFor(db, organizationId, target.object, target.pipelineId);
  if (!databaseId) throw new CrmError("Set up the CRM first.");
  const type = FIELD_TYPES.find((t) => t === input.type);
  if (!type) throw new CrmError("Pick a field type.");
  const count = await db.databaseField.count({ where: { organizationId, databaseId } });
  if (count >= LIMITS.fieldsPerDatabase) {
    throw new CrmError(`Up to ${LIMITS.fieldsPerDatabase} fields each.`);
  }
  const opts = options(type, input.options);
  const created = await db.databaseField.create({
    data: {
      organizationId,
      databaseId,
      name: cleanFieldName(input.name),
      type,
      options: opts as Prisma.InputJsonObject,
      sortOrder: count + 1,
      // The CRM's rows are named by their built-in name, never a custom field.
      isPrimary: false,
    },
    select: { id: true, name: true, type: true, options: true, isPrimary: true },
  });
  return { ...created, type: created.type as FieldType, options: opts };
}

/** Renames a custom field or changes its options (its type stays; delete and add to change it). */
export async function updateCrmField(
  actor: CrmActor,
  fieldId: string,
  input: { name?: string; options?: unknown },
): Promise<void> {
  requireManager(await requireCrm(actor));
  const { db, organizationId } = actor;
  const field = await crmField(db, organizationId, fieldId);
  await db.databaseField.update({
    where: { id: field.id },
    data: {
      ...(input.name !== undefined ? { name: cleanFieldName(input.name) } : {}),
      ...(input.options !== undefined
        ? { options: options(field.type as FieldType, input.options) as Prisma.InputJsonObject }
        : {}),
    },
  });
}

/**
 * Deletes a custom field and its values from every row; field history keeps
 * what the values were, so a restore to an earlier point still knows.
 */
export async function deleteCrmField(actor: CrmActor, fieldId: string): Promise<void> {
  requireManager(await requireCrm(actor));
  const { db, organizationId } = actor;
  const field = await crmField(db, organizationId, fieldId);
  const table = field.database.kind === "CRM_PEOPLE" ? "person" : field.database.kind === "CRM_COMPANIES" ? "company" : "deal";
  const rows =
    table === "person"
      ? await db.$queryRaw<{ id: string; v: unknown }[]>`
          SELECT "id", "custom" -> ${fieldId}::text AS v FROM "CrmPerson"
           WHERE "organizationId" = ${organizationId} AND "custom" ? ${fieldId}::text`
      : table === "company"
        ? await db.$queryRaw<{ id: string; v: unknown }[]>`
            SELECT "id", "custom" -> ${fieldId}::text AS v FROM "CrmCompany"
             WHERE "organizationId" = ${organizationId} AND "custom" ? ${fieldId}::text`
        : await db.$queryRaw<{ id: string; v: unknown }[]>`
            SELECT "id", "custom" -> ${fieldId}::text AS v FROM "CrmDeal"
             WHERE "organizationId" = ${organizationId} AND "custom" ? ${fieldId}::text`;
  const batchId = `fd_${fieldId}`;
  for (const r of rows) {
    await writeHistory(db, {
      organizationId,
      targetKind: table,
      targetId: r.id,
      changes: [{ field: customKey(fieldId), oldValue: r.v, newValue: null }],
      userId: actor.userId,
      source: "user",
      batchId,
    });
  }
  if (table === "person") {
    await db.$executeRaw`UPDATE "CrmPerson" SET "custom" = "custom" - ${fieldId}::text
      WHERE "organizationId" = ${organizationId} AND "custom" ? ${fieldId}::text`;
  } else if (table === "company") {
    await db.$executeRaw`UPDATE "CrmCompany" SET "custom" = "custom" - ${fieldId}::text
      WHERE "organizationId" = ${organizationId} AND "custom" ? ${fieldId}::text`;
  } else {
    await db.$executeRaw`UPDATE "CrmDeal" SET "custom" = "custom" - ${fieldId}::text
      WHERE "organizationId" = ${organizationId} AND "custom" ? ${fieldId}::text`;
  }
  await db.databaseField.delete({ where: { id: field.id } });
}

async function crmField(db: TxClient, organizationId: string, fieldId: string) {
  const field = await db.databaseField.findFirst({
    where: {
      id: fieldId,
      organizationId,
      database: { kind: { in: ["CRM_PEOPLE", "CRM_COMPANIES", "CRM_PIPELINE"] } },
    },
    select: { id: true, type: true, database: { select: { kind: true } } },
  });
  if (!field) throw new CrmError("That field isn't here any more.");
  return field;
}

/** The required-everywhere fields of a CRM database (DatabaseDefinition.columns entries with required). */
export function requiredKeys(columns: unknown): string[] {
  if (!Array.isArray(columns)) return [];
  return columns
    .filter((c): c is { key: string; required: true } =>
      Boolean(c) && typeof c === "object" && typeof (c as { key?: unknown }).key === "string" && (c as { required?: unknown }).required === true,
    )
    .map((c) => c.key);
}
