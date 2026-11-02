import { notFound, redirect } from "next/navigation";

import { can } from "@/lib/auth/permissions";
import type { DraftPosition } from "@/lib/org-chart/draft";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { getOrgMembersForPicker } from "@/server/members";
import { loadVersion, MEMBERS_DRAFT_MODEL } from "@/server/org-chart/service";

/** Which quick screen a draft belongs to. */
export type QuickScreen = "review" | "seats";

/**
 * What the quick setup screens need: an editable draft, its positions and
 * the members. Each screen only takes the drafts made for it: review the
 * ones "Draft my chart" made (MANUAL, parseModel MEMBERS_DRAFT_MODEL),
 * seats the ones started from a shape (TEMPLATE). Anything else (a blank
 * draft, an import, a copy of the chart, a published version, a document
 * still being read) goes to the full editor, which explains it.
 */
export async function loadQuickDraft(orgSlug: string, versionId: string, screen: QuickScreen) {
  const { organization, role } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "orgchart.write")) notFound();
  const detail = await withOrgTx(organization.id, (ctx) => loadVersion(ctx, versionId));
  if (!detail) notFound();
  const { version } = detail;
  const madeForScreen =
    screen === "seats"
      ? version.parseMethod === "TEMPLATE"
      : version.parseMethod === "MANUAL" && version.parseModel === MEMBERS_DRAFT_MODEL;
  if (
    version.status !== "DRAFT" ||
    (version.parseStatus && version.parseStatus !== "READY") ||
    !madeForScreen
  ) {
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
