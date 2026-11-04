"use client";

import { Building2, UserRound } from "@/components/icons";

import { CrmToolbar, useParamSetter } from "@/components/crm/chrome/crm-toolbar";
import { ExpandChip } from "@/components/ui/toolbar-chips";
import type { ResolvedCrmTab } from "@/lib/crm/nav";
import { cn } from "@/lib/utils";

/**
 * People's toolbar (People.dc.html): the tabs, People and Companies as
 * round buttons (?view=companies), Filters holding Lists (the ones the CRM
 * keeps and the organization's own, each with its count), Owner and
 * Relationship, then search.
 */

export interface ToolbarList {
  id: string;
  label: string;
  count: number;
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

export function PeopleToolbar({
  tabs,
  companies,
  lists,
  trash,
  members,
  relationships,
}: {
  tabs: readonly ResolvedCrmTab[];
  companies: boolean;
  lists: readonly ToolbarList[];
  trash: number;
  members: readonly { id: string; name: string }[];
  relationships: readonly { id: string; label: string }[];
}) {
  const { params, set } = useParamSetter();
  const list = params.get("list") ?? "";
  const inTrash = params.get("trash") === "1";
  const owner = params.get("owner") ?? "";
  const rel = params.get("rel") ?? "";
  const count = (list || inTrash ? 1 : 0) + (owner ? 1 : 0) + (rel && !companies ? 1 : 0);
  // A switch of view starts over: its lists and relationships aren't the other's.
  const show = (view: "people" | "companies") =>
    set({ view: view === "companies" ? "companies" : null, list: null, rel: null, page: null, trash: null, open: null });

  const filters = [
    {
      name: "Lists",
      node: (
        <div className="flex max-h-72 flex-col !justify-start gap-0.5 overflow-y-auto">
          {lists.map((l) => (
            <button
              key={l.id || "all"}
              type="button"
              aria-pressed={!inTrash && l.id === list}
              onClick={() => set({ list: l.id || null, trash: null, page: null, open: null })}
              className={cn(OPTION, !inTrash && l.id === list && "bg-muted")}
            >
              <span className="min-w-0 flex-1 truncate">{l.label}</span>
              <span className="text-muted-foreground text-sm font-medium tabular-nums">{l.count}</span>
            </button>
          ))}
          {trash > 0 && (
            <button
              type="button"
              aria-pressed={inTrash}
              onClick={() => set({ trash: inTrash ? null : "1", list: null, page: null, open: null })}
              className={cn(OPTION, "text-muted-foreground font-medium", inTrash && "bg-muted")}
            >
              <span className="min-w-0 flex-1 truncate">In the trash</span>
              <span className="text-sm tabular-nums">{trash}</span>
            </button>
          )}
        </div>
      ),
    },
    {
      name: "Owner",
      node: (
        <div className="flex flex-wrap !justify-start gap-1.5">
          {[
            { value: "", label: "Anyone" },
            { value: "me", label: "Me" },
            ...members.slice(0, 16).map((m) => ({ value: m.id, label: m.name.split(" ")[0] ?? m.name })),
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
  ];

  return (
    <CrmToolbar
      tabs={tabs}
      filters={filters}
      filterCount={count}
      search={{ placeholder: companies ? "Search companies" : "Search people" }}
    >
      <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Show">
        <ExpandChip icon={UserRound} label="People" active={!companies} onClick={() => show("people")} />
        <ExpandChip
          icon={Building2}
          label="Companies"
          active={companies}
          onClick={() => show("companies")}
        />
      </div>
    </CrmToolbar>
  );
}
