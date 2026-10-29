import { BackLink } from "@/components/back-link";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DraftEditor } from "@/components/org-chart/editor/draft-editor";
import { ParseReportPanel } from "@/components/org-chart/editor/parse-report";
import { ParseStatus } from "@/components/org-chart/editor/parse-status";
import { EmptyState } from "@/components/empty-state";
import { can } from "@/lib/auth/permissions";
import type { DraftPosition } from "@/lib/org-chart/draft";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { getOrgMembersForPicker } from "@/server/members";
import { loadVersion } from "@/server/org-chart/service";
import { planGate } from "@/server/billing/plan-gate";

export const metadata: Metadata = { title: "Edit org chart draft" };

/** The draft editor (any member: orgchart.write). */
export default async function DraftPage({
  params,
}: PageProps<"/app/[orgSlug]/org-chart/drafts/[versionId]">) {
  const { orgSlug, versionId } = await params;
  const planLock = await planGate(orgSlug, "people");
  if (planLock) return planLock;
  const { organization, role } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "orgchart.write")) notFound();

  const detail = await withOrgTx(organization.id, (ctx) => loadVersion(ctx, versionId));
  if (!detail) notFound();
  const { version } = detail;
  const base = `/app/${orgSlug}/org-chart`;
  const sourceHref = version.sourceBlobKey
    ? `/api/orgs/${organization.id}/org-chart/imports/${version.id}/source`
    : null;

  const header = (
    <div className="space-y-3">
      <BackLink href={base} label="Org chart" />
      <h1 className="page-title">Draft v{version.number}</h1>
      <p className="text-muted-foreground text-[15px]">
        {version.source === "UPLOAD" && version.sourceFilename ? (
          <>
            Imported from{" "}
            {sourceHref ? (
              <a href={sourceHref} className="underline underline-offset-4">
                {version.sourceFilename}
              </a>
            ) : (
              version.sourceFilename
            )}
            . Check every position before publishing.
          </>
        ) : (
          "Type the chart or edit positions. Drafts save as you go; publish when it's right."
        )}
      </p>
    </div>
  );

  if (version.status !== "DRAFT") {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          title={`Version ${version.number} is ${version.status.toLowerCase()}`}
          description="Only drafts can be edited. Start a new draft from the published chart, or restore this version from the history."
          action={
            <Link
              href={`${base}/versions/${version.id}`}
              className="text-primary text-sm underline underline-offset-4"
            >
              View this version
            </Link>
          }
        />
      </div>
    );
  }

  if (version.parseStatus && version.parseStatus !== "READY") {
    return (
      <div className="space-y-6">
        {header}
        <ParseStatus
          orgId={organization.id}
          orgSlug={orgSlug}
          versionId={version.id}
          parseStatus={version.parseStatus}
          parseError={version.parseError}
          filename={version.sourceFilename}
          sourceHref={sourceHref}
        />
      </div>
    );
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

  return (
    <div className="space-y-4">
      {header}
      <ParseReportPanel
        method={version.parseMethod}
        report={version.parseReport}
        model={version.parseModel}
        costUsd={version.parseCostUsd}
        confidence={version.parseConfidence}
      />
      <Suspense>
        <DraftEditor
          key={version.editVersion}
          orgId={organization.id}
          orgSlug={orgSlug}
          version={{
            id: version.id,
            number: version.number,
            source: version.source,
            sourceFilename: version.sourceFilename,
            editVersion: version.editVersion,
            warnings: version.warnings,
            openItems: version.openItems,
            teams: version.teams,
          }}
          positions={positions}
          canInvite={can({ role }, "members.invite")}
          canSetTitles={can({ role }, "members.setTitle")}
          members={members.map((m) => ({
            id: m.id,
            name: m.name,
            image: m.image,
            avatar: m.avatar,
            title: m.title,
          }))}
        />
      </Suspense>
    </div>
  );
}
