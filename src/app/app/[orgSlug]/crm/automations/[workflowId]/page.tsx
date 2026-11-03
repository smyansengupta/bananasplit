import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CrmTabs } from "@/components/crm/crm-tabs";
import { RunLog, WorkflowBuilder, type BuilderDraft } from "@/components/crm/workflow-builder";
import { ArrowLeft } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { crmRecordHref } from "@/lib/crm/href";
import { readWorkflow } from "@/lib/crm/workflows";
import { builderContext } from "@/server/crm/builder-context";
import { workflowRuns } from "@/server/crm/workflows";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../../shell";

export const metadata = { title: "Automation" };

const NEW: BuilderDraft = {
  name: "",
  trigger: { type: "record.created", params: { object: "person" } },
  conditions: [],
  actions: [{ type: "task.create", params: { title: "Say hello to {{name}}", dueInDays: 2, assignTo: "owner" } }],
};

const STATUS_WORD = { RUNNING: "Running", DONE: "Done", FAILED: "Failed", SKIPPED: "Skipped" } as const;
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

/** One automation: the builder, then its run history. */
export default async function CrmWorkflowPage({ params, searchParams }: PageProps<"/app/[orgSlug]/crm/automations/[workflowId]">) {
  const { orgSlug, workflowId } = await params;
  const sp = (await searchParams) as Record<string, string | undefined>;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  if (!shell.access.manager) redirect(`/app/${orgSlug}/crm`);
  const orgId = shell.org.id;
  const isNew = workflowId === "new";
  const data = await withOrgTx(orgId, async ({ db }) => {
    const ctx = await builderContext(db, orgId);
    if (isNew) return { ctx, row: null, runs: [] };
    const row = await db.crmWorkflow.findFirst({ where: { id: workflowId, organizationId: orgId } });
    if (!row) return null;
    return { ctx, row, runs: await workflowRuns(db, orgId, row.id) };
  });
  if (!data) notFound();
  const parsed = data.row ? readWorkflow(data.row) : null;
  const initial: BuilderDraft =
    data.row && parsed?.trigger
      ? { name: data.row.name, trigger: parsed.trigger, conditions: parsed.conditions, actions: parsed.actions }
      : { ...NEW, ...(data.row ? { name: data.row.name } : {}) };
  const base = `/app/${orgSlug}/crm/automations`;
  return (
    <div className="space-y-6">
      <PageHeader
        title={data.row ? data.row.name : "New automation"}
        description={data.row?.described ? `Described as: "${data.row.described}"` : "When this happens, if this holds, then do this."}
        actions={
          <Button variant="outline" asChild>
            <Link href={base}>
              <ArrowLeft className="size-4" /> All automations
            </Link>
          </Button>
        }
        tabs={<CrmTabs tabs={shell.tabs} />}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <WorkflowBuilder
          orgId={orgId}
          orgSlug={orgSlug}
          workflowId={data.row?.id ?? null}
          initial={initial}
          status={data.row?.status ?? "DRAFT"}
          ctx={data.ctx}
          describeFirst={sp.describe === "1"}
        />
        <Card className="h-fit gap-3 p-5">
          <h2 className="heading text-lg">Run history</h2>
          {data.runs.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {data.row ? "It hasn't run yet. Try it to see what it would do." : "Its runs show here once it's saved."}
            </p>
          ) : (
            <ol className="space-y-4">
              {data.runs.map((r) => (
                <li key={r.id} className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant={r.status === "FAILED" ? "destructive" : r.dryRun ? "outline" : r.status === "DONE" ? "success" : "secondary"}>
                      {r.dryRun ? "Tried" : STATUS_WORD[r.status]}
                    </Badge>
                    {r.target?.name ? (
                      <Link href={crmRecordHref(orgSlug, r.target.kind as "person" | "company" | "deal", r.target.id)} className="font-medium hover:underline">
                        {r.target.name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">A removed record</span>
                    )}
                    <span className="text-muted-foreground ms-auto text-xs">
                      {r.event ? `${EVENT_WORD[r.event] ?? "An event"}, ` : ""}
                      {r.startedAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: shell.org.timezone ?? "UTC" })}
                    </span>
                  </div>
                  <RunLog log={r.log} />
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
