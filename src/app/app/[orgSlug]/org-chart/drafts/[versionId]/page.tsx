import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DraftEditor } from "@/components/org-chart/editor/draft-editor";
import { ParseStatus } from "@/components/org-chart/editor/parse-status";
import { EmptyState } from "@/components/empty-state";
import { can } from "@/lib/auth/permissions";
import type { DraftPosition } from "@/lib/org-chart/draft";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { getOrgMembersForPicker } from "@/server/members";
import { loadVersion } from "@/server/org-chart/service";

export const metadata: Metadata = { title: "Edit org chart draft" };

/** The draft editor (OWNER/ADMIN). Members get a 404: drafts are invisible to them under RLS too. */
export default async function DraftPage({
  params,
}: PageProps<"/app/[orgSlug]/org-chart/drafts/[versionId]">) {
  const { orgSlug, versionId } = await params;
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
    <div className="space-y-1">
      <Link
        href={base}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Org Chart
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Review draft v{version.number}</h1>
      <p className="text-muted-foreground text-sm">
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
            {version.parseModel ? ` by ${version.parseModel}` : ""}. Check every position before
            publishing.
          </>
        ) : (
          "Edit the positions, then publish when the chart is right."
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
    isOpen: p.isOpen,
    isAdvisor: p.isAdvisor,
    responsibilities: p.responsibilities,
    decidesAlone: p.decidesAlone,
    sourceQuote: p.sourceQuote,
    rank: p.rank,
  }));

  return (
    <div className="space-y-4">
      {header}
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
          }}
          positions={positions}
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
