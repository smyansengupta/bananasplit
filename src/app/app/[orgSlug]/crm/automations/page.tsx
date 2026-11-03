import Link from "next/link";
import { redirect } from "next/navigation";

import { RecipeGrid, ScoringPanel, WorkflowList } from "@/components/crm/automations";
import { CrmTabs } from "@/components/crm/crm-tabs";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { listScoreRules, modelStatus } from "@/server/crm/scoring";
import { listRecipes, listWorkflows } from "@/server/crm/workflows";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../shell";

export const metadata = { title: "Automations" };

const VIEWS = ["automations", "recipes", "scoring"] as const;
type View = (typeof VIEWS)[number];

/**
 * The CRM's Automations tab (docs/features/crm.md, modules 6 and 9):
 * workflows switched on and off on the row, ready-made recipes in one
 * click, and the score rules with the learned model. Owners, admins and
 * CRM managers only.
 */
export default async function CrmAutomationsPage({ params, searchParams }: PageProps<"/app/[orgSlug]/crm/automations">) {
  const { orgSlug } = await params;
  const sp = (await searchParams) as Record<string, string | undefined>;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  if (!shell.access.manager) redirect(`/app/${orgSlug}/crm`);
  const view: View = (VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as View) : "automations";
  const orgId = shell.org.id;
  const data = await withOrgTx(orgId, async ({ db }) => {
    const workflows = await listWorkflows(db, orgId);
    const recipes = view === "recipes" || workflows.length === 0 ? await listRecipes(db, orgId) : [];
    const rules = view === "scoring" ? await listScoreRules(db, orgId) : [];
    const model = view === "scoring" ? await modelStatus(db, orgId) : null;
    return { workflows, recipes, rules, model };
  });
  const base = `/app/${orgSlug}/crm/automations`;
  const on = data.workflows.filter((w) => w.status === "ON").length;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Automations"
        description={
          data.workflows.length
            ? `${on} of ${data.workflows.length} switched on.`
            : "When something happens in the CRM, do the next thing for you."
        }
        actions={
          <Button variant="create" asChild>
            <Link href={`${base}/new`}>New automation</Link>
          </Button>
        }
        tabs={<CrmTabs tabs={shell.tabs} />}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Show"
          value={view}
          options={[
            { value: "automations", label: "Automations", href: base, count: data.workflows.length },
            { value: "recipes", label: "Recipes", href: `${base}?view=recipes` },
            { value: "scoring", label: "Scoring", href: `${base}?view=scoring` },
          ]}
        />
        {view === "automations" && (
          <Button variant="outline" asChild>
            <Link href={`${base}/new?describe=1`}>Describe one in words</Link>
          </Button>
        )}
      </div>
      {view === "automations" && (
        <>
          <WorkflowList
            orgId={orgId}
            orgSlug={orgSlug}
            rows={data.workflows.map((w) => ({ ...w, lastRun: w.lastRunAt?.toISOString() ?? null }))}
          />
          {data.workflows.length === 0 && data.recipes.some((r) => !r.missing) && (
            <section className="space-y-3">
              <h2 className="heading text-lg">Start from a recipe</h2>
              <RecipeGrid orgId={orgId} orgSlug={orgSlug} recipes={data.recipes.filter((r) => !r.missing).slice(0, 6)} />
            </section>
          )}
        </>
      )}
      {view === "recipes" && <RecipeGrid orgId={orgId} orgSlug={orgSlug} recipes={data.recipes} />}
      {view === "scoring" && data.model && (
        <ScoringPanel orgId={orgId} rules={data.rules} model={{ ...data.model, trainedAt: data.model.trainedAt }} />
      )}
    </div>
  );
}
