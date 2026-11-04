import { notFound, redirect } from "next/navigation";

import { OpenReadyReport } from "@/components/reports/saved/open-ready-report";
import { can } from "@/lib/auth/permissions";
import { parseReportPath } from "@/lib/crm/crm-reports";
import { CRM_DB_KEYS } from "@/lib/crm/templates";
import { defaultDealPipeline } from "@/server/crm/deals-tab";
import { withOrgTx } from "@/server/db/context";
import { readyReportId } from "@/server/reports/ready";
import { reportViewer } from "@/server/reports/run";
import { reportTier } from "@/server/reports/tier";

import { crmShell } from "../../shell";

export const metadata = { title: "CRM reports" };

/**
 * The CRM's reports live in Databases > Reports now: Deals on each
 * pipeline, People and Outreach on People (src/lib/reports/crm-ready.ts).
 * The CRM's Report buttons and old links (/crm/reports,
 * /crm/reports/deals/<pipeline>, /crm/reports/people,
 * /crm/reports/outreach) land here and go on to that report, with their
 * dates; the first time, the report is made for the organization.
 */
export default async function CrmReportsPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/crm/reports/[[...on]]">) {
  const { orgSlug, on: segments } = await params;
  const sp = (await searchParams) as Record<string, string | string[] | undefined>;
  if (segments && segments.length > 0 && !["deals", "people", "outreach"].includes(segments[0]!)) notFound();
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  const reports = `/app/${orgSlug}/databases/reports`;
  if (!reportTier(shell.role) || !can({ role: shell.role }, "reports.view")) redirect(`/app/${orgSlug}/crm`);
  const { on, pipelineId } = parseReportPath(segments);
  const orgId = shell.org.id;

  const found = await withOrgTx(orgId, async (ctx) => {
    let sourceKey: string | null = null;
    if (on === "deals") {
      const pipeline = shell.pipelines.find((p) => p.id === pipelineId) ?? defaultDealPipeline(shell.pipelines);
      sourceKey = pipeline?.databaseId ? `custom:${pipeline.databaseId}` : null;
    } else {
      const people = await ctx.db.databaseDefinition.findFirst({
        where: { organizationId: orgId, key: CRM_DB_KEYS.people },
        select: { id: true },
      });
      sourceKey = people ? `custom:${people.id}` : null;
    }
    if (!sourceKey) return null;
    const v = await reportViewer({ db: ctx.db, organizationId: orgId, userId: shell.user.id, role: shell.role });
    return { sourceKey, id: await readyReportId(v, on, sourceKey, { make: false }) };
  });
  if (!found) redirect(reports);

  // The dates carry over.
  const keep = new URLSearchParams();
  for (const k of ["range", "from", "to"]) {
    const value = sp[k];
    if (typeof value === "string") keep.set(k, value);
  }
  const query = keep.size ? `?${keep.toString()}` : "";
  if (found.id) redirect(`${reports}/${found.id}${query}`);
  return <OpenReadyReport orgId={orgId} orgSlug={orgSlug} kind={on} sourceKey={found.sourceKey} query={query} />;
}
