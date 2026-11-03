import { SettingsCard } from "@/app/app/[orgSlug]/settings/settings-card";
import { RecipeGrid, ScoringPanel } from "@/components/crm/automations";
import { BackLink } from "@/components/back-link";
import { readAutonomy } from "@/lib/crm/settings-prefs";
import { listScoreRules, modelStatus } from "@/server/crm/scoring";
import { listRecipes, listWorkflows } from "@/server/crm/workflows";
import { withOrgTx } from "@/server/db/context";

import { RunningCard, TrustCard } from "../automations-settings";
import type { SectionProps } from "./types";

/**
 * Automations: what's running (switches, and a sentence to describe a new
 * one), how much the CRM may do alone; ?view=recipes and ?view=scoring for
 * the ready-made recipes and the score rules. One automation opens at
 * /crm/settings/automations/{id}.
 */
export async function AutomationsSection({ shell, orgSlug, sp }: SectionProps) {
  const orgId = shell.org.id;
  const view = sp.view === "recipes" || sp.view === "scoring" ? sp.view : "running";
  const data = await withOrgTx(orgId, async ({ db }) => {
    const workflows = await listWorkflows(db, orgId);
    const recipes =
      view === "recipes" || workflows.length === 0 ? await listRecipes(db, orgId) : [];
    const rules = view === "scoring" ? await listScoreRules(db, orgId) : [];
    const model = view === "scoring" ? await modelStatus(db, orgId) : null;
    const settings = await db.crmSettings.findUnique({
      where: { organizationId: orgId },
      select: { autonomy: true },
    });
    return { workflows, recipes, rules, model, autonomy: readAutonomy(settings?.autonomy) };
  });
  const base = `/app/${orgSlug}/crm/settings/automations`;
  if (view === "recipes") {
    return (
      <>
        <BackLink href={base} label="Automations" />
        <RecipeGrid orgId={orgId} orgSlug={orgSlug} recipes={data.recipes} />
      </>
    );
  }
  if (view === "scoring" && data.model) {
    return (
      <>
        <BackLink href={base} label="Automations" />
        <ScoringPanel orgId={orgId} rules={data.rules} model={data.model} />
      </>
    );
  }
  const ready = data.recipes.filter((r) => !r.missing).slice(0, 6);
  return (
    <>
      <RunningCard
        orgId={orgId}
        orgSlug={orgSlug}
        rows={data.workflows.map((w) => ({ ...w, lastRun: w.lastRunAt?.toISOString() ?? null }))}
      />
      {data.workflows.length === 0 && ready.length > 0 && (
        <SettingsCard
          title="Start from a recipe"
          description="Ready-made, and on in one click. Change any step later."
        >
          <RecipeGrid orgId={orgId} orgSlug={orgSlug} recipes={ready} />
        </SettingsCard>
      )}
      <TrustCard orgId={orgId} initial={data.autonomy} />
    </>
  );
}
