import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PublishReview } from "@/components/org-chart/publish-review";
import { can } from "@/lib/auth/permissions";
import { diffCharts, type DiffPosition } from "@/lib/org-chart/diff";
import { describeChanges, titleChanges } from "@/lib/org-chart/publish";
import { personLabel } from "@/lib/org-chart/types";
import { validateChart } from "@/lib/org-chart/validate";
import { planGate } from "@/server/billing/plan-gate";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { getOrgMembersForPicker } from "@/server/members";
import { loadVersion, type VersionDetail } from "@/server/org-chart/service";

export const metadata: Metadata = { title: "Publish the org chart" };

function toDiff(detail: VersionDetail): DiffPosition[] {
  const byId = new Map(detail.positions.map((p) => [p.id, p]));
  return detail.positions.map((p) => ({
    key: p.key,
    title: p.title,
    reportsToKey: p.reportsToId ? (byId.get(p.reportsToId)?.key ?? null) : null,
    alsoReportsToKeys: p.alsoReportsToIds.flatMap((id) => byId.get(id)?.key ?? []),
    userId: p.userId,
    personLabel: personLabel(p),
    personName: p.isOpen ? null : (p.user?.name ?? p.personName),
    isOpen: p.isOpen,
    isAdvisor: p.isAdvisor,
    responsibilities: p.responsibilities,
    decidesAlone: p.decidesAlone,
  }));
}

/**
 * Review before publishing: what changes from the chart everyone sees now,
 * whose titles change with it, anything left to fix, and Publish.
 */
export default async function PublishDraftPage({
  params,
}: {
  params: Promise<{ orgSlug: string; versionId: string }>;
}) {
  const { orgSlug, versionId } = await params;
  const planLock = await planGate(orgSlug, "people");
  if (planLock) return planLock;
  const { organization, role } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "orgchart.write")) notFound();
  const draftHref = `/app/${orgSlug}/org-chart/drafts/${versionId}`;

  const { draft, live } = await withOrgTx(organization.id, async (ctx) => {
    const draft = await loadVersion(ctx, versionId);
    const published = await ctx.db.orgChartVersion.findFirst({
      where: { organizationId: organization.id, status: "PUBLISHED" },
      select: { id: true },
    });
    const live = published ? await loadVersion(ctx, published.id) : null;
    return { draft, live };
  });
  if (!draft) notFound();
  if (
    draft.version.status !== "DRAFT" ||
    (draft.version.parseStatus && draft.version.parseStatus !== "READY")
  ) {
    redirect(draftHref);
  }

  const members = await getOrgMembersForPicker(organization.id);
  const canSetTitles = can({ role }, "members.setTitle");
  const rows = draft.positions;
  const titled = canSetTitles ? titleChanges(rows, members) : [];
  const after = toDiff(draft);
  const lines = describeChanges(diffCharts(live ? toDiff(live) : [], after), after, titled);
  const issues = validateChart(
    rows.map((r) => ({
      id: r.id,
      key: r.key,
      title: r.title,
      reportsTo: r.reportsToId,
      alsoReportsTo: r.alsoReportsToIds,
      isAdvisor: r.isAdvisor,
      isOpen: r.isOpen,
      userId: r.userId,
      personName: r.personName,
      matchState: r.matchState,
    })),
    { memberIds: new Set(members.map((m) => m.id)) },
  );
  const keyOf = new Map(rows.map((r) => [r.id, r.key]));

  return (
    <PublishReview
      orgId={organization.id}
      orgSlug={orgSlug}
      draft={{ id: draft.version.id, editVersion: draft.version.editVersion }}
      draftHref={draftHref}
      liveVersionId={live?.version.id ?? null}
      firstChart={!live}
      positionCount={rows.length}
      lines={lines}
      titled={titled}
      issues={issues.map((i) => ({
        level: i.level,
        message: i.message,
        positionKey: i.positionId ? (keyOf.get(i.positionId) ?? null) : null,
      }))}
      members={members.map((m) => ({ id: m.id, name: m.name, image: m.image, avatar: m.avatar }))}
      canSetTitles={canSetTitles}
    />
  );
}
