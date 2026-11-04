"use client";

import { Building2, ChartColumn, Check, Columns3, UserRound } from "@/components/icons";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { peopleListCountsAction } from "@/app/app/[orgSlug]/crm/people-actions";

import {
  CrmFilterPick,
  CrmToolbar,
  useParamSetter,
  type CrmFilterChip,
} from "@/components/crm/chrome/crm-toolbar";
import { Input } from "@/components/ui/input";
import { chipClass } from "@/components/ui/segmented";
import type { ResolvedCrmTab } from "@/lib/crm/nav";
import type { CrmScope } from "@/lib/crm/scope";
import type { PeopleView } from "@/lib/crm/people-view";
import { cn } from "@/lib/utils";

/**
 * People's toolbar (People.dc.html; docs/features/crm.md, "One list"):
 * the tabs, People, Companies and Board as Tasks' labelled view switch
 * (?view=), whose as Tasks' scope chips (Mine, My team, Everyone: ?owner=
 * me, team or nothing), Filters holding Lists (the ones the CRM keeps and
 * the organization's own, each with its count), Owner (any member, found
 * by typing), Relationship and the deal filters (Pipeline when there's
 * more than one, Stage, Deal type, Open, won or lost), then Report on the
 * board (its pipeline's Deals report) and search over people, companies
 * and deal names. The filters that are on show under the bar as chips.
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

/**
 * Owner, in Filters: every member, found by typing (an organization with
 * more members than fit doesn't lose anyone), and Nobody. Mine and My team
 * are the scope chips in the bar, as in Tasks.
 */
