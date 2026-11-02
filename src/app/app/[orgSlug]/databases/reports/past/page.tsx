import { History } from "@/components/icons";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";
import { planGate } from "@/server/billing/plan-gate";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { listSnapshots } from "@/server/reports/saved";
import { reportTier } from "@/server/reports/tier";

import { DatabasesTabs } from "../../databases-tabs";

export const metadata = { title: "Report history" };

function monthOf(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Report history: the copies kept of reports, each frozen as it read on
 * the day it was kept (Keep a copy, or a send on its schedule). The reports
 * themselves are live and live on Reports home; this is only their past.
 * Newest first, by month, and narrowed to one report with its chip.
 */
export default async function ReportHistoryPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/databases/reports/past">) {
  const { orgSlug } = await params;
  const planLock = await planGate(orgSlug, "reports");
  if (planLock) return planLock;
  const sp = await searchParams;
  const { organization, role } = await getOrgContextBySlug(orgSlug);
  if (!reportTier(role) || !can({ role }, "reports.view")) notFound();
  const base = `/app/${orgSlug}/databases/reports`;

  const copies = await withOrgTx(organization.id, ({ db }) => listSnapshots(db, organization.id));
  const reports = [...new Map(copies.map((c) => [c.reportId, c.reportTitle])).entries()];
  const only =
    typeof sp.report === "string" && reports.some(([id]) => id === sp.report) ? sp.report : null;
  const shown = only ? copies.filter((c) => c.reportId === only) : copies;
  const months = [...new Set(shown.map((c) => monthOf(c.takenAt)))];

  return (
    <div className="space-y-7.5">
      <PageHeader
        title="Report history"
        description="Copies of your reports as they read on a day, kept by hand or sent on a schedule. Your reports themselves are always live."
        actions={
          <Button asChild variant="outline">
            <Link href={base}>Back to reports</Link>
          </Button>
        }
        tabs={<DatabasesTabs orgSlug={orgSlug} showReports />}
      />
      {reports.length > 1 && (
        <nav aria-label="Report" className="flex flex-wrap gap-2">
          {[["", "All reports"] as const, ...reports].map(([id, title]) => {
            const on = (only ?? "") === id;
            return (
              <Link
                key={id || "all"}
                href={id ? `${base}/past?report=${id}` : `${base}/past`}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "focus-glow flex h-9 items-center gap-2 rounded-full px-3.5 text-sm font-semibold outline-none",
                  on ? "bg-foreground text-background" : "bg-muted hover:bg-muted/70",
                )}
              >
                {title}
                <span className="tabular-nums opacity-70">
                  {id ? copies.filter((c) => c.reportId === id).length : copies.length}
                </span>
              </Link>
            );
          })}
        </nav>
      )}
      {shown.length === 0 ? (
        <EmptyState
          icon={History}
          title="No copies yet"
          description="Open a report and press Keep a copy, or send it on a schedule, to keep how it reads today."
        />
      ) : (
        months.map((month) => (
          <section key={month} aria-label={month} className="space-y-3">
            <h2 className="heading text-[17px]">{month}</h2>
            <ul className="bg-card ring-foreground/6 rounded-card edge divide-border divide-y ring-1">
              {shown
                .filter((c) => monthOf(c.takenAt) === month)
                .map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`${base}/${c.reportId}/past/${c.id}`}
                      className="hover:bg-muted/40 focus-glow flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 outline-none first:rounded-t-[inherit] last:rounded-b-[inherit]"
                    >
                      <span className="bg-muted text-muted-foreground grid size-8 shrink-0 place-items-center rounded-full">
                        <History className="size-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1 basis-60">
                        <b className="block truncate">{c.reportTitle}</b>
                        <span className="text-muted-foreground block truncate text-[13px]">
                          Over {c.rangeLabel}
                          {c.takenByName ? `. Kept by ${c.takenByName}` : ""}
                        </span>
                      </span>
                      <span className="text-muted-foreground text-sm tabular-nums">
                        {day(c.takenAt)}
                      </span>
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
