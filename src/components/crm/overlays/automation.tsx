import Link from "next/link";

import { RecipeGrid, ScoringPanel } from "@/components/crm/automations";
import { CrmCard } from "@/components/crm/card/crm-card";
import { CrmSettingsDialog } from "@/components/crm/settings/settings-dialog";
import { RunLog, WorkflowBuilder, type BuilderDraft } from "@/components/crm/workflow-builder";
import { Badge } from "@/components/ui/badge";
import { crmRecordHref } from "@/lib/crm/href";
import { readWorkflow } from "@/lib/crm/workflows";
import { builderContext } from "@/server/crm/builder-context";
import { listScoreRules, modelStatus } from "@/server/crm/scoring";
import { listRecipes, workflowRuns } from "@/server/crm/workflows";
import { withOrgTx } from "@/server/db/context";

import type { OverlayProps } from "./crm-overlays";

const NEW: BuilderDraft = {
  name: "",
  trigger: { type: "record.created", params: { object: "person" } },
  conditions: [],
  actions: [
    {
      type: "task.create",
      params: { title: "Say hello to {{name}}", dueInDays: 2, assignTo: "owner" },
    },
  ],
};

const STATUS_WORD = {
  RUNNING: "Running",
  DONE: "Done",
  FAILED: "Failed",
  SKIPPED: "Skipped",
} as const;
const EVENT_WORD: Record<string, string> = {
  "record.changed": "A change",
  "form.submitted": "A form answer",
  "email.replied": "A reply",
  "meeting.booked": "A booking",
  "date.reached": "The date",
  "no.activity": "A quiet spell",
  "deal.stuck": "Stuck",
  "dry-run": "Tried",
};

/**
 * One automation, open over CRM settings (?open=automation:<id>, or
 * ?open=automation for a new one, starting from ?describe=): the builder,
 * with what it did under it. Whoever runs the CRM only.
 */
export async function AutomationOverlay({
  shell,
  orgSlug,
  open,
  searchParams,
}: OverlayProps<"automation">) {
  if (!shell.access.manager) return null;
  const orgId = shell.org.id;
  const id = open.id;
  const data = await withOrgTx(orgId, async ({ db }) => {
    const ctx = await builderContext(db, orgId);
    if (!id) return { ctx, row: null, runs: [] };
    const row = await db.crmWorkflow.findFirst({ where: { id, organizationId: orgId } });
    if (!row) return null;
    return { ctx, row, runs: await workflowRuns(db, orgId, row.id) };
  });
  if (!data) {
    return (
      <CrmCard title="Not here">
        <p className="text-muted-foreground text-sm">This automation was deleted.</p>
      </CrmCard>
    );
  }
  const parsed = data.row ? readWorkflow(data.row) : null;
  const initial: BuilderDraft =
    data.row && parsed?.trigger
      ? {
          name: data.row.name,
          trigger: parsed.trigger,
          conditions: parsed.conditions,
          actions: parsed.actions,
        }
      : { ...NEW, ...(data.row ? { name: data.row.name } : {}) };
  const sentence = typeof searchParams.describe === "string" ? searchParams.describe : undefined;
  const describe = !id && sentence && sentence !== "1" ? sentence.slice(0, 1000) : undefined;
  return (
    <CrmSettingsDialog
      title={data.row ? data.row.name : "New automation"}
      description={
        data.row?.described
          ? `Described as: "${data.row.described}"`
          : "When this happens, if this holds, then do this."
      }
    >
      <WorkflowBuilder
        orgId={orgId}
        orgSlug={orgSlug}
        workflowId={data.row?.id ?? null}
        initial={initial}
        status={data.row?.status ?? "DRAFT"}
        ctx={data.ctx}
        describeFirst={sentence === "1"}
        describeText={describe}
      />
      {data.row && data.runs.length > 0 && (
        <section className="space-y-3">
          <h2 className="heading text-lg">What it did</h2>
          <ol className="space-y-4">
            {data.runs.map((r) => (
              <li key={r.id} className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge
                    variant={
                      r.status === "FAILED"
                        ? "destructive"
                        : r.dryRun
                          ? "outline"
                          : r.status === "DONE"
                            ? "success"
                            : "secondary"
                    }
                  >
                    {r.dryRun ? "Tried" : STATUS_WORD[r.status]}
                  </Badge>
                  {r.target?.name ? (
                    <Link
                      href={crmRecordHref(
                        orgSlug,
                        r.target.kind as "person" | "company" | "deal",
                        r.target.id,
                      )}
                      className="font-medium hover:underline"
                    >
                      {r.target.name}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">A removed record</span>
                  )}
                  <span className="text-muted-foreground ms-auto text-xs">
                    {r.event ? `${EVENT_WORD[r.event] ?? "An event"}, ` : ""}
                    {r.startedAt.toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone: shell.org.timezone ?? "UTC",
                    })}
                  </span>
                </div>
                <RunLog log={r.log} />
              </li>
            ))}
          </ol>
        </section>
      )}
    </CrmSettingsDialog>
  );
}

/** The ready-made automations, on in one click (?open=recipes). */
export async function RecipesOverlay({ shell, orgSlug }: OverlayProps<"recipes">) {
  if (!shell.access.manager) return null;
  const orgId = shell.org.id;
  const recipes = await withOrgTx(orgId, ({ db }) => listRecipes(db, orgId));
  return (
    <CrmSettingsDialog wide title="Recipes" description="Ready-made, and on in one click.">
      <RecipeGrid orgId={orgId} orgSlug={orgSlug} recipes={recipes} />
    </CrmSettingsDialog>
  );
}

/** The score rules and the learned model (?open=scoring). */
export async function ScoringOverlay({ shell }: OverlayProps<"scoring">) {
  if (!shell.access.manager) return null;
  const orgId = shell.org.id;
  const data = await withOrgTx(orgId, async ({ db }) => ({
    rules: await listScoreRules(db, orgId),
    model: await modelStatus(db, orgId),
  }));
  return (
    <CrmSettingsDialog wide title="Scores" description="What moves someone up the list.">
      <ScoringPanel orgId={orgId} rules={data.rules} model={data.model} />
    </CrmSettingsDialog>
  );
}
