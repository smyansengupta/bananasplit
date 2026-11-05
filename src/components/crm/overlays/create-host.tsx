"use client";

import { useEffect, useMemo, useState } from "react";

import { pickerMembersAction } from "@/app/app/[orgSlug]/crm/people-actions";
import { GoalCard } from "@/components/crm/cards/goal-card";
import { NewCard } from "@/components/crm/cards/new-card";
import { useCrmOpen } from "@/components/crm/card/use-crm-open";
import type { Role } from "@/generated/prisma/client";
import type { GoalMetric } from "@/lib/crm/forecast";
import type { OrgMemberOption } from "@/server/members";

/**
 * The create dialogs, opened from what came with the page: `?open=new:...`
 * and `?open=goal` draw the real dialog the moment the URL has them, with
 * nothing to wait for and no frame in front. CrmOverlays renders this on
 * every page that takes `?open=`, so a direct visit works the same way. The
 * Owner picker starts with you, its default, and the rest of the members
 * fill in once a dialog is open.
 */

export interface CrmCreateData {
  orgId: string;
  viewerId: string;
  personal: boolean;
  canSetGoals: boolean;
  viewerName: string | null;
  viewerRole: Role;
  pipelines: { id: string; name: string; stages: { id: string; name: string }[] }[];
  relationships: { id: string; label: string }[];
  /** A new goal's starting what and when. */
  goal: { metric: GoalMetric; periodKey: string; today: string };
}

/** The picker's people: you at once, everyone once `wanted` (a Personal space doesn't ask). */
function usePickerMembers(data: CrmCreateData, wanted: boolean): OrgMemberOption[] {
  const { orgId, personal, viewerId, viewerName, viewerRole } = data;
  const [loaded, setLoaded] = useState<OrgMemberOption[] | null>(null);
  const fetching = wanted && !personal && loaded === null;
  useEffect(() => {
    if (!fetching) return;
    let current = true;
    void pickerMembersAction(orgId).then((r) => {
      if (current && r.ok) setLoaded(r.members);
    });
    return () => {
      current = false;
    };
  }, [fetching, orgId]);
  return useMemo(
    () =>
      personal
        ? []
        : (loaded ?? [
            { id: viewerId, name: viewerName, image: null, avatar: null, role: viewerRole, title: null },
          ]),
    [personal, loaded, viewerId, viewerName, viewerRole],
  );
}

export function CrmCreateHost({ data }: { data: CrmCreateData }) {
  const { open } = useCrmOpen();
  const members = usePickerMembers(
    data,
    open?.kind === "new" || (open?.kind === "goal" && open.id === null),
  );
  if (open?.kind === "new") {
    return (
      <NewCard
        orgId={data.orgId}
        what={open.what}
        viewerId={data.viewerId}
        members={members}
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
          members,
          canEdit: data.canSetGoals,
          personal: data.personal,
        }}
      />
    );
  }
  return null;
}
