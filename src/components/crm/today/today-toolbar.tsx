"use client";

import { CrmFilterPick, CrmToolbar, useParamSetter } from "@/components/crm/chrome/crm-toolbar";
import type { ResolvedCrmTab } from "@/lib/crm/nav";
import type { CrmScope } from "@/lib/crm/scope";

const GROUPS = [
  { value: "", label: "Everything" },
  { value: "replies", label: "Replies" },
  { value: "due", label: "Due today" },
  { value: "approve", label: "To approve" },
  { value: "calls", label: "Calls" },
] as const;

/**
 * Today's toolbar, in Tasks' order: the tabs, whose as Tasks' scope chips
 * (Mine, My team for someone with people under them, Everyone; M, T, E),
 * Filters (which group to show), then search on the right; the filters
 * that are on as removable chips with Clear all. Done on its own lives in
 * the right column, under Goals and Coming up. A Personal space
 * (`personal`) has no scope: it's all yours.
 */
export function TodayToolbar({
  tabs,
  personal = false,
  hasTeam = false,
}: {
  tabs: readonly ResolvedCrmTab[];
  personal?: boolean;
  /** The viewer has people under them on the org chart: My team is offered. */
  hasTeam?: boolean;
}) {
  const { params, set } = useParamSetter();
  const who = params.get("who");
  const current: CrmScope = who === "all" || who === "team" ? who : "mine";
  const show = params.get("show") ?? "";
  const q = params.get("q") ?? "";
  const chips = [
    ...(show
      ? [
          {
            key: "show",
            label: GROUPS.find((g) => g.value === show)?.label ?? show,
            onClear: () => set({ show: null }),
          },
        ]
      : []),
    ...(q ? [{ key: "q", label: `“${q}”`, onClear: () => set({ q: null }) }] : []),
  ];
  return (
    <CrmToolbar
      tabs={tabs}
      scope={
        personal
          ? undefined
          : {
              options: [
                { value: "mine", label: "Mine" },
                ...(hasTeam ? [{ value: "team" as const, label: "My team" }] : []),
                { value: "all", label: "Everyone" },
              ],
              value: current,
              onSelect: (v) => set({ who: v === "mine" ? null : v }),
            }
      }
      filters={[{ name: "Show", node: <CrmFilterPick param="show" options={GROUPS} /> }]}
      filterCount={show ? 1 : 0}
      chips={chips}
      onClearAll={() => set({ show: null, q: null })}
      search={{ placeholder: "Search or ask" }}
      sheetTitle="Filter Today"
    />
  );
}
