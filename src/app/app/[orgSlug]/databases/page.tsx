import { Database } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { getOrgContextBySlug } from "@/server/db/context";

/**
 * Stub for the Databases section (Phases 4a and 4b). The Databases builder
 * replaces this page. View URLs follow the grammar in
 * src/lib/databases/href.ts (dbViewHref).
 */
export default async function DatabasesPage({ params }: PageProps<"/app/[orgSlug]/databases">) {
  const { orgSlug } = await params;
  const { organization } = await getOrgContextBySlug(orgSlug);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Databases</h1>
      <EmptyState
        icon={Database}
        title="Databases are on their way"
        description={`Sessions, attendance, signups and ballots for ${organization.name} will be browsable here.`}
      />
    </div>
  );
}
