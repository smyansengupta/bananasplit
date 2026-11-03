import type { DatabaseKind } from "@/generated/prisma/client";
import { crmRecordHref } from "@/lib/crm/href";
import type { EditField } from "@/lib/crm/record-form";
import type { OrgContext } from "@/server/db/context";

import { crmDatabaseIds, customFieldsFor } from "./databases";
import { companyForm, dealForm, formContext, personForm, withRelationLabels } from "./forms";
import { rolePositions } from "./owners";

/**
 * A CRM row opened in Databases (?row=): the record's own fields, editable
 * there and saved through the same save as the record page (src/server/
 * crm/forms.ts), so a row edited in Databases and a record edited in the
 * CRM are the same row.
 */

export interface CrmRowPanelData {
  kind: "person" | "company" | "deal";
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
  fields: EditField[];
}

export async function loadCrmRowPanel(
  ctx: OrgContext,
  orgSlug: string,
  dbKind: DatabaseKind,
  id: string,
): Promise<CrmRowPanelData | null> {
  const { db, organizationId } = ctx;
  const roles = await rolePositions(organizationId);
  const fctx = await formContext(db, organizationId, roles);
  if (dbKind === "CRM_PEOPLE") {
    const p = await db.crmPerson.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: { company: { select: { name: true } } },
    });
    if (!p) return null;
    const ids = await crmDatabaseIds(db, organizationId);
    const def = ids.people
      ? await db.databaseDefinition.findFirst({ where: { id: ids.people, organizationId }, select: { columns: true } })
      : null;
    return {
      kind: "person",
      id,
      title: p.name,
      subtitle: [p.title, p.company?.name].filter(Boolean).join(", ") || null,
      href: crmRecordHref(orgSlug, "person", id),
      fields: await withRelationLabels(
        db,
        organizationId,
        personForm(p, await customFieldsFor(db, organizationId, "person"), fctx, def?.columns),
      ),
    };
  }
  if (dbKind === "CRM_COMPANIES") {
    const c = await db.crmCompany.findFirst({ where: { id, organizationId, deletedAt: null } });
    if (!c) return null;
    const ids = await crmDatabaseIds(db, organizationId);
    const def = ids.companies
      ? await db.databaseDefinition.findFirst({ where: { id: ids.companies, organizationId }, select: { columns: true } })
      : null;
    return {
      kind: "company",
      id,
      title: c.name,
      subtitle: c.domain,
      href: crmRecordHref(orgSlug, "company", id),
      fields: await withRelationLabels(
        db,
        organizationId,
        companyForm(c, await customFieldsFor(db, organizationId, "company"), fctx, def?.columns),
      ),
    };
  }
  const d = await db.crmDeal.findFirst({
    where: { id, organizationId, deletedAt: null },
    include: {
      company: { select: { name: true } },
      pipeline: {
        select: {
          id: true,
          name: true,
          hasAmount: true,
          stages: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true, requiredFields: true } },
        },
      },
    },
  });
  if (!d) return null;
  const person = d.primaryPersonId
    ? await db.crmPerson.findFirst({ where: { id: d.primaryPersonId, organizationId }, select: { name: true } })
    : null;
  return {
    kind: "deal",
    id,
    title: d.title,
    subtitle: d.pipeline.name,
    href: crmRecordHref(orgSlug, "deal", id),
    fields: await withRelationLabels(db, organizationId, dealForm(
      { ...d, personName: person?.name ?? null },
      d.pipeline,
      await customFieldsFor(db, organizationId, "deal", d.pipelineId),
      fctx,
    )),
  };
}
