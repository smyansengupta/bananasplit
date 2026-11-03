import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/page-header";
import { RefreshCopy } from "@/components/reports/saved/refresh-copy";
import { StaticBoard } from "@/components/reports/saved/report-controls";
import { WidgetBody } from "@/components/reports/saved/widget-bodies";
import { Button } from "@/components/ui/button";
import { copyIsStale } from "@/lib/ambient/reports";
import { can } from "@/lib/auth/permissions";
import { WIDGETS } from "@/lib/reports/catalog";
import { planGate } from "@/server/billing/plan-gate";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { reportDataChangedAt } from "@/server/reports/ambient";
import { getReport, getSnapshot } from "@/server/reports/saved";
import { reportTier } from "@/server/reports/tier";

export const metadata = { title: "Past report" };

/** A kept copy of a report: its widgets as they read then, frozen. */
export default async function PastReportPage({
  params,
}: PageProps<"/app/[orgSlug]/databases/reports/[reportId]/past/[snapshotId]">) {
  const { orgSlug, reportId, snapshotId } = await params;
  const planLock = await planGate(orgSlug, "reports");
  if (planLock) return planLock;
  const { organization, role } = await getOrgContextBySlug(orgSlug);
  if (!reportTier(role) || !can({ role }, "reports.view")) notFound();
  const found = await withOrgTx(organization.id, async ({ db }) => {
    const snap = await getSnapshot(db, organization.id, reportId, snapshotId).catch(() => null);
    if (!snap) return null;
    const report = await getReport(db, organization.id, reportId).catch(() => null);
    // The report's data changed after this copy: Refresh keeps a new one.
    const stale = report
      ? copyIsStale(snap.takenAt, await reportDataChangedAt(db, organization.id, report))
      : null;
    return { snap, stale };
  });
  if (!found) notFound();
  const { snap, stale } = found;
  const widgets = (snap.data.widgets ?? []).filter((w) => w.type in WIDGETS);
  const bodies: Record<string, ReactNode> = {};
  for (const w of widgets) {
    bodies[w.id] = w.payload ? (
      <WidgetBody payload={w.payload} />
    ) : (
      <p className="text-muted-foreground text-sm">
        Copies don&apos;t keep this widget. Open the report to see it now.
      </p>
    );
  }
  const taken = new Date(snap.takenAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return (
    <div className="space-y-7.5">
      <PageHeader
        title={snap.data.title}
        description={`As it read on ${taken}${snap.takenByName ? `, kept by ${snap.takenByName}` : ""}. ${snap.data.sourceName}, ${snap.rangeLabel.replace(/^(This|Last|All) /, (w) => w.toLowerCase())}`}
        actions={
          <>
            {stale && (
              <RefreshCopy
                orgId={organization.id}
                orgSlug={orgSlug}
                reportId={reportId}
                rangeLabel={snap.rangeLabel}
                reason={stale.reason}
              />
            )}
            <Button asChild variant="outline">
              <Link href={`/app/${orgSlug}/databases/reports/${reportId}`}>
                Open the report now
              </Link>
            </Button>
          </>
        }
      />
      <StaticBoard
        types={[...new Set(widgets.map((w) => w.type))].map((t) => ({
          type: t,
          title: WIDGETS[t].title,
          description: WIDGETS[t].description,
          group: "Widgets",
          icon: WIDGETS[t].icon,
          w: WIDGETS[t].w,
          h: WIDGETS[t].h,
        }))}
        layout={widgets.map(({ id, type, w, h }) => ({ id, type, w, h }))}
        titles={Object.fromEntries(widgets.map((w) => [w.id, w.title]))}
        bodies={bodies}
      />
    </div>
  );
}
