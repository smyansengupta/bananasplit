import { notFound } from "next/navigation";

import { ReportWizard } from "@/components/reports/saved/report-wizard";
import { can } from "@/lib/auth/permissions";
import { planGate } from "@/server/billing/plan-gate";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { reportViewer } from "@/server/reports/run";
import { listSources } from "@/server/reports/sources";
import { reportTier } from "@/server/reports/tier";

export const metadata = { title: "New report" };

/** New report: the walkthrough, titled with the name being typed (?source= starts on its widgets). */
export default async function NewReportPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/databases/reports/new">) {
  const { orgSlug } = await params;
  const planLock = await planGate(orgSlug, "reports");
  if (planLock) return planLock;
  const sp = await searchParams;
  const { organization, role, user } = await getOrgContextBySlug(orgSlug);
  if (!reportTier(role) || !can({ role }, "reports.view")) notFound();
  const sources = await withOrgTx(organization.id, async (ctx) =>
    listSources(
      await reportViewer({ db: ctx.db, organizationId: organization.id, userId: user.id, role }),
    ),
  );
  const initial = typeof sp.source === "string" ? sp.source : null;
  return (
    <div className="space-y-7.5">
      <ReportWizard
        orgId={organization.id}
        orgSlug={orgSlug}
        sources={sources}
        isAdmin={can({ role }, "databases.write")}
        initialSource={initial}
      />
    </div>
  );
}
