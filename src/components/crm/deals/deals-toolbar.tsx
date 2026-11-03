"use client";

import { ChartColumn, Columns3, List } from "@/components/icons";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { CrmFilterPick, CrmRoundToggle, CrmToolbar } from "@/components/crm/chrome/crm-toolbar";
import { chipClass } from "@/components/ui/segmented";
import type { ResolvedCrmTab } from "@/lib/crm/nav";
import { cn } from "@/lib/utils";

/**
 * The Deals tab's bar: the tabs, List and Board as round buttons, Report
 * (the deals report), Filters (pipeline when there's more than one, owner,
 * type, open, won or lost) and search.
 */
export function DealsToolbar({
  tabs,
  pipelines,
  members,
  types,
  reportHref,
}: {
  tabs: readonly ResolvedCrmTab[];
  pipelines: readonly { id: string; name: string }[];
  members: readonly { id: string; name: string }[];
  types: readonly string[];
  reportHref: string;
}) {
  const params = useSearchParams();
  const filters = [
    ...(pipelines.length > 1
      ? [
          {
            name: "Pipeline",
            node: (
              <CrmFilterPick
                param="pipeline"
                options={[
                  { value: "", label: "Every pipeline" },
                  ...pipelines.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
            ),
          },
        ]
      : []),
    {
      name: "Owner",
      node: (
        <CrmFilterPick
          param="owner"
          options={[
            { value: "", label: "Anyone" },
            { value: "me", label: "Me" },
            { value: "none", label: "Nobody" },
            ...members.map((m) => ({ value: m.id, label: m.name })),
          ]}
        />
      ),
    },
    ...(types.length > 0
      ? [
          {
            name: "Type",
            node: (
              <CrmFilterPick
                param="type"
                options={[
                  { value: "", label: "Any type" },
                  ...types.map((t) => ({ value: t.toLowerCase(), label: t })),
                ]}
              />
            ),
          },
        ]
      : []),
    {
      name: "Show",
      node: (
        <CrmFilterPick
          param="show"
          options={[
            { value: "", label: "Open" },
            { value: "won", label: "Won" },
            { value: "lost", label: "Lost" },
            { value: "all", label: "Open, won and lost" },
          ]}
        />
      ),
    },
  ];
  const count = ["pipeline", "owner", "type", "show"].filter((k) => params.get(k)).length;
  return (
    <CrmToolbar tabs={tabs} filters={filters} filterCount={count} search={{ placeholder: "Search deals" }}>
      <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Layout">
        <CrmRoundToggle icon={List} label="List" param="view" value="list" isDefault />
        <CrmRoundToggle icon={Columns3} label="Board" param="view" value="board" />
      </div>
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
    </CrmToolbar>
  );
}