function OwnerPick({
  members,
  value,
  onPick,
}: {
  members: readonly { id: string; name: string }[];
  value: string;
  onPick: (value: string | null) => void;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle ? members.filter((m) => m.name.toLowerCase().includes(needle)) : members;
  const options = [
    ...shown.map((m) => ({ value: m.id, label: m.name })),
    ...(needle ? [] : [{ value: "none", label: "Nobody" }]),
  ];
  return (
    <div className="flex min-w-0 flex-col !justify-start gap-1.5">
      {members.length > 6 && (
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Find one of ${members.length} members`}
          aria-label="Find a member"
          className="h-9"
        />
      )}
      <div
        className="flex max-h-56 flex-col gap-0.5 overflow-y-auto"
        role="listbox"
        aria-label="Owner"
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="option"
            aria-selected={value === o.value}
            onClick={() => onPick(value === o.value ? null : o.value)}
            className={cn(OPTION, "h-9 text-sm", value === o.value && "bg-muted")}
          >
            <span className="min-w-0 flex-1 truncate">{o.label}</span>
            {value === o.value && <Check className="size-4 shrink-0" aria-hidden="true" />}
          </button>
        ))}
        {options.length === 0 && (
          <p className="text-muted-foreground px-3 py-2 text-sm">Nobody by that name.</p>
        )}
      </div>
    </div>
  );
}

const VIEWS = [
  { value: "people", label: "People", icon: UserRound },
  { value: "companies", label: "Companies", icon: Building2 },
  { value: "board", label: "Board", icon: Columns3 },
] as const;

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
  hasTeam = false,
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
  /** A Personal space: everything is yours, so no scope or Owner filter. */
  personal?: boolean;
  /** The viewer has people under them on the org chart: My team is offered. */
  hasTeam?: boolean;
}) {
  const { params, set } = useParamSetter();
  const query = countsKey(params);
  const [loaded, setLoaded] = useState<{ query: string; counts: Record<string, number> } | null>(
    null,
  );
  const counts = loaded?.query === query ? loaded.counts : null;
  const onCounts = useCallback(
    (q: string, c: Record<string, number>) => setLoaded({ query: q, counts: c }),
    [],
  );
  const companies = view === "companies";
  const board = view === "board";
  const list = params.get("list") ?? "";
  const inTrash = params.get("trash") === "1";
  const owner = params.get("owner") ?? "";
  const rel = params.get("rel") ?? "";
  const q = params.get("q") ?? "";
  const pipeline = params.get("pipeline") ?? "";
  const stage = params.get("stage") ?? "";
  const type = params.get("type") ?? "";
  const dealShow = params.get("show") ?? "";
  // Mine and My team are the scope; a member (or Nobody) picked in Filters pins the list to them.
  const pinned = owner && owner !== "me" && owner !== "team" ? owner : "";
  const scope: CrmScope | null =
    owner === "me" ? "mine" : owner === "team" ? "team" : pinned ? null : "all";
  const count =
    (list || inTrash ? 1 : 0) +
    (pinned ? 1 : 0) +
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

  const showLabels: Record<string, string> = board
    ? { won: "Won", lost: "Lost", all: "Open, won and lost" }
    : {
        open: "With an open deal",
        won: "With a won deal",
        lost: "With a lost deal",
        all: "With any deal",
      };
  const chip1 = (key: string, label: string, clear: Record<string, null>): CrmFilterChip => ({
    key,
    label,
    onClear: () => set({ ...clear, page: null }),
  });
  const chips: CrmFilterChip[] = [
    ...(inTrash ? [chip1("trash", "In the trash", { trash: null })] : []),
    ...(list && !inTrash
      ? [chip1("list", lists.find((l) => l.id === list)?.label ?? "A list", { list: null })]
      : []),
    ...(pinned
      ? [
          chip1(
            "owner",
            pinned === "none"
              ? "Owned by nobody"
              : `Owned by ${members.find((m) => m.id === pinned)?.name ?? "a member"}`,
            { owner: null },
          ),
        ]
      : []),
    ...(rel && !companies
      ? [
          chip1("rel", relationships.find((r) => r.id === rel)?.label ?? "A relationship", {
            rel: null,
          }),
        ]
      : []),
    ...(pipeline
      ? [
          chip1("pipeline", deals.pipelines.find((p) => p.id === pipeline)?.name ?? "A pipeline", {
            pipeline: null,
            stage: null,
          }),
        ]
      : []),
    ...(stage
      ? [
          chip1("stage", deals.stages.find((s) => s.id === stage)?.label ?? "A stage", {
            stage: null,
          }),
        ]
      : []),
    ...(type
      ? [chip1("type", deals.types.find((t) => t.toLowerCase() === type) ?? type, { type: null })]
      : []),
    ...(dealShow ? [chip1("show", showLabels[dealShow] ?? dealShow, { show: null })] : []),
    ...(q ? [chip1("q", `“${q}”`, { q: null })] : []),
  ];
  // Clear all: every filter and the search; the view and Mine / My team stay.
  const clearAll = () =>
    set({
      list: null,
      trash: null,
      owner: pinned ? null : owner || null,
      rel: null,
      pipeline: null,
      stage: null,
      type: null,
      show: null,
      q: null,
      page: null,
    });

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
              <OwnerPick
                members={members}
                value={pinned}
                onPick={(v) => set({ owner: v, page: null })}
              />
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
      views={{
        label: "Show",
        value: view,
        options: VIEWS,
        onSelect: (v) => show(v as PeopleView),
      }}
      scope={
        personal
          ? undefined
          : {
              options: [
                { value: "mine", label: "Mine" },
                ...(hasTeam ? [{ value: "team" as const, label: "My team" }] : []),
                { value: "all", label: "Everyone" },
              ],
              value: scope,
              onSelect: (v) =>
                set({ owner: v === "mine" ? "me" : v === "team" ? "team" : null, page: null }),
            }
      }
      filters={filters}
      filterCount={count}
      chips={chips}
      onClearAll={clearAll}
      search={{ placeholder: "Search people, companies and deals" }}
      sheetTitle={board ? "Filter deals" : companies ? "Filter companies" : "Filter people"}
      right={
        reportHref && (
          // A labelled link, not a round chip: it goes somewhere, it doesn't filter.
          <Link href={reportHref} className={cn(chipClass(false), "gap-1.5 px-3.5")}>
            <ChartColumn className="size-4" aria-hidden="true" />
            Report
          </Link>
        )
      }
    />
  );
}
