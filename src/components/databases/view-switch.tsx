"use client";

import { cn } from "@/lib/utils";

import { useViewParams } from "./view-params";

/** Tabs that set ?view= (and optionally the poll filter) on the current URL. */
export function ViewSwitch({
  views,
  current,
}: {
  views: { key: string; label: string }[];
  current: string;
}) {
  const view = useViewParams();
  return (
    <div role="tablist" className="bg-muted inline-flex rounded-lg p-0.5 text-sm">
      {views.map((v) => (
        <button
          key={v.key}
          role="tab"
          type="button"
          aria-selected={current === v.key}
          onClick={() =>
            view.update((p) => {
              p.delete("sort");
              p.delete("cols");
              if (v.key === views[0].key) p.delete("view");
              else p.set("view", v.key);
            })
          }
          className={cn(
            "rounded-md px-3 py-1",
            current === v.key ? "bg-background font-medium shadow-sm" : "text-muted-foreground",
          )}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

/** Picks the poll: writes f=ballotDefinitionId:eq:<id> (the report deep-link grammar). */
export function PollPicker({
  polls,
  current,
  allowAll = false,
}: {
  polls: { id: string; title: string; isTest: boolean }[];
  current: string | null;
  allowAll?: boolean;
}) {
  const view = useViewParams();
  return (
    <select
      aria-label="Poll"
      value={current ?? ""}
      onChange={(e) =>
        view.update((p) => {
          const rest = p.getAll("f").filter((f) => !/^(ballotDefinitionId|poll|definition|pollSlug|slug):/.test(f));
          p.delete("f");
          for (const f of rest) p.append("f", f);
          if (e.target.value) p.append("f", `ballotDefinitionId:eq:${e.target.value}`);
        })
      }
      className="border-input bg-background h-8 rounded-md border px-2 text-sm"
    >
      {allowAll && <option value="">All polls</option>}
      {polls.map((poll) => (
        <option key={poll.id} value={poll.id}>
          {poll.title}
          {poll.isTest ? " (test)" : ""}
        </option>
      ))}
    </select>
  );
}
