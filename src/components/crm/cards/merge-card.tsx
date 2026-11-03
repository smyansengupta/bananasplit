"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { keepBothAction, mergeRecordsAction } from "@/app/app/[orgSlug]/crm/people-actions";
import { CrmCard } from "@/components/crm/card/crm-card";
import { useCrmOpen } from "@/components/crm/card/use-crm-open";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import {
  defaultPicks,
  MERGE_FIELDS,
  mergeWith,
  type MergeField,
  type MergePicks,
  type MergeSide,
} from "@/lib/crm/people-view";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

/**
 * Merging two people or two companies as a card (Merge.dc.html): the two
 * side by side, one pick per field (the record whose name you keep is the
 * one kept), what both share, and what moves. Merge, or Keep both so the
 * pair is never suggested again.
 */

type Values = Record<MergeField, string | null>;

export interface MergeSideData {
  id: string;
  name: string;
  /** Where it came from and when ("Volunteer form, Oct 3"). */
  line: string;
  activities: number;
  deals: number;
  values: Values;
  labels: Values;
}

export interface MergeCardData {
  kind: "person" | "company";
  why: string | null;
  sides: [MergeSideData, MergeSideData];
  same: string[];
}

const LABELS: Record<MergeField, string> = {
  name: "Name",
  primaryEmail: "Email",
  phone: "Phone",
  companyId: "Company",
  ownerId: "Owner",
};

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function MergeCard({ orgId, data }: { orgId: string; data: MergeCardData | null }) {
  const router = useRouter();
  const { close } = useCrmOpen();
  const [picks, setPicks] = useState<MergePicks | null>(() =>
    data ? defaultPicks(data.sides[0].values, data.sides[1].values) : null,
  );
  const [busy, setBusy] = useState(false);

  if (!data || !picks) {
    return (
      <CrmCard title="Merge">
        <EmptyState
          title="One of them isn't here any more"
          description="It may have been merged already or moved to the trash."
        />
      </CrmCard>
    );
  }

  const [a, b] = data.sides;
  const { keep, patch } = mergeWith(a.values, b.values, picks);
  const kept = keep === "a" ? a : b;
  const gone = keep === "a" ? b : a;
  const fields =
    data.kind === "person"
      ? MERGE_FIELDS.filter((f) => a.labels[f] || b.labels[f])
      : (["name"] as const);
  const moving = gone.activities + gone.deals;

  const merge = async () => {
    setBusy(true);
    const r = await runAction(() => mergeRecordsAction(orgId, data.kind, kept.id, gone.id, patch));
    setBusy(false);
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    toast({
      title: `Merged into ${r.name || kept.name}.`,
      description:
        gone.activities || gone.deals
          ? `${plural(gone.activities, "activity", "activities")} and ${plural(gone.deals, "deal")} moved. ${gone.name} is in the trash, marked as merged.`
          : `${gone.name} is in the trash, marked as merged.`,
    });
    close();
    router.refresh();
  };

  const keepBoth = async () => {
    setBusy(true);
    const r = await runAction(() => keepBothAction(orgId, data.kind, a.id, b.id));
    setBusy(false);
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    toast({ title: "Kept both. They won't be suggested as duplicates again." });
    close();
    router.refresh();
  };

  return (
    <CrmCard
      title={`Merge into ${kept.name}`}
      subtitle={data.why ?? undefined}
      description={`Merge ${a.name} and ${b.name}`}
      foot={
        <div className="flex items-center gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void keepBoth()}>
            Keep both
          </Button>
          <span className="flex-1" />
          <Button disabled={busy} onClick={() => void merge()}>
            {busy ? "Merging…" : "Merge"}
          </Button>
        </div>
      }
    >
      <div className="grid gap-3">
        <Row label="">
          {[a, b].map((s) => (
            <div key={s.id} className="min-w-0 flex-1 px-1">
              <b className="block truncate text-[15px]">{s.name}</b>
              <span className="text-muted-foreground block text-[13px]">
                {s.line}. {plural(s.activities, "activity", "activities")}
                {s.deals ? `, ${plural(s.deals, "deal")}` : ""}.
              </span>
            </div>
          ))}
        </Row>
        {fields.map((f) => (
          <Row key={f} label={LABELS[f]} group>
            {(["a", "b"] as MergeSide[]).map((side) => {
              const s = side === "a" ? a : b;
              const on = picks[f] === side;
              const value = s.labels[f];
              return (
                <button
                  key={side}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={`${LABELS[f]}: ${value ?? "None"}`}
                  onClick={() => setPicks({ ...picks, [f]: side })}
                  className={cn(
                    "flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-full px-4 text-start text-[14.5px] transition-colors",
                    on
                      ? "bg-muted font-semibold shadow-[inset_0_0_0_2px_var(--foreground)]"
                      : "shadow-[inset_0_0_0_1px_var(--border)] hover:bg-muted/50",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-4 shrink-0 rounded-full",
                      on ? "bg-background border-foreground border-[5px]" : "border-muted-foreground border-[1.5px]",
                    )}
                  />
                  <span className={cn("min-w-0 truncate", !value && "text-muted-foreground italic")}>
                    {value ?? "None"}
                  </span>
                </button>
              );
            })}
          </Row>
        ))}
        {data.same.length > 0 && (
          <Row label="Same">
            <span className="px-1 text-[15px]">{data.same.join(", ")}</span>
          </Row>
        )}
        {data.kind === "person" && (
          <p className="text-muted-foreground px-1 text-sm">The email you don&apos;t keep stays on as an extra.</p>
        )}
        <p className="bg-muted rounded-2xl px-4 py-3 text-[15px]">
          {moving
            ? `${plural(gone.activities, "activity", "activities")} and ${plural(gone.deals, "deal")} move to ${kept.name}.`
            : `Nothing to move: ${gone.name} has no activity or deals.`}{" "}
          {gone.name} goes to the trash, marked as merged, so nothing is lost.
        </p>
      </div>
    </CrmCard>
  );
}

function Row({ label, group, children }: { label: string; group?: boolean; children: React.ReactNode }) {
  return (
    <div
      className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-3 max-sm:grid-cols-1"
      {...(group ? { role: "radiogroup", "aria-label": label } : {})}
    >
      <span className="text-muted-foreground text-sm">{label}</span>
      <div className="flex min-w-0 gap-2">{children}</div>
    </div>
  );
}
