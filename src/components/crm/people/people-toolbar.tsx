"use client";

import { Building2, ChartColumn, Columns3, UserRound } from "@/components/icons";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { peopleListCountsAction } from "@/app/app/[orgSlug]/crm/people-actions";

import { CrmFilterPick, CrmToolbar, useParamSetter } from "@/components/crm/chrome/crm-toolbar";
import { chipClass } from "@/components/ui/segmented";
import { ExpandChip } from "@/components/ui/toolbar-chips";
import type { ResolvedCrmTab } from "@/lib/crm/nav";
import type { PeopleView } from "@/lib/crm/people-view";
import { cn } from "@/lib/utils";

/**
 * People's toolbar (People.dc.html; docs/features/crm.md, "One list"):
 * the tabs, People, Companies and Board as round buttons (?view=), Report
 * on the board (its pipeline's Deals report in Databases > Reports),
 * Filters holding Lists (the ones the CRM keeps and the organization's
 * own, each with its count), Owner, Relationship and the deal filters
 * (Pipeline when there's more than one, Stage, Deal type, Open, won or
 * lost), then search over people, companies and deal names.
 */

export interface ToolbarList {
  id: string;
  label: string;
  /** Counted on the server for the open list only; the rest come when Filters opens. */
  count: number | null;
}

/** The URL's filters as the counts read them (the open card and the page don't change a count). */
function countsKey(params: { toString(): string }): string {
  const rest = new URLSearchParams(params.toString());
  rest.delete("open");
  rest.delete("page");
  rest.delete("list");
  rest.sort();
  return rest.toString();
}

/** Asks for every list's count once Filters is open (it mounts with the panel). */
function LoadCounts({
  orgId,
  query,
  onLoad,
}: {
  orgId: string;
  query: string;
  onLoad: (query: string, counts: Record<string, number>) => void;
}) {
  useEffect(() => {
    let live = true;
    void peopleListCountsAction(orgId, Object.fromEntries(new URLSearchParams(query))).then((r) => {
      if (live && r.ok) onLoad(query, r.counts);
    });
    return () => {
      live = false;
    };
  }, [orgId, query, onLoad]);
  return null;
}

const OPTION =
  "hover:bg-muted flex h-10 w-full items-center gap-2.5 rounded-xl px-3 text-start text-[15px] font-semibold transition-colors";
const CHIP =
  "focus-glow inline-flex h-8 items-center rounded-full px-3 text-[13px] font-semibold transition-colors";

function chip(on: boolean) {
  return cn(
    CHIP,
    on
      ? "bg-foreground text-background"
      : "text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,currentColor_22%,transparent)] hover:bg-muted",
  );
}

const DEAL_KEYS = ["pipeline", "stage", "type", "show"] as const;

