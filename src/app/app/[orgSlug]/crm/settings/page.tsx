import { Plus } from "@/components/icons";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AiSettingsSection } from "@/components/crm/ai/ai-settings-section";
import { CrmSettings, type FieldGroup, type PipelineRow } from "@/components/crm/crm-settings";
import { CrmTabs } from "@/components/crm/crm-tabs";
import { CrmSettingsLinks } from "@/components/crm/settings/settings-links";
import { OutreachSettingsSection } from "@/components/crm/outreach/settings-section";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { COMPANY_FIELDS, PERSON_FIELDS } from "@/lib/crm/fields";
import { PIPELINE_TEMPLATES, SETUP_KINDS } from "@/lib/crm/templates";
import { loadFields } from "@/server/databases/custom";
import { crmDatabaseIds, requiredKeys } from "@/server/crm/databases";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../shell";

export const metadata = { title: "CRM settings" };

/** How the CRM is set up: access, managers, relationship types, pipelines and stages, fields. */
export default async function CrmSettingsPage({ params }: PageProps<"/app/[orgSlug]/crm/settings">) {
  const { orgSlug } = await params;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  if (!shell.access.manager) redirect(`/app/${orgSlug}/crm`);
  const orgId = shell.org.id;
  const data = await withOrgTx(orgId, async ({ db }) => {
    const ids = await crmDatabaseIds(db, orgId);
    const defs = await db.databaseDefinition.findMany({
      where: { organizationId: orgId, id: { in: [ids.people, ids.companies].filter((x): x is string => Boolean(x)) } },
      select: { id: true, columns: true },
    });
    const columnsOf = (id: string | null) => defs.find((d) => d.id === id)?.columns;
    const pipelines: PipelineRow[] = [];
    for (const p of shell.pipelines) {
      pipelines.push({
        id: p.id,
        name: p.name,
        itemNoun: p.itemNoun,
        itemNounPlural: p.itemNounPlural,
        hasAmount: p.hasAmount,
        wonLabel: p.wonLabel,
        lostLabel: p.lostLabel,
        template: p.template,
        stages: p.stages.map((s) => ({
          id: s.id,
          name: s.name,
          kind: s.kind,
          probability: s.probability,
          stuckAfterDays: s.stuckAfterDays,
          requiredFields: s.requiredFields,
        })),
        fields: p.databaseId ? await loadFields(db, orgId, p.databaseId) : [],
        items: await db.crmDeal.count({ where: { organizationId: orgId, pipelineId: p.id, deletedAt: null } }),
      });
    }
    const groups: FieldGroup[] = [
      {
        key: "people",
        title: "People",
        object: "person",
        databaseId: ids.people,
        fields: ids.people ? await loadFields(db, orgId, ids.people) : [],
        required: requiredKeys(columnsOf(ids.people)),
        builtins: PERSON_FIELDS.filter((f) => ["primaryEmail", "phone", "title", "company", "relationship", "owner", "location"].includes(f.key)).map((f) => ({ key: f.key, label: f.label })),
      },
      {
        key: "companies",
        title: "Companies",
        object: "company",
        databaseId: ids.companies,
        fields: ids.companies ? await loadFields(db, orgId, ids.companies) : [],
        required: requiredKeys(columnsOf(ids.companies)),
        builtins: COMPANY_FIELDS.filter((f) => ["domain", "website", "industry", "owner"].includes(f.key)).map((f) => ({ key: f.key, label: f.label })),
      },
      ...pipelines.map((p) => ({
        key: p.id,
        title: p.name,
        object: "deal" as const,
        pipelineId: p.id,
        databaseId: shell.pipelines.find((x) => x.id === p.id)?.databaseId ?? null,
        fields: p.fields,
        required: [],
        builtins: [],
      })),
    ];
    return { pipelines, groups };
  });
  const used = new Set(shell.pipelines.map((p) => p.template));
  return (
    <div className="space-y-6">
      <PageHeader
        title="CRM settings"
        actions={
          shell.access.admin ? (
            <Button asChild variant="outline">
              <Link href={`/app/${orgSlug}/crm/setup`}>
                <Plus className="size-4" aria-hidden="true" />
                Bring people in
              </Link>
            </Button>
          ) : undefined
        }
        tabs={<CrmTabs tabs={shell.tabs} />}
      />
      {shell.access.admin && <CrmSettingsLinks orgSlug={orgSlug} />}
      <CrmSettings
        orgId={orgId}
        orgSlug={orgSlug}
        admin={shell.access.admin}
        access={shell.access.settings?.memberAccess ?? "ALL"}
        managerIds={shell.access.settings?.managerIds ?? []}
        members={shell.members}
        relationshipTypes={shell.access.settings?.relationshipTypes ?? []}
        pipelines={data.pipelines}
        groups={data.groups}
        templates={SETUP_KINDS.filter((k) => PIPELINE_TEMPLATES[k] && !used.has(k))}
      />
      <AiSettingsSection orgId={orgId} orgSlug={orgSlug} admin={shell.access.admin} />
      <OutreachSettingsSection orgId={orgId} orgSlug={orgSlug} members={shell.members} />
    </div>
  );
}
