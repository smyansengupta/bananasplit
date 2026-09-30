import { can } from "@/lib/auth/permissions";
import { reportTier } from "@/server/reports/tier";
import { getOrgContextBySlug } from "@/server/db/context";

import { DatabasesTabs } from "./databases-tabs";

/** Databases and its Reports tab share the ribbon at the top. */
export default async function DatabasesLayout({
  params,
  children,
}: LayoutProps<"/app/[orgSlug]/databases">) {
  const { orgSlug } = await params;
  const { role } = await getOrgContextBySlug(orgSlug);
  const showReports = Boolean(reportTier(role)) && can({ role }, "reports.view");
  return (
    <div className="space-y-6">
      <DatabasesTabs orgSlug={orgSlug} showReports={showReports} />
      {children}
    </div>
  );
}
