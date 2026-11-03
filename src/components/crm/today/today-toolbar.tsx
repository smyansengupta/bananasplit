"use client";

import { UserRound, UsersRound } from "@/components/icons";
import { useSearchParams } from "next/navigation";

import { CrmFilterPick, CrmRoundToggle, CrmToolbar } from "@/components/crm/chrome/crm-toolbar";
import { CrmOpenPill } from "@/components/crm/chrome/open-pill";
import type { ResolvedCrmTab } from "@/lib/crm/nav";

/**
 * Today's toolbar: the tabs, Mine and Everyone's as round buttons, Done on
 * its own with its count, Filters (which group to show) and search.
 */
export function TodayToolbar({
  tabs,
  logCount,
}: {
  tabs: readonly ResolvedCrmTab[];
  logCount: number;
}) {
  const params = useSearchParams();
  return (
    <CrmToolbar
      tabs={tabs}
      filters={[
        {
          name: "Show",
          node: (
            <CrmFilterPick
              param="show"
              options={[
                { value: "", label: "Everything" },
                { value: "replies", label: "Replies" },
                { value: "due", label: "Due today" },
                { value: "approve", label: "To approve" },
                { value: "calls", label: "Calls" },
              ]}
            />
          ),
        },
      ]}
      filterCount={params.get("show") ? 1 : 0}
      search={{ placeholder: "Search or ask" }}
    >
      <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Whose">
        <CrmRoundToggle icon={UserRound} label="Mine" param="who" value="mine" isDefault />
        <CrmRoundToggle icon={UsersRound} label="Everyone's" param="who" value="all" />
      </div>
      <CrmOpenPill
        open="log"
        label="Done on its own"
        count={logCount}
        title="What the CRM did without anyone clicking, each with Undo"
      />
    </CrmToolbar>
  );
}
