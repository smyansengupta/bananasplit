"use client";

import { useMemo, useState, useTransition } from "react";

import { FieldError } from "@/components/onboarding/step-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DATA_TAGS,
  VISIBILITY_OPTIONS,
  type DataTag,
  type VisibilityValue,
} from "@/lib/onboarding/org";
import { cn } from "@/lib/utils";
import type { DataSourceRow } from "@/server/onboarding/org-setup";

import { goToNextOrgStep, saveLabelsStepAction } from "./actions";

const TAG_TONE: Record<DataTag, string> = {
  Finance: "bg-warning/15 text-warning",
  People: "bg-chart-2/15 text-chart-2",
  Operations: "bg-success/15 text-success",
  Events: "bg-primary/10 text-primary",
  Other: "bg-muted text-muted-foreground",
};

/**
 * B3 · Label sources: a label and a tag for every database, and who can see
 * each tag's data (the databases' member visibility, enforced by RLS).
 */
export function LabelsStep({
  orgId,
  orgSlug,
  sources,
}: {
  orgId: string;
  orgSlug: string;
  sources: DataSourceRow[];
}) {
  const [rows, setRows] = useState(
    sources.map((s) => ({ id: s.id, key: s.key, name: s.name, tag: s.tag })),
  );
  const initialVisibility = useMemo(() => {
    const out: Partial<Record<DataTag, VisibilityValue>> = {};
    for (const s of sources) if (!out[s.tag]) out[s.tag] = s.memberVisibility as VisibilityValue;
    return out;
  }, [sources]);
  const [visibility, setVisibility] = useState(initialVisibility);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const tagsInUse = DATA_TAGS.filter((t) => rows.some((r) => r.tag === t));

  function update(i: number, patch: Partial<(typeof rows)[number]>) {
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  function submit() {
    setError(null);
    start(async () => {
      const vis: Partial<Record<DataTag, VisibilityValue>> = {};
      for (const t of tagsInUse) vis[t] = visibility[t] ?? "MEMBERS";
      const result = await saveLabelsStepAction(orgId, {
        sources: rows.map((r) => ({ id: r.id, name: r.name, tag: r.tag })),
        visibility: vis,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await goToNextOrgStep(orgSlug, "labels");
    });
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border">
        <div className="bg-muted/50 text-muted-foreground grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)] gap-2 px-3 py-2 font-mono text-[10px] tracking-[0.08em]">
          <span>SOURCE</span>
          <span>LABEL</span>
          <span>TAG</span>
        </div>
        {rows.map((row, i) => (
          <div
            key={row.id}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)] items-center gap-2 border-t px-3 py-2 text-xs"
          >
            <span className="text-muted-foreground truncate font-mono">db.{row.key}</span>
            <Input
              aria-label={`Label for ${row.key}`}
              value={row.name}
              maxLength={60}
              placeholder="Add label…"
              onChange={(e) => update(i, { name: e.target.value })}
              className="h-7 text-xs"
            />
            <select
              aria-label={`Tag for ${row.key}`}
              value={row.tag}
              onChange={(e) => update(i, { tag: e.target.value as DataTag })}
              className={cn(
                "h-7 w-fit rounded-full border-0 px-2 text-[11px] font-medium",
                TAG_TONE[row.tag],
              )}
            >
              {DATA_TAGS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="text-muted-foreground border-t px-3 py-3 text-xs">No databases yet.</p>
        )}
      </div>

      {tagsInUse.length > 0 && (
        <div className="grid gap-2">
          {tagsInUse.map((tag) => (
            <label key={tag} className="grid gap-1.5">
              <span className="text-xs font-medium">Who can see {tag}-tagged data</span>
              <select
                value={visibility[tag] ?? "MEMBERS"}
                onChange={(e) =>
                  setVisibility({ ...visibility, [tag]: e.target.value as VisibilityValue })
                }
                className="border-input bg-background h-9 rounded-md border px-3 text-sm"
              >
                {VISIBILITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <p className="text-muted-foreground text-xs">
            Applies to every source with that tag. Owners and admins always see everything.
          </p>
        </div>
      )}

      <FieldError message={error ?? undefined} />
      <Button
        type="button"
        className="w-full font-semibold"
        onClick={submit}
        disabled={pending || rows.some((r) => !r.name.trim())}
      >
        {pending ? "Saving…" : "Continue"}
      </Button>
    </div>
  );
}
