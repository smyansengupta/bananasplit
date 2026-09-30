"use client";

import {
  CalendarDays,
  Cog,
  Crown,
  Database,
  DollarSign,
  EyeOff,
  Shapes,
  ShieldCheck,
  UserCheck,
  Users,
  UsersRound,
  Vote,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState, useTransition } from "react";

import { ContinueButton, FieldError } from "@/components/onboarding/step-card";
import { Input } from "@/components/ui/input";
import { DATA_TAGS, VISIBILITY_OPTIONS, type DataTag, type VisibilityValue } from "@/lib/onboarding/org";
import { cn } from "@/lib/utils";
import type { DataSourceRow } from "@/server/onboarding/org-setup";

import { goToNextOrgStep, saveLabelsStepAction } from "./actions";

const TAGS: Record<DataTag, { icon: LucideIcon; tone: string }> = {
  Finance: { icon: DollarSign, tone: "border-warning/40 bg-warning/10 text-warning" },
  People: { icon: Users, tone: "border-chart-1/40 bg-chart-1/10 text-chart-1" },
  Operations: { icon: Cog, tone: "border-success/40 bg-success/10 text-success" },
  Events: { icon: CalendarDays, tone: "border-chart-5/40 bg-chart-5/10 text-chart-5" },
  Other: { icon: Shapes, tone: "border-foreground/20 bg-muted text-foreground" },
};

const KIND_ICONS: Record<string, LucideIcon> = {
  SESSIONS: CalendarDays,
  ATTENDANCE: UserCheck,
  SIGNUPS: Users,
  BALLOTS: Vote,
  PEOPLE: UsersRound,
};

const VISIBILITY_ICONS: Record<VisibilityValue, LucideIcon> = {
  MEMBERS: Users,
  ADMINS: ShieldCheck,
  OWNER: Crown,
  HIDDEN: EyeOff,
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
    sources.map((s) => ({ id: s.id, key: s.key, kind: s.kind, name: s.name, tag: s.tag })),
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
    <div className="space-y-5">
      <ul className="grid gap-2">
        {rows.map((row, i) => {
          const KindIcon = KIND_ICONS[row.kind] ?? Database;
          return (
            <li key={row.id} className="space-y-2.5 rounded-xl border p-3">
              <div className="flex items-center gap-3">
                <span className="bg-muted grid size-9 shrink-0 place-items-center rounded-lg">
                  <KindIcon className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <Input
                    aria-label={`Label for ${row.key}`}
                    value={row.name}
                    maxLength={60}
                    placeholder="Add a label…"
                    onChange={(e) => update(i, { name: e.target.value })}
                    className="h-8 font-medium"
                  />
                </div>
                <span className="text-muted-foreground hidden font-mono text-[11px] sm:block">{row.key}</span>
              </div>
              <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={`Tag for ${row.key}`}>
                {DATA_TAGS.map((t) => {
                  const on = row.tag === t;
                  const Icon = TAGS[t].icon;
                  return (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => update(i, { tag: t })}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
                        on ? cn(TAGS[t].tone, "font-medium") : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Icon className="size-3" aria-hidden="true" />
                      {t}
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
        {rows.length === 0 && <p className="text-muted-foreground text-sm">No databases yet.</p>}
      </ul>

      {tagsInUse.length > 0 && (
        <div className="space-y-2">
          <div>
            <span className="text-sm font-medium">Who can see what</span>
            <p className="text-muted-foreground text-xs">
              Applies to every source with that tag. Owners and admins always see everything.
            </p>
          </div>
          <div className="divide-y rounded-xl border">
            {tagsInUse.map((tag) => {
              const TagIcon = TAGS[tag].icon;
              const current = visibility[tag] ?? "MEMBERS";
              const VisIcon = VISIBILITY_ICONS[current];
              return (
                <label key={tag} className="flex items-center gap-3 px-3 py-2.5">
                  <span className={cn("grid size-7 shrink-0 place-items-center rounded-md border", TAGS[tag].tone)}>
                    <TagIcon className="size-3.5" aria-hidden="true" />
                  </span>
                  <span className="flex-1 text-sm font-medium">{tag}</span>
                  <span className="relative">
                    <VisIcon
                      className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
                      aria-hidden="true"
                    />
                    <select
                      aria-label={`Who can see ${tag}-tagged data`}
                      value={current}
                      onChange={(e) => setVisibility({ ...visibility, [tag]: e.target.value as VisibilityValue })}
                      className="border-input bg-background h-9 rounded-md border pr-2 pl-8 text-sm"
                    >
                      {VISIBILITY_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      <FieldError message={error ?? undefined} />
      <div className="flex border-t pt-4">
        <ContinueButton pending={pending} onClick={submit} disabled={rows.some((r) => !r.name.trim())} />
      </div>
    </div>
  );
}
