import { Segmented } from "@/components/ui/segmented";
import { COMPANY_FIELDS, PERSON_FIELDS } from "@/lib/crm/fields";
import { crmDatabaseIds, requiredKeys } from "@/server/crm/databases";
import { loadFields } from "@/server/databases/custom";
import { withOrgTx } from "@/server/db/context";

import { CustomFieldsCard, RelationshipTypesCard, type FieldGroup } from "../fields-settings";
import type { SectionProps } from "./types";

const PERSON_BUILTINS = [
  "primaryEmail",
  "phone",
  "title",
  "company",
  "relationship",
  "owner",
  "location",
];
const COMPANY_BUILTINS = ["domain", "website", "industry", "owner"];

/**
 * Fields: People, Companies or one pipeline's deals (?for=people,
 * companies or a pipeline id), and on People the relationship types.
 */
export async function FieldsSection({ shell, orgSlug, sp }: SectionProps) {
  const orgId = shell.org.id;
  const pipeline = shell.pipelines.find((p) => p.id === sp.for) ?? null;
  const target = pipeline ? "deal" : sp.for === "companies" ? "companies" : "people";
  const group = await withOrgTx(orgId, async ({ db }): Promise<FieldGroup> => {
    if (pipeline) {
      return {
        key: pipeline.id,
        title: pipeline.name,
        object: "deal",
        pipelineId: pipeline.id,
        databaseId: pipeline.databaseId,
        fields: pipeline.databaseId ? await loadFields(db, orgId, pipeline.databaseId) : [],
        required: [],
        builtins: [],
      };
    }
    const ids = await crmDatabaseIds(db, orgId);
    const databaseId = target === "companies" ? ids.companies : ids.people;
    const def = databaseId
      ? await db.databaseDefinition.findFirst({
          where: { organizationId: orgId, id: databaseId },
          select: { columns: true },
        })
      : null;
    const builtins =
      target === "companies"
        ? COMPANY_FIELDS.filter((f) => COMPANY_BUILTINS.includes(f.key))
        : PERSON_FIELDS.filter((f) => PERSON_BUILTINS.includes(f.key));
    return {
      key: target,
      title: target === "companies" ? "Companies" : "People",
      object: target === "companies" ? "company" : "person",
      databaseId,
      fields: databaseId ? await loadFields(db, orgId, databaseId) : [],
      required: requiredKeys(def?.columns),
      builtins: builtins.map((f) => ({ key: f.key, label: f.label })),
    };
  });
  const base = `/app/${orgSlug}/crm/settings/fields`;
  return (
    <>
      <Segmented
        label="Fields on"
        value={pipeline ? pipeline.id : target}
        options={[
          { value: "people", label: "People", href: base },
          { value: "companies", label: "Companies", href: `${base}?for=companies` },
          ...shell.pipelines.map((p) => ({
            value: p.id,
            label: p.name,
            href: `${base}?for=${p.id}`,
          })),
        ]}
      />
      <CustomFieldsCard key={group.key} orgId={orgId} orgSlug={orgSlug} group={group} />
      {target === "people" && (
        <RelationshipTypesCard
          orgId={orgId}
          initial={shell.access.settings?.relationshipTypes ?? []}
        />
      )}
    </>
  );
}