export function PeopleToolbar({
  orgId,
  tabs,
  view,
  lists,
  trash,
  members,
  relationships,
  deals,
  reportHref,
  personal = false,
}: {
  orgId: string;
  tabs: readonly ResolvedCrmTab[];
  view: PeopleView;
  lists: readonly ToolbarList[];
  trash: number;
  members: readonly { id: string; name: string }[];
  relationships: readonly { id: string; label: string }[];
  deals: {
    pipelines: readonly { id: string; name: string }[];
    stages: readonly { id: string; label: string }[];
    types: readonly string[];
  };
  /** The board's report (Databases > Reports), when on the board. */
  reportHref: string | null;
  /** A Personal space: everything is yours, so no Owner filter. */
  personal?: boolean;
}) {
  const { params, set } = useParamSetter();
  const query = countsKey(params);
  const [loaded, setLoaded] = useState<{ query: string; counts: Record<string, number> } | null>(null);
  const counts = loaded?.query === query ? loaded.counts : null;
  const onCounts = useCallback((q: string, c: Record<string, number>) => setLoaded({ query: q, counts: c }), []);
  const companies = view === "companies";
  const board = view === "board";
  const list = params.get("list") ?? "";
  const inTrash = params.get("trash") === "1";
  const owner = params.get("owner") ?? "";
  const rel = params.get("rel") ?? "";
  const count =
    (list || inTrash ? 1 : 0) +
    (owner ? 1 : 0) +
    (rel && !companies ? 1 : 0) +
    DEAL_KEYS.filter((k) => params.get(k)).length;
  // A switch between People and Companies starts over: their lists and
  // relationships aren't the other's. The deal filters carry over.
  const show = (next: PeopleView) => {
    const patch: Record<string, string | null> = {
      view: next === "people" ? null : next,
      page: null,
      trash: null,
      open: null,
    };
    if ((next === "companies") !== companies) {
      patch.list = null;
      patch.rel = null;
    }
    set(patch);
  };

  const filters = [
    {
      name: "Lists",
      node: (
        <div className="flex max-h-72 flex-col !justify-start gap-0.5 overflow-y-auto">
          {!counts && <LoadCounts orgId={orgId} query={query} onLoad={onCounts} />}
          {lists.map((l) => (
            <button
              key={l.id || "all"}
              type="button"
              aria-pressed={!inTrash && l.id === list}
              onClick={() => set({ list: l.id || null, trash: null, page: null, open: null })}
              className={cn(OPTION, !inTrash && l.id === list && "bg-muted")}
            >
              <span className="min-w-0 flex-1 truncate">{l.label}</span>
              <span className="text-muted-foreground text-sm font-medium tabular-nums">
                {counts?.[l.id] ?? l.count ?? ""}
              </span>
            </button>
          ))}
          {trash > 0 && !board && (
            <button
              type="button"
              aria-pressed={inTrash}
              onClick={() =>
                set({ trash: inTrash ? null : "1", list: null, page: null, open: null })
              }
              className={cn(OPTION, "text-muted-foreground font-medium", inTrash && "bg-muted")}
            >
              <span className="min-w-0 flex-1 truncate">In the trash</span>
              <span className="text-sm tabular-nums">{trash}</span>
            </button>
          )}
        </div>
      ),
    },
    ...(personal
      ? []
      : [
          {
            name: "Owner",
            node: (
              <div className="flex flex-wrap !justify-start gap-1.5">
                {[
                  { value: "", label: "Anyone" },
                  { value: "me", label: "Me" },
                  ...members
                    .slice(0, 16)
                    .map((m) => ({ value: m.id, label: m.name.split(" ")[0] ?? m.name })),
                  { value: "none", label: "Nobody" },
                ].map((o) => (
                  <button
                    key={o.value || "any"}
                    type="button"
                    aria-pressed={owner === o.value}
                    onClick={() => set({ owner: o.value || null, page: null })}
                    className={chip(owner === o.value)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            ),
          },
        ]),
    ...(!companies && relationships.length > 0
      ? [
          {
            name: "Relationship",
            node: (
              <div className="flex flex-wrap !justify-start gap-1.5">
                {relationships.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    aria-pressed={rel === r.id}
                    onClick={() => set({ rel: rel === r.id ? null : r.id, page: null })}
                    className={chip(rel === r.id)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            ),
          },
        ]
      : []),
    ...(deals.pipelines.length > 1
      ? [
          {
            name: "Pipeline",
            node: (
              <CrmFilterPick
                param="pipeline"
                also={{ stage: null, page: null }}
                options={[
                  { value: "", label: board ? "The main one" : "Every pipeline" },
                  ...deals.pipelines.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
            ),
          },
        ]
      : []),
    ...(deals.stages.length > 0
      ? [
          {
            name: "Stage",
            node: (
              <CrmFilterPick
                param="stage"
                also={{ page: null }}
                options={[
                  { value: "", label: "Any stage" },
                  ...deals.stages.map((s) => ({ value: s.id, label: s.label })),
                ]}
              />
            ),
          },
        ]
      : []),
    ...(deals.types.length > 0
      ? [
          {
            name: "Deal type",
            node: (
              <CrmFilterPick
                param="type"
                also={{ page: null }}
                options={[
                  { value: "", label: "Any type" },
                  ...deals.types.map((t) => ({ value: t.toLowerCase(), label: t })),
                ]}
              />
            ),
          },
        ]
      : []),
    ...(deals.pipelines.length > 0
      ? [
          {
            name: board ? "Show" : "Deals",
            node: (
              <CrmFilterPick
                param="show"
                also={{ page: null }}
                options={
                  board
                    ? [
                        { value: "", label: "Open" },
                        { value: "won", label: "Won" },
                        { value: "lost", label: "Lost" },
                        { value: "all", label: "Open, won and lost" },
                      ]
                    : [
                        { value: "", label: "With a deal or not" },
                        { value: "open", label: "With an open deal" },
                        { value: "won", label: "With a won deal" },
                        { value: "lost", label: "With a lost deal" },
                        { value: "all", label: "With any deal" },
                      ]
                }
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <CrmToolbar
      tabs={tabs}
      filters={filters}
      filterCount={count}
      search={{ placeholder: "Search people, companies and deals" }}
    >
      <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Show">
        <ExpandChip
          icon={UserRound}
          label="People"
          active={view === "people"}
          onClick={() => show("people")}
        />
        <ExpandChip
          icon={Building2}
          label="Companies"
          active={companies}
          onClick={() => show("companies")}
        />
        <ExpandChip icon={Columns3} label="Board" active={board} onClick={() => show("board")} />
      </div>
      {reportHref && (
        <Link
          href={reportHref}
          aria-label="Report"
          title="Report"
          className={cn(chipClass(false), "group/expand gap-0 px-3")}
        >
          <ChartColumn className="size-4 flex-none" aria-hidden="true" />
          <span
            aria-hidden="true"
            className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-[max-width,opacity,margin] duration-300 ease-(--ease-ink) group-hover/expand:ms-1.5 group-hover/expand:max-w-32 group-hover/expand:opacity-100 group-focus-visible/expand:ms-1.5 group-focus-visible/expand:max-w-32 group-focus-visible/expand:opacity-100 motion-reduce:transition-none"
          >
            Report
          </span>
        </Link>
      )}
    </CrmToolbar>
  );
}
