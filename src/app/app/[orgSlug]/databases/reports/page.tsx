import { Suspense, type ReactNode } from "react";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { RangePicker } from "@/components/reports/range-picker";
import { ReportSkeleton } from "@/components/reports/report-skeleton";
import { ReportsBody, ReportsFrame } from "@/components/reports/reports-frame";
import { BallotsSection } from "@/components/reports/sections/ballots-section";
import { RetentionSection, SignupsSection, StampsSection } from "@/components/reports/sections/people-sections";
import {
  AttendanceSection,
  LastSessionSection,
  SessionTypesSection,
} from "@/components/reports/sections/session-sections";
import type { ReportViewContext } from "@/components/reports/sections/shared";
import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug } from "@/server/db/context";
import { clampRefreshSeconds } from "@/server/reports/cache";
import { resolveReportRange } from "@/server/reports/range";
import { reportTier } from "@/server/reports/tier";
import type { ReportId } from "@/server/reports/types";
import { getVisibleReports } from "@/server/reports/visibility";

import { AutoRefresh, RefreshButton } from "./refresh-controls";

export const metadata = { title: "Reports" };

interface Slot {
  render: (ctx: ReportViewContext) => ReactNode;
  skeleton: ReactNode;
  className: string;
}

/** Page order and grid placement of the seven default reports. */
const SLOTS: Record<ReportId, Slot> = {
  "last-session": {
    render: (ctx) => <LastSessionSection ctx={ctx} />,
    skeleton: <ReportSkeleton title="Last session" bodyHeight={160} />,
    className: "lg:col-span-1",
  },
  attendance: {
    render: (ctx) => <AttendanceSection ctx={ctx} />,
    skeleton: <ReportSkeleton title="Attendance over time" stats={4} />,
    className: "lg:col-span-2",
  },
  retention: {
    render: (ctx) => <RetentionSection ctx={ctx} />,
    skeleton: <ReportSkeleton title="Retention" stats={5} bodyHeight={266} />,
    className: "lg:col-span-2",
  },
  "session-types": {
    render: (ctx) => <SessionTypesSection ctx={ctx} />,
    skeleton: <ReportSkeleton title="Session breakdown" bodyHeight={200} />,
    className: "lg:col-span-1",
  },
  signups: {
    render: (ctx) => <SignupsSection ctx={ctx} />,
    skeleton: <ReportSkeleton title="Signups" stats={3} bodyHeight={266} />,
    className: "lg:col-span-2",
  },
  stamps: {
    render: (ctx) => <StampsSection ctx={ctx} />,
    skeleton: <ReportSkeleton title="Stamp-card progress" bodyHeight={180} />,
    className: "lg:col-span-1",
  },
  ballots: {
    render: (ctx) => <BallotsSection ctx={ctx} />,
    skeleton: <ReportSkeleton title="Ballots" bodyHeight={280} />,
    className: "lg:col-span-3",
  },
};

const ORDER: ReportId[] = ["last-session", "attendance", "retention", "session-types", "signups", "stamps", "ballots"];

/**
 * Reports (Phase 5). Authorize, derive the tier, resolve the date range to
 * explicit org-local dates, decide which reports this tier may see, then
 * stream each report in its own Suspense boundary. Every number comes from
 * the cached aggregate loaders in src/server/reports; nothing here fetches
 * rows.
 */
export default async function ReportsPage({ params, searchParams }: PageProps<"/app/[orgSlug]/databases/reports">) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const { organization, role, settings } = await getOrgContextBySlug(orgSlug);
  const tier = reportTier(role);
  if (!tier || !can({ role }, "reports.view")) notFound();

  const tz = organization.timezone || "UTC";
  const range = resolveReportRange(sp, tz);
  const visible = new Set(await getVisibleReports(organization.id, tier));
  const refreshSeconds = clampRefreshSeconds(settings?.reportsRefreshSeconds);

  const ctx: ReportViewContext = {
    key: {
      orgId: organization.id,
      tier,
      from: range.from,
      to: range.to,
      tz,
      dataVersion: settings?.reportsDataVersion ?? 0,
      settingsStamp: settings?.updatedAt ? new Date(settings.updatedAt).toISOString() : "",
    },
    refreshSeconds,
    slug: organization.slug,
    tz,
    link: { from: range.from, to: range.to, term: range.term },
    rangeLabel: range.label,
  };
  // Stamp cards are opt-in: an org with no milestones has no stamps to report.
  const usesStamps = (settings?.stampMilestones?.length ?? 0) > 0;
  const ids = ORDER.filter((id) => visible.has(id) && (id !== "stamps" || usesStamps));

  return (
    <ReportsFrame>
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="page-title">Reports</h1>
          <p className="text-muted-foreground text-sm">
            Attendance, retention, signups and ballot results for {organization.name}. Times are in {tz}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <RangePicker
            preset={range.preset}
            from={range.from}
            to={range.to}
            label={range.label}
            span={range.span}
          />
          <RefreshButton organizationId={organization.id} />
          <AutoRefresh seconds={refreshSeconds} />
        </div>

        {ids.length === 0 ? (
          <EmptyState
            title="No reports to show"
            description="The databases these reports read are not visible to your role in this organization."
          />
        ) : (
          <ReportsBody className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {ids.map((id) => (
              <div key={id} className={`min-w-0 ${SLOTS[id].className} flex flex-col`}>
                <Suspense fallback={SLOTS[id].skeleton}>{SLOTS[id].render(ctx)}</Suspense>
              </div>
            ))}
          </ReportsBody>
        )}
      </div>
    </ReportsFrame>
  );
}
