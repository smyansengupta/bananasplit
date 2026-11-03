import { CrmHeader } from "@/components/crm/chrome/crm-header";
import { DealsList, type DealGroupView } from "@/components/crm/deals/deals-list";
import { DealsToolbar } from "@/components/crm/deals/deals-toolbar";
import { CrmOverlays } from "@/components/crm/overlays/crm-overlays";
import { DealBoard } from "@/components/crm/pipeline-view";
import { EmptyState } from "@/components/empty-state";
import { groupByStage, parseDealsFilters } from "@/lib/crm/deals-tab";
import { formatMoney } from "@/lib/crm/fields";
import type { EditField } from "@/lib/crm/record-form";
import { customFieldsFor } from "@/server/crm/databases";
import { defaultDealPipeline, loadDealsTab } from "@/server/crm/deals-tab";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../shell";

export const metadata = { title: "Deals" };

/**
 * Deals (docs/features/crm.md, "Redesign"): every deal in one list grouped
 * by stage, or one pipeline as a board (?view=board), with Filters
 * (?pipeline=, ?owner=, ?type=, ?show=open|won|lost|all) and search (?q=).
 * A deal opens as a card over the page (?open=deal:<id>).
 */
export default async function CrmDealsPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/crm/deals">) {
  const { orgSlug } = await params;
  const sp = (await searchParams) as Record<string, string | string[] | undefined>;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  const orgId = shell.org.id;
  const base = `/app/${orgSlug}/crm`;
  const filters = parseDealsFilters(sp);
  const pipelines = shell.pipelines;
  // The board is one pipeline: the one picked, else the Deals one.
  const boardPipeline =
    filters.view === "board"
      ? (pipelines.find((p) => p.id === filters.pipeline) ?? defaultDealPipeline(pipelines))
      : null;
  const shown = boardPipeline ? { ...filters, pipeline: boardPipeline.id } : filters;
  const names = new Map(shell.members.map((m) => [m.id, m.name]));

  const data = await withOrgTx(orgId, async ({ db }) => {
    const tab = await loadDealsTab(db, orgId, pipelines, shown, {
      id: shell.user.id,
      roles: shell.roles,
      names,
    });
    const boardFields = boardPipeline ? await customFieldsFor(db, orgId, "deal", boardPipeline.id) : [];
    return { tab, boardFields };
  });
  const { rows, stages, typeLabels } = data.tab;
  const total = rows.reduce((n, r) => n + (r.amountCents ?? 0), 0);
  const single = shown.pipeline ? pipelines.find((p) => p.id === shown.pipeline) : null;
  const heading = single && pipelines.length > 1 ? single.name : "All deals";
  const reportPipeline = single ?? defaultDealPipeline(pipelines);
  const reportHref = `${base}/reports${reportPipeline ? `/deals/${reportPipeline.id}` : ""}`;

  let openIndex = 0;
  const indexOf = new Map<string, number>();
  for (const p of pipelines) {
    openIndex = 0;
    for (const s of p.stages) if (s.kind === "OPEN") indexOf.set(s.id, openIndex++);
  }
  const groups: DealGroupView[] = groupByStage(stages, rows).map((g) => ({
    ...g,
    stage: { ...g.stage, openIndex: indexOf.get(g.stage.id) ?? 0 },
  }));

  const ownerOptions = [
    ...shell.members.map((m) => ({ value: `u:${m.id}`, label: m.name })),
    ...[...shell.roles.values()].map((r) => ({ value: `r:${r.key}`, label: r.title })),
  ];
  const stageFields: EditField[] = [
    { key: "amount", label: "Amount", kind: "CURRENCY", value: null },
    { key: "nextStep", label: "Next step", kind: "TEXT", value: null },
    { key: "nextStepAt", label: "Next step by", kind: "DATE", value: null },
    { key: "expectedOn", label: "Expected", kind: "DATE", value: null },
    { key: "company", label: "Company", kind: "COMPANY", value: null },
    { key: "person", label: "Person", kind: "PERSON", value: null },
    { key: "owner", label: "Owner", kind: "OWNER", value: null, options: ownerOptions },
    { key: "closeReason", label: "Reason", kind: "LONG_TEXT", value: null },
    ...data.boardFields.map((f) => ({
      key: `custom.${f.id}`,
      label: f.name,
      kind: "CUSTOM" as const,
      value: null,
      field: f,
    })),
  ];
  const boardStages = boardPipeline
    ? boardPipeline.stages.filter((s) =>
        shown.show === "all" ? true : shown.show === "open" ? s.kind === "OPEN" : s.kind === shown.show.toUpperCase(),
      )
    : [];

  return (
    <div>
      <CrmHeader
        orgSlug={orgSlug}
        settings={shell.access.manager}
        toolbar={
          <DealsToolbar
            tabs={shell.tabs}
            pipelines={pipelines.map((p) => ({ id: p.id, name: p.name }))}
            members={shell.members}
            types={typeLabels}
            reportHref={reportHref}
          />
        }
      />
      {pipelines.length === 0 ? (
        <EmptyState title="No pipelines yet" description="Add one in CRM settings." />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
            <b className="heading text-[22px] leading-tight">{heading}</b>
            <span className="bg-muted grid h-7 min-w-7 place-items-center rounded-full px-2 text-sm font-semibold tabular-nums">
              {rows.length}
            </span>
            {total > 0 && (
              <span className="text-muted-foreground text-[15px] tabular-nums">
                {formatMoney(total)} in all
              </span>
            )}
          </div>
          {boardPipeline ? (
            <DealBoard
              orgId={orgId}
              pipeline={boardPipeline}
              stages={boardStages.map((s) => ({
                id: s.id,
                name: s.name,
                kind: s.kind,
                requiredFields: s.requiredFields,
              }))}
              cards={rows.map((r) => ({
                id: r.id,
                title: r.title,
                stageId: r.stageId,
                amountCents: r.amountCents,
                currency: r.currency,
                companyName: r.companyName,
                type: r.type,
                stuck: r.stuck,
                days: r.days,
              }))}
              stageFields={stageFields}
            />
          ) : (
            <DealsList orgId={orgId} groups={groups} showPipeline={!shown.pipeline && pipelines.length > 1} />
          )}
        </div>
      )}
      <CrmOverlays shell={shell} orgSlug={orgSlug} searchParams={sp} />
    </div>
  );
}
