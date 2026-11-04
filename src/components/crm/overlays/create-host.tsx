"use client";

import { GoalCard } from "@/components/crm/cards/goal-card";
import { NewCard } from "@/components/crm/cards/new-card";
import { useCrmOpen } from "@/components/crm/card/use-crm-open";
import type { GoalMetric } from "@/lib/crm/forecast";
import type { OrgMemberOption } from "@/server/members";

/**
 * The create dialogs, opened from what came with the page: `?open=new:...`
 * and `?open=goal` draw the real dialog the moment the URL has them, with
 * nothing to wait for and no frame in front. CrmOverlays renders this on
 * every page that takes `?open=`, so a direct visit works the same way.
 */

export interface CrmCreateData {
  orgId: string;
  viewerId: string;
  personal: boolean;
  canSetGoals: boolean;
  members: OrgMemberOption[];
  pipelines: { id: string; name: string; stages: { id: string; name: string }[] }[];
  relationships: { id: string; label: string }[];
  /** A new goal's starting what and when. */
  goal: { metric: GoalMetric; periodKey: string; today: string };
}

export function CrmCreateHost({ data }: { data: CrmCreateData }) {
  const { open } = useCrmOpen();
  if (open?.kind === "new") {
    return (
      <NewCard
        orgId={data.orgId}
        what={open.what}
        viewerId={data.viewerId}
        members={data.members}
        personal={data.personal}
        pipelines={data.pipelines}
        relationships={data.relationships}
      />
    );
  }
  if (open?.kind === "goal" && open.id === null) {
    return (
      <GoalCard
        orgId={data.orgId}
        data={{
          ...data.goal,
          id: null,
          ownerId: null,
          pipelineId: null,
          target: null,
          actual: 0,
          viewerId: data.viewerId,
          members: data.members,
          canEdit: data.canSetGoals,
          personal: data.personal,
        }}
      />
    );
  }
  return null;
}
