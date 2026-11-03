import { can } from "@/lib/auth/permissions";
import { displayText, readRelation, type FieldDef } from "@/lib/databases/fields";
import type { CrmObject } from "@/lib/crm/fields";
import { mapRow, suggestMapping, type Mapping } from "@/lib/crm/mapping";
import { addField, loadFields } from "@/server/databases/custom";
import type { TxClient } from "@/server/db/context";

import { CrmError, requireCrm, type CrmActor } from "./access";
import { customFieldsFor } from "./databases";
import { importRow } from "./import";

/**
 * Turn a database into CRM records (docs/features/crm.md, "How it fits into
 * Databases"): pick one of the organization's own databases (an old
 * sponsor spreadsheet, form responses, an alumni list), match its fields to
 * the CRM's (suggested from their names), and each row becomes a person or
 * a company, deduped on email and domain the way imports are. The database
 * stays, with a Relation column pointing at the record each row made, so
 * nothing is lost and running it again only does the rows still unlinked.
 * Owners and admins (it adds a column to the database).
 */

/** Rows one press converts; the rest wait for the next. */
export const CONVERT_TURN = 150;

export interface ConvertPreview {
  databaseId: string;
  name: string;
  fields: { id: string; name: string; type: string }[];
  /** Field name -> CRM target. */
  mapping: Mapping;
  rows: number;
  linked: number;
}

function linkFieldName(object: CrmObject): string {
  return object === "company" ? "CRM company" : "CRM person";
}

async function sourceDatabase(db: TxClient, organizationId: string, databaseId: string) {
  const def = await db.databaseDefinition.findFirst({
    where: { id: databaseId, organizationId, kind: "CUSTOM", archivedAt: null },
    select: { id: true, name: true },
  });
  if (!def) throw new CrmError("That database isn't here any more.");
  return def;
}

function linkField(fields: readonly FieldDef[], object: CrmObject): FieldDef | undefined {
  return fields.find(
    (f) => f.type === "RELATION" && f.options.target?.kind === (object === "company" ? "company" : "person"),
  );
}

export async function previewConvert(actor: CrmActor, databaseId: string, object: CrmObject): Promise<ConvertPreview> {
  await requireCrm(actor);
  const { db, organizationId } = actor;
  const def = await sourceDatabase(db, organizationId, databaseId);
  const fields = (await loadFields(db, organizationId, def.id)).filter((f) => f.type !== "RELATION");
  const custom = await customFieldsFor(db, organizationId, object);
  const mapping = suggestMapping(object, fields.map((f) => f.name), custom);
  const rows = await db.databaseRecord.count({ where: { organizationId, databaseId: def.id, deletedAt: null } });
  const link = linkField(await loadFields(db, organizationId, def.id), object);
  const linked = link
    ? (
        await db.databaseRecord.findMany({
          where: { organizationId, databaseId: def.id, deletedAt: null },
          select: { values: true },
          take: 10_000,
        })
      ).filter((r) => readRelation((r.values as Record<string, unknown>)[link.id]).length > 0).length
    : 0;
  return {
    databaseId: def.id,
    name: def.name,
    fields: fields.map((f) => ({ id: f.id, name: f.name, type: f.type })),
    mapping,
    rows,
    linked,
  };
}

export interface ConvertResult {
  created: number;
  updated: number;
  skipped: number;
  left: number;
  fieldId: string;
}

export async function convertDatabase(
  actor: CrmActor,
  databaseId: string,
  input: { object: CrmObject; mapping: Mapping },
): Promise<ConvertResult> {
  await requireCrm(actor);
  if (!can(actor, "databases.write")) throw new CrmError("Owners and admins turn a database into CRM records.");
  if (input.object === "deal") throw new CrmError("Turn it into people or companies.");
  const { db, organizationId, userId } = actor;
  const def = await sourceDatabase(db, organizationId, databaseId);
  const all = await loadFields(db, organizationId, def.id);
  let link = linkField(all, input.object);
  if (!link) {
    link = await addField(
      { db, organizationId, userId, role: actor.role },
      def.id,
      {
        name: linkFieldName(input.object),
        type: "RELATION",
        options: { target: { kind: input.object === "company" ? "company" : "person" }, single: true },
      },
    );
  }
  const fields = all.filter((f) => f.type !== "RELATION");
  const names = new Map(
    (
      await db.membership.findMany({ where: { organizationId }, select: { userId: true, user: { select: { name: true } } } })
    ).map((m) => [m.userId, m.user.name ?? "Member"]),
  );
  const records = await db.databaseRecord.findMany({
    where: { organizationId, databaseId: def.id, deletedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, values: true },
    take: 10_000,
  });
  const todo = records.filter((r) => readRelation((r.values as Record<string, unknown>)[link!.id]).length === 0);
  const ctx = {
    actor,
    importId: `db_${def.id}`,
    fields: await customFieldsFor(db, organizationId, input.object),
    members: (
      await db.membership.findMany({ where: { organizationId }, select: { user: { select: { id: true, name: true, email: true } } } })
    ).map((m) => m.user),
    relationships: [],
    stages: [],
    pipelineId: null,
  };
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const [i, r] of todo.slice(0, CONVERT_TURN).entries()) {
    const values = (r.values ?? {}) as Record<string, unknown>;
    const row: Record<string, string> = {};
    for (const f of fields) row[f.name] = displayText(f, values[f.id], names);
    const mapped = mapRow(row, input.mapping);
    await db.$executeRaw`SAVEPOINT crm_convert_row`;
    try {
      const outcome = await importRow(ctx, input.object, mapped, i);
      await db.$executeRaw`RELEASE SAVEPOINT crm_convert_row`;
      if (outcome.kind === "skipped") {
        skipped++;
        continue;
      }
      if (outcome.kind === "created") created++;
      else updated++;
      const ref = [{ kind: input.object === "company" ? "company" : "person", id: outcome.id }];
      await db.$executeRaw`
        UPDATE "DatabaseRecord"
           SET "values" = "values" || jsonb_build_object(${link.id}::text, ${JSON.stringify(ref)}::jsonb),
               "updatedById" = ${userId}, "updatedAt" = now()
         WHERE "id" = ${r.id} AND "organizationId" = ${organizationId}`;
    } catch {
      await db.$executeRaw`ROLLBACK TO SAVEPOINT crm_convert_row`;
      skipped++;
    }
  }
  return { created, updated, skipped, left: Math.max(0, todo.length - CONVERT_TURN), fieldId: link.id };
}
