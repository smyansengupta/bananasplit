import { ChartNoAxesColumn, History } from "@/components/icons";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { AmbientActions } from "@/components/ambient/ambient-button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RangePicker } from "@/components/reports/range-picker";
import { ReportSkeleton } from "@/components/reports/report-skeleton";
import { ReportsBody, ReportsFrame } from "@/components/reports/reports-frame";
import { RetentionSection } from "@/components/reports/sections/people-sections";
import { AttendanceSection } from "@/components/reports/sections/session-sections";
import { loadReport, type ReportViewContext } from "@/components/reports/sections/shared";
import {
  AskClaudeButton,
  ReportHeaderControls,
  WidgetSettingsButton,
} from "@/components/reports/saved/report-controls";
import { AskReports } from "@/components/reports/saved/ask-reports";
import { ReportBoard } from "@/components/reports/saved/report-board";
import { WidgetBody } from "@/components/reports/saved/widget-bodies";
import { copyIsStale, failedSend } from "@/lib/ambient/reports";
import { can } from "@/lib/auth/permissions";
import { boardTypes } from "@/lib/reports/catalog";
import { spanPhrase } from "@/lib/reports/compute";
import { JOINED } from "@/lib/reports/join";
import { describeSchedule } from "@/lib/reports/schedule";
import { listAiConnections } from "@/server/ai/connections";
import { planGate } from "@/server/billing/plan-gate";
import { refineTopIssues } from "@/server/crm/issue-groups";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { reportDataChangedAt, reportSendJobs } from "@/server/reports/ambient";
import { clampRefreshSeconds } from "@/server/reports/cache";
import { builtInInsights, reportViewer, runReport } from "@/server/reports/run";
import { canEditReport, getReport, listSnapshots } from "@/server/reports/saved";
import { MAX_REPORT_ROWS } from "@/server/reports/sources";
import { reportTier } from "@/server/reports/tier";
import { getVisibleReports } from "@/server/reports/visibility";

import { DatabasesTabs } from "../../databases-tabs";
import { PeopleSummarySection, RsvpAttendanceSection } from "../organization-sections";
import { refreshCopyAction, sendReportAgainAction } from "../report-actions";

export const metadata = { title: "Report" };

const BUILT_IN = new Set(["people", "attendance", "rsvps", "retention"]);

/**
 * One saved report: its widgets on a board, computed over the range the
 * date pills pick, from the rows this viewer can see. Whoever made it (or an
 * owner/admin, on a shared one) arranges it as Home is arranged and changes
 * each widget's settings from its gear; everyone can keep a copy as it
 * reads now (Report history).
 */
