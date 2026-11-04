"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { moveDealAction } from "@/app/app/[orgSlug]/crm/actions";
import { pushDealStepAction, setDealStepAtAction } from "@/app/app/[orgSlug]/crm/deal-actions";
import { AmbientButton, AmbientWhy, MAX_AMBIENT, type AmbientAction } from "@/components/ambient/ambient-button";
import { useCrmOpen } from "@/components/crm/card/use-crm-open";
import { TypeTag } from "@/components/crm/pipeline-view";
import { EmptyState } from "@/components/empty-state";
import { toast } from "@/components/ui/toaster";
import { nextStepLine, stageTone, type DealAmbientKind, type StageGroup } from "@/lib/crm/deals-tab";
import { formatMoney } from "@/lib/crm/fields";
import { runAction } from "@/lib/run-action";
import type { DealRow } from "@/server/crm/deals-tab";

/**
 * The Deals list (docs/features/crm.md, "Redesign"): grouped by stage, each
 * group with its dot, count and amount; each row is the deal's name and
 * type, its next step (or, when it needs you, why) under it, the amount, at
 * most two ambient buttons, and the owner. A row opens the deal's card over
 * the list.
 */

export interface DealGroupView extends Omit<StageGroup<DealRow>, "stage"> {
  stage: StageGroup<DealRow>["stage"] & { openIndex: number };
}

export function DealsList({
  orgId,
  groups,
  showPipeline,
}: {
  orgId: string;
  groups: DealGroupView[];
  /** More than one pipeline is shown: name it beside each stage. */
  showPipeline: boolean;
}) {
  const router = useRouter();
  const { hrefFor } = useCrmOpen();

  const toAction = (row: DealRow, kind: DealAmbientKind, label: string, tone: "solid" | "outline"): AmbientAction => {
    const why = row.ambient?.why ?? "";
    const open = hrefFor({ kind: "deal", id: row.id });
    switch (kind) {
      case "add-step":
      case "follow-up":
        return { key: kind, label, tone, reason: why, href: open };
      case "push":
        return {
          key: kind,
          label,
          tone,
          reason: "Moves the next step a day",
          run: async () => {
            const r = await pushDealStepAction(orgId, row.id, 1);
            if (r.ok) {
              toast({
                title: `Pushed ${row.title} a day.`,
                action: {
                  label: "Undo",
                  run: async () => {
                    await runAction(() => setDealStepAtAction(orgId, row.id, r.before));
                    router.refresh();
                  },
                },
              });
            }
            return r;
          },
        };
      case "next-stage":
        return {
          key: kind,
          label,
          tone,
          reason: why,
          run: async () => {
            if (!row.nextStageId) return {};
            const from = row.stageId;
            const r = await moveDealAction(orgId, row.id, { stageId: row.nextStageId });
            if (r.ok && r.needs) {
              // The stage asks for something first: the card has the fields.
              router.push(open, { scroll: false });
              return { error: `It needs ${r.needs.labels.join(", ")} first.` };
            }
            if (r.ok) {
              toast({
                title: `${row.title} moved on.`,
                action: {
                  label: "Undo",
                  run: async () => {
                    await runAction(() => moveDealAction(orgId, row.id, { stageId: from }));
                    router.refresh();
                  },
                },
              });
            }
            return r;
          },
        };
    }
  };

  if (groups.length === 0) {
    return (
      <EmptyState
        title="No deals here"
        description="Change the filters, or make one with New deal."
      />
    );
  }

  return (
    <div className="flex flex-col gap-7">
      {groups.map((g) => (
        <section key={g.stage.id} aria-label={g.stage.name} className="flex flex-col gap-1">
          <h2 className="flex items-center gap-2.5 px-1 pb-2">
            <span
              aria-hidden="true"
              className="size-3 shrink-0 rounded-full"
              style={{ background: stageTone(g.stage.kind, g.stage.openIndex) }}
            />
            <span className="heading text-base">{g.stage.name}</span>
            {showPipeline && (
              <span className="text-muted-foreground text-sm">{g.stage.pipelineName}</span>
            )}
            <span className="bg-muted grid h-7 min-w-7 place-items-center rounded-full px-2 text-sm font-semibold tabular-nums">
              {g.count}
            </span>
            <span aria-hidden="true" className="bg-border/70 h-px min-w-4 flex-1" />
            {g.sumCents > 0 && (
              <span className="text-muted-foreground text-sm font-semibold tabular-nums">
                {formatMoney(g.sumCents)}
              </span>
            )}
          </h2>
          <ul className="bg-card ring-foreground/6 divide-border/60 divide-y overflow-hidden rounded-[22px] ring-1">
            {g.rows.map((row) => {
              const actions = (row.ambient?.actions ?? [])
                .slice(0, MAX_AMBIENT)
                .map((a) => toAction(row, a.kind, a.label, a.tone));
              const at = row.nextStepAt ? new Date(row.nextStepAt) : null;
              return (
                <li
                  key={row.id}
                  className="hover:bg-muted/40 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-5 py-3.5 sm:grid-cols-[minmax(0,1fr)_7rem_auto_8rem]"
                >
                  <Link
                    href={hrefFor({ kind: "deal", id: row.id })}
                    scroll={false}
                    className="group flex min-w-0 flex-col gap-1"
                  >
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <b className="truncate text-[15px] group-hover:underline">{row.title}</b>
                      {row.type && <TypeTag label={row.type.label} color={row.type.color} />}
                    </span>
                    {row.ambient ? (
                      <AmbientWhy className="text-[13px]">{row.ambient.why}</AmbientWhy>
                    ) : (
                      <span className="text-muted-foreground truncate text-[13px]">
                        {row.stageKind === "LOST" && row.closeReason
                          ? row.closeReason
                          : row.stageKind === "OPEN"
                            ? nextStepLine(row.nextStep, at)
                            : (row.companyName ?? "")}
                      </span>
                    )}
                  </Link>
                  <span className="text-right text-[15px] font-semibold tabular-nums">
                    {row.amountCents !== null ? formatMoney(row.amountCents, row.currency) : ""}
                  </span>
                  <span className="col-span-2 flex flex-nowrap items-center gap-1.5 sm:col-span-1 sm:justify-end">
                    {actions.map((a) => (
                      <AmbientButton key={a.key} action={a} />
                    ))}
                  </span>
                  <span className="text-muted-foreground hidden truncate text-right text-[13px] sm:block">
                    {row.owner ?? "Nobody"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
