import { SettingsCard } from "@/app/app/[orgSlug]/settings/settings-card";
import { RecipeGrid, ScoringPanel } from "@/components/crm/automations";
import { BackLink } from "@/components/back-link";
import { readAutonomy } from "@/lib/crm/settings-prefs";
import { listPlans } from "@/server/crm/outreach/plans";
import { listScoreRules, modelStatus } from "@/server/crm/scoring";
import { listRecipes, listWorkflows } from "@/server/crm/workflows";
import { withOrgTx } from "@/server/db/context";

import { RunningCard, TrustCard } from "../automations-settings";
import { NewSeriesButton, SeriesList, SplitListButton, type SeriesRow } from "../follow-up-series";
import type { SectionProps } from "./types";

/**
 * Automations: what's running (switches, and a sentence to describe a new
 * one), the follow-up series (each opens its card over the page,
 * ?open=plan:sequence:<id>), split lists and group emails, and how much
 * the CRM may do alone; ?view=recipes and ?view=scoring for the
 * ready-made recipes and the score rules. One automation opens at
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
    const plans =
      view === "running"
        ? await listPlans(db, orgId, shell.user.id, {
            relationships: new Map(
              (shell.access.settings?.relationshipTypes ?? []).map((t) => [t.id, t.label]),
            ),
            members: new Map(shell.members.map((m) => [m.id, m.name])),
          })
        : [];
    return { workflows, recipes, rules, model, plans, autonomy: readAutonomy(settings?.autonomy) };
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
  const row = (p: (typeof data.plans)[number]): SeriesRow => ({
    type: p.type,
    id: p.id,
    name: p.name,
    status: p.status,
    who: p.who,
    note: p.note,
    ambient: p.ambient,
  });
  const series = data.plans.filter((p) => p.shape === "steps").map(row);
  const lists = data.plans.filter((p) => p.shape !== "steps").map(row);
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
      <SettingsCard
        title="Follow-up series"
        description="Emails, texts and tasks over days that stop when someone replies. Add people from People or from their card. After the first email, each one waits for your OK."
        action={<NewSeriesButton orgId={orgId} />}
      >
        <SeriesList orgId={orgId} rows={series} empty="None yet. A series is who it's for, the steps and who sends." />
      </SettingsCard>
      <SettingsCard
        title="Split lists and group emails"
        description="A list split among members to reach from their own mailbox, and the emails sent to many people from People."
        action={<SplitListButton />}
      >
        <SeriesList orgId={orgId} rows={lists} empty="None yet. To email a few people at once, pick them on People and press Email them." />
      </SettingsCard>
      <TrustCard orgId={orgId} initial={data.autonomy} />
    </>
  );
}
