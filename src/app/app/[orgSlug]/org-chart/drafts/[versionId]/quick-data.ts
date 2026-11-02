import { notFound, redirect } from "next/navigation";

import { can } from "@/lib/auth/permissions";
import type { DraftPosition } from "@/lib/org-chart/draft";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { getOrgMembersForPicker } from "@/server/members";
import { loadVersion } from "@/server/org-chart/service";

/**
 * What the quick setup screens (review, seats) need: an editable draft,
 * its positions and the members. Anything that is not a ready draft (a
 * published version, a document still being read) goes to the full
 * editor, which explains it.
 */
export async function loadQuickDraft(orgSlug: string, versionId: string) {
  const { organization, role } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "orgchart.write")) notFound();
  const detail = await withOrgTx(organization.id, (ctx) => loadVersion(ctx, versionId));
  if (!detail) notFound();
  const { version } = detail;
  if (version.status !== "DRAFT" || (version.parseStatus && version.parseStatus !== "READY")) {
    redirect(`/app/${orgSlug}/org-chart/drafts/${versionId}`);
  }
  const members = await getOrgMembersForPicker(organization.id);
  const positions: DraftPosition[] = detail.positions.map((p) => ({
    id: p.id,
    key: p.key,
    title: p.title,
    personName: p.personName,
    userId: p.userId,
    matchState: p.matchState,
    matchScore: p.matchScore,
    suggestedUserIds: p.suggestedUserIds,
    reportsTo: p.reportsToId,
    alsoReportsTo: p.alsoReportsToIds,
    isOpen: p.isOpen,
    isAdvisor: p.isAdvisor,
    responsibilities: p.responsibilities,
    decidesAlone: p.decidesAlone,
    sourceQuote: p.sourceQuote,
    rank: p.rank,
    teamId: p.teamId,
  }));
  return {
    organization,
    canSetTitles: can({ role }, "members.setTitle"),
    version: {
      id: version.id,
      number: version.number,
      editVersion: version.editVersion,
      openItems: version.openItems,
      teams: version.teams,
    },
    positions,
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      image: m.image,
      avatar: m.avatar,
      title: m.title,
      role: m.role,
    })),
  };
}
