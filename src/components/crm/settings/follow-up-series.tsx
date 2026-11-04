"use client";

import Link from "next/link";
import { useState } from "react";

import { createPlanAction, startPlanAction } from "@/app/app/[orgSlug]/crm/outreach/actions";
import { AmbientButton, AmbientWhy, type AmbientAction } from "@/components/ambient/ambient-button";
import { useCrmOpen } from "@/components/crm/card/use-crm-open";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { PLAN_STATUS_LABEL, type PlanStatus } from "@/lib/crm/outreach/plans";
import { runAction } from "@/lib/run-action";

/**
 * Follow-up series in CRM settings > Automations (docs/features/crm.md,
 * "One list"): each series (and each split list or group email) as one
 * row with its status, who it's for and where it stands, and at most one
 * ambient button with the reason beside it. A row opens the plan's card
 * over the page (?open=plan:...).
 */

export interface SeriesRow {
  type: "sequence" | "campaign";
  id: string;
  name: string;
  status: PlanStatus;
  who: string;
  note: string;
  ambient: { key: "start" | "replies" | "share"; label: string; reason: string } | null;
}

const STATUS_TONE: Record<PlanStatus, string> = {
  running: "var(--tag-forest)",
  draft: "var(--muted-foreground)",
  done: "var(--tag-navy)",
  paused: "var(--tag-ochre)",
};

function StatusPill({ status }: { status: PlanStatus }) {
  return (
    <span
      className="text-foreground inline-flex h-[26px] shrink-0 items-center rounded-full px-2.5 text-xs font-semibold"
      style={{ background: `color-mix(in oklab, ${STATUS_TONE[status]} 18%, var(--card))` }}
    >
      {PLAN_STATUS_LABEL[status]}
    </span>
  );
}

export function SeriesList({
  orgId,
  rows,
  empty,
}: {
  orgId: string;
  rows: readonly SeriesRow[];
  empty: string;
}) {
  const { hrefFor } = useCrmOpen();
  if (rows.length === 0) return <p className="text-muted-foreground text-sm">{empty}</p>;
  return (
    <ul className="divide-border/60 -my-2 divide-y">
      {rows.map((r) => {
        const href = hrefFor({ kind: "plan", type: r.type, id: r.id });
        const action: AmbientAction | null = r.ambient
          ? r.ambient.key === "start"
            ? {
                key: "start",
                label: r.ambient.label,
                tone: "solid",
                reason: r.ambient.reason,
                run: () => startPlanAction(orgId, r.id),
                done: "Started",
              }
            : {
                key: r.ambient.key,
                label: r.ambient.label,
                tone: r.ambient.key === "share" ? "solid" : "spark",
                reason: r.ambient.reason,
                href,
              }
          : null;
        return (
          <li key={`${r.type}:${r.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3">
            <Link href={href} scroll={false} className="group min-w-0 flex-1 basis-64">
              <span className="flex min-w-0 items-center gap-2">
                <b className="min-w-0 truncate text-[15px] group-hover:underline">{r.name}</b>
                <StatusPill status={r.status} />
              </span>
              <span className="text-muted-foreground block truncate text-sm">
                {r.who}. {r.note}
              </span>
            </Link>
            {action && (
              <span className="flex min-w-0 flex-nowrap items-center gap-2">
                <AmbientButton action={action} className="shrink-0" />
                <AmbientWhy className="min-w-0 truncate">{action.reason}</AmbientWhy>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** New follow-up series: a draft with an email and a follow-up, opened as its card. */
export function NewSeriesButton({ orgId }: { orgId: string }) {
  const { setOpen } = useCrmOpen();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        const r = await runAction(() => createPlanAction(orgId, "New follow-up series"));
        setPending(false);
        if (!r) return;
        if (!r.ok) return toast({ title: r.error, tone: "error" });
        setOpen({ kind: "plan", type: "sequence", id: r.id });
      }}
    >
      New series
    </Button>
  );
}

/** Split a list among members: the new split-list card. */
export function SplitListButton() {
  const { setOpen } = useCrmOpen();
  return (
    <Button variant="outline" size="sm" onClick={() => setOpen({ kind: "plan", type: "split", id: null })}>
      Split a list
    </Button>
  );
}