export default async function SavedReportPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/databases/reports/[reportId]">) {
  const { orgSlug, reportId } = await params;
  const planLock = await planGate(orgSlug, "reports");
  if (planLock) return planLock;
  const sp = await searchParams;
  const { organization, role, user, settings } = await getOrgContextBySlug(orgSlug);
  const tier = reportTier(role);
  if (!tier || !can({ role }, "reports.view")) notFound();
  const isAdmin = can({ role }, "databases.write");

  const loaded = await withOrgTx(organization.id, async (ctx) => {
    const v = await reportViewer({
      db: ctx.db,
      organizationId: organization.id,
      userId: user.id,
      role,
    });
    const report = await getReport(ctx.db, organization.id, reportId).catch(() => null);
    if (!report) return null;
    const snapshots = await listSnapshots(ctx.db, organization.id, report.id);
    return {
      report,
      tz: v.tz,
      run: await runReport(v, report, sp),
      snapshots,
      // Its ambient buttons (src/lib/ambient/reports.ts): the newest copy is
      // behind the data; the last scheduled send gave up (admins read jobs).
      stale: snapshots[0]
        ? copyIsStale(
            snapshots[0].takenAt,
            await reportDataChangedAt(ctx.db, organization.id, report),
          )
        : null,
      failed:
        isAdmin && report.schedule
          ? failedSend(await reportSendJobs(ctx.db, organization.id, report.id), report.id)
          : null,
    };
  });
  if (!loaded) notFound();
  const { report, run, snapshots, tz, stale, failed } = loaded;
  // Top issues grouped by meaning with the organization's AI, outside the transaction.
  await refineTopIssues(organization.id, orgSlug, user.id, run.computed);
  const { source, range, computed } = run;
  const canEdit = canEditReport(report, user.id, role);
  const joinedName = report.joinWith
    ? source?.fields.find((f) => f.id.startsWith(JOINED))?.name.match(/\(([^)]+)\)$/)?.[1]
    : null;
  const base = `/app/${orgSlug}/databases/reports`;

  const header = (
    <PageHeader
      title={report.title}
      description={source?.name ?? "A database you can't see"}
      actions={
        <>
          {failed && (
            <AmbientActions
              why
              actions={[
                {
                  key: "send-again",
                  label: "Send again",
                  reason: failed.reason,
                  tone: "spark",
                  run: sendReportAgainAction.bind(null, organization.id, report.id),
                  done: "Sending it again",
                },
              ]}
            />
          )}
          <ReportHeaderControls
            orgId={organization.id}
            orgSlug={orgSlug}
            reportId={report.id}
            title={report.title}
            access={report.access}
            canEdit={canEdit}
            isOwner={report.createdById === user.id}
            schedule={report.schedule}
            linkOn={report.linkOn}
          />
        </>
      }
      tabs={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <DatabasesTabs orgSlug={orgSlug} showReports />
          <RangePicker
            preset={range.preset}
            from={range.from}
            to={range.to}
            label={range.label}
            span={range.span}
          />
        </div>
      }
    />
  );

  if (!source) {
    return (
      <ReportsFrame>
        <div className="space-y-7.5">
          {header}
          <EmptyState
            icon={ChartNoAxesColumn}
            title="You can't see this report's database"
            description="It reads a database your role can't open, or one that was archived."
          />
        </div>
      </ReportsFrame>
    );
  }

  // The People and Events widgets are the built-in report cards.
  const visible = new Set(await getVisibleReports(organization.id, tier));
  const viewCtx: ReportViewContext = {
    key: {
      orgId: organization.id,
      tier,
      from: range.from,
      to: range.to,
      tz,
      dataVersion: settings?.reportsDataVersion ?? 0,
      settingsStamp: settings?.updatedAt ? new Date(settings.updatedAt).toISOString() : "",
    },
    refreshSeconds: clampRefreshSeconds(settings?.reportsRefreshSeconds),
    slug: organization.slug,
    tz,
    link: { from: range.from, to: range.to, term: range.term },
    rangeLabel: range.label,
  };
  const aiReady = canEdit && (await listAiConnections(organization.id)).length > 0;

  // An Events report's Insights reads the attendance cards it shows.
  const insights = computed.find((c) => c.payload?.type === "insights");
  const attendanceId = computed.find((c) => c.widget.type === "attendance")?.widget.id;
  const retentionId = computed.find((c) => c.widget.type === "retention")?.widget.id;
  if (
    insights?.payload?.type === "insights" &&
    !insights.payload.data.byClaude &&
    (attendanceId || retentionId)
  ) {
    const [attendance, retention] = await Promise.all([
      attendanceId && visible.has("attendance") ? loadReport("attendance", viewCtx) : null,
      retentionId && visible.has("retention") ? loadReport("retention", viewCtx) : null,
    ]);
    insights.payload.data.lines = [
      ...builtInInsights(
        attendance?.data ?? null,
        retention?.data ?? null,
        {
          attendance: attendanceId,
          retention: retentionId,
        },
        spanPhrase(range),
      ),
      ...insights.payload.data.lines,
    ].slice(0, 5);
  }

  const bodies: Record<string, ReactNode> = {};
  const titles: Record<string, string> = {};
  const actions: Record<string, ReactNode> = {};
  for (const c of computed) {
    const id = c.widget.id;
    titles[id] = c.title;
    if (canEdit && c.widget.type !== "insights" && !BUILT_IN.has(c.widget.type)) {
      actions[id] = (
        <WidgetSettingsButton
          orgId={organization.id}
          reportId={report.id}
          widget={c.widget}
          source={source}
          title={c.title}
        />
      );
    }
    if (c.payload) {
      bodies[id] = (
        <WidgetBody
          payload={c.payload}
          taskActions={{ orgId: organization.id, viewerId: user.id }}
          insights={
            c.payload.type === "insights"
              ? {
                  on: source.name,
                  rewrite: aiReady ? (
                    <AskClaudeButton
                      orgId={organization.id}
                      reportId={report.id}
                      again={c.payload.data.byClaude}
                    />
                  ) : undefined,
                  // Anyone who can open the report can ask about it.
                  ask: <AskReports orgId={organization.id} reportId={report.id} />,
                }
              : undefined
          }
        />
      );
      continue;
    }
    switch (c.widget.type) {
      case "people":
        bodies[id] = (
          <Suspense fallback={<ReportSkeleton title="People" stats={3} bodyHeight={120} />}>
            <PeopleSummarySection orgId={organization.id} slug={orgSlug} tz={tz} />
          </Suspense>
        );
        break;
      case "attendance":
        bodies[id] = visible.has("attendance") ? (
          <Suspense fallback={<ReportSkeleton title="Attendance over time" stats={4} />}>
            <AttendanceSection ctx={viewCtx} />
          </Suspense>
        ) : null;
        break;
      case "rsvps":
        bodies[id] = visible.has("attendance") ? (
          <Suspense
            fallback={<ReportSkeleton title="RSVPs and check-ins" stats={3} bodyHeight={180} />}
          >
            <RsvpAttendanceSection
              orgId={organization.id}
              slug={orgSlug}
              tz={tz}
              from={range.from}
              to={range.to}
              rangeLabel={range.label}
              isAdmin={isAdmin}
              showReturns={visible.has("retention")}
            />
          </Suspense>
        ) : null;
        break;
      case "retention":
        bodies[id] = visible.has("retention") ? (
          <Suspense fallback={<ReportSkeleton title="Retention" stats={5} bodyHeight={266} />}>
            <RetentionSection ctx={viewCtx} />
          </Suspense>
        ) : null;
        break;
      default:
        break;
    }
  }

  return (
    <ReportsFrame>
      <div className="space-y-7.5">
        {header}
        <ReportsBody>
          <ReportBoard
            orgId={organization.id}
            reportId={report.id}
            types={boardTypes(source, isAdmin)}
            initialLayout={report.widgets.map(({ id, type, w, h }) => ({ id, type, w, h }))}
            customized
            titles={titles}
            bodies={bodies}
            headerActions={actions}
            readOnly={!canEdit}
            editHint={
              report.access === "PRIVATE"
                ? "Only you see this report."
                : "Everyone who opens this report sees your changes."
            }
            resetLabel="Back to the suggested widgets"
            noun="this report"
            fillGaps
            intro={
              <p className="text-muted-foreground text-sm">
                {computed.length} widget{computed.length === 1 ? "" : "s"} on{" "}
                <Link href={source.href} className="text-foreground font-semibold hover:underline">
                  {source.name}
                </Link>
                {source.truncated
                  ? `, reading the newest ${MAX_REPORT_ROWS.toLocaleString("en-US")} rows`
                  : ""}
                {report.joinWith && joinedName ? `, joined with ${joinedName}` : ""}
                {report.access === "PRIVATE" ? ". Only you can open it" : ""}
                {report.linkOn ? ". Anyone with its link can view it" : ""}
                {report.schedule
                  ? `. ${describeSchedule(
                      report.schedule,
                      report.createdById === user.id
                        ? null
                        : (report.createdByName?.split(/\s+/)[0] ?? "whoever set it"),
                    )}`
                  : ""}
                .
              </p>
            }
          />
        </ReportsBody>

        {snapshots.length > 0 && (
          <section aria-labelledby="copies" className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2 id="copies" className="heading text-[17px]">
                Saved copies
              </h2>
              {stale && (
                <AmbientActions
                  why
                  actions={[
                    {
                      key: "refresh",
                      label: "Refresh",
                      reason: stale.reason,
                      // A new copy over the same dates as the newest one.
                      run: refreshCopyAction.bind(
                        null,
                        organization.id,
                        report.id,
                        snapshots[0].rangeLabel,
                      ),
                      done: "Kept a fresh copy",
                    },
                  ]}
                />
              )}
            </div>
            <ul className="flex flex-wrap gap-2">
              {snapshots.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`${base}/${report.id}/past/${s.id}`}
                    className="bg-muted/60 hover:bg-muted focus-glow flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm outline-none"
                  >
                    <History className="text-muted-foreground size-3.5" aria-hidden="true" />
                    {new Date(s.takenAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                    <span className="text-muted-foreground">{s.rangeLabel}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </ReportsFrame>
  );
}
