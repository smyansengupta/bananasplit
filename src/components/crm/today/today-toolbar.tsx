"use client";

import { UserRound, UsersRound } from "@/components/icons";
import { useSearchParams } from "next/navigation";

import { CrmFilterPick, CrmRoundToggle, CrmToolbar } from "@/components/crm/chrome/crm-toolbar";
import type { ResolvedCrmTab } from "@/lib/crm/nav";

/**
 * Today's toolbar, in Tasks' order: the tabs, Mine and Everyone's as round
 * buttons, Filters (which group to show), then search on the right. Done on
 * its own lives in the right column, under Goals and Coming up. A Personal
 * space (`personal`) has no Mine and Everyone's: it's all yours.
 */
export function TodayToolbar({
  tabs,
  personal = false,
}: {
  tabs: readonly ResolvedCrmTab[];
  personal?: boolean;
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
      {!personal && (
        <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Whose">
          <CrmRoundToggle icon={UserRound} label="Mine" param="who" value="mine" isDefault />
          <CrmRoundToggle icon={UsersRound} label="Everyone's" param="who" value="all" />
        </div>
      )}
    </CrmToolbar>
  );
}
