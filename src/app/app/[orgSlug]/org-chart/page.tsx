import { Network } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { getOrgContextBySlug } from "@/server/db/context";

/**
 * Stub for the Org Chart section (Phase 3). The Org Chart builder replaces
 * this page; getPublishedOrgChart / getReportingSubtree already live in
 * src/server/org-chart/queries.ts.
 */
export default async function OrgChartPage({ params }: PageProps<"/app/[orgSlug]/org-chart">) {
  const { orgSlug } = await params;
  const { organization } = await getOrgContextBySlug(orgSlug);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Org Chart</h1>
      <EmptyState
        icon={Network}
        title="The org chart is on its way"
        description={`${organization.name}'s reporting lines, roles and responsibilities will appear here once the chart is published.`}
      />
    </div>
  );
}
