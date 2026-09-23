import { ChartColumn } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { getOrgContextBySlug } from "@/server/db/context";

/** Stub for the Reports section (Phase 5). The Reports builder replaces this page. */
export default async function ReportsPage({ params }: PageProps<"/app/[orgSlug]/reports">) {
  const { orgSlug } = await params;
  const { organization } = await getOrgContextBySlug(orgSlug);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
      <EmptyState
        icon={ChartColumn}
        title="Reports are on their way"
        description={`Attendance, retention, signups and ballot results for ${organization.name} will be summarized here.`}
      />
    </div>
  );
}
