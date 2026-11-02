import { History, Plus } from "@/components/icons";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { describeSchedule } from "@/lib/reports/schedule";
import { cn } from "@/lib/utils";
import { planGate } from "@/server/billing/plan-gate";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { listReports, listSnapshots } from "@/server/reports/saved";
import { reportTier } from "@/server/reports/tier";

import { DatabasesTabs } from "../../databases-tabs";

export const metadata = { title: "Past reports" };

const FILTERS = [
  { id: "all", label: "All" },
  { id: "saved", label: "Saved" },
  { id: "copies", label: "Kept copies" },
  { id: "scheduled", label: "On a schedule" },
] as const;

type Filter = (typeof FILTERS)[number]["id"];

interface Item {
  key: string;
  at: string;
  title: string;
  sub: string;
  tag: string;
  href: string;
}

function monthOf(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Past reports: every saved report, every copy kept of one (by hand or on
 * its schedule), newest first and grouped by month, with a filter for
 * each kind. A copy opens as it read then.
 */
export default async function PastReportsPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/databases/reports/past">) {
  const { orgSlug } = await params;
  const planLock = await planGate(orgSlug, "reports");
  if (planLock) return planLock;
  const sp = await searchParams;
  const { organization, role, user } = await getOrgContextBySlug(orgSlug);
  if (!reportTier(role) || !can({ role }, "reports.view")) notFound();
  const filter: Filter = FILTERS.some((f) => f.id === sp.show) ? (sp.show as Filter) : "all";
  const base = `/app/${orgSlug}/databases/reports`;

  const { reports, snapshots } = await withOrgTx(organization.id, async ({ db }) => ({
    reports: await listReports(db, organization.id),
    snapshots: await listSnapshots(db, organization.id),
  }));

  const saved: Item[] = reports.map((r) => ({
    key: `r:${r.id}`,
    at: r.updatedAt,
    title: r.title,
    sub: [
      r.createdById === user.id
        ? "Made by you"
        : r.createdByName
          ? `Made by ${r.createdByName}`
          : null,
      r.schedule ? describeSchedule(r.schedule) : null,
    ]
      .filter(Boolean)
      .join(". "),
    tag: r.schedule ? "On a schedule" : "Saved",
    href: `${base}/${r.id}`,
  }));
  const copies: Item[] = snapshots.map((s) => ({
    key: `s:${s.id}`,
    at: s.takenAt,
    title: s.reportTitle,
    sub: `${s.rangeLabel}${s.takenByName ? `. Kept by ${s.takenByName}` : ""}`,
    tag: "Copy",
    href: `${base}/${s.reportId}/past/${s.id}`,
  }));
  const counts: Record<Filter, number> = {
    all: saved.length + copies.length,
    saved: saved.length,
    copies: copies.length,
    scheduled: reports.filter((r) => r.schedule).length,
  };
  const shown = (
    filter === "saved"
      ? saved
      : filter === "copies"
        ? copies
        : filter === "scheduled"
          ? saved.filter((i) => i.tag === "On a schedule")
          : [...saved, ...copies]
  ).sort((a, b) => b.at.localeCompare(a.at));
  const months = [...new Set(shown.map((i) => monthOf(i.at)))];

  return (
    <div className="space-y-7.5">
      <PageHeader
        title="Past reports"
        actions={
          <Button asChild variant="create">
            <Link href={`${base}/new`}>
              <Plus aria-hidden="true" />
              Create new report
            </Link>
          </Button>
        }
        tabs={<DatabasesTabs orgSlug={orgSlug} showReports />}
      />
      <nav aria-label="Show" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.id}
            href={f.id === "all" ? `${base}/past` : `${base}/past?show=${f.id}`}
            aria-current={filter === f.id ? "page" : undefined}
            className={cn(
              "focus-glow flex h-9 items-center gap-2 rounded-full px-3.5 text-sm font-semibold outline-none",
              filter === f.id ? "bg-foreground text-background" : "bg-muted hover:bg-muted/70",
            )}
          >
            {f.label}
            <span className="tabular-nums opacity-70">{counts[f.id]}</span>
          </Link>
        ))}
      </nav>
      {shown.length === 0 ? (
        <EmptyState
          icon={History}
          title="Nothing here yet"
          description="Keep a copy of a report, or send one on a schedule, and it shows here."
        />
      ) : (
        months.map((month) => (
          <section key={month} aria-label={month} className="space-y-3">
            <h2 className="heading text-[17px]">{month}</h2>
            <ul className="bg-card ring-foreground/6 rounded-card edge divide-border divide-y ring-1">
              {shown
                .filter((i) => monthOf(i.at) === month)
                .map((i) => (
                  <li key={i.key}>
                    <Link
                      href={i.href}
                      className="hover:bg-muted/40 focus-glow flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 outline-none first:rounded-t-[inherit] last:rounded-b-[inherit]"
                    >
                      <span className="min-w-0 flex-1 basis-60">
                        <b className="block truncate">{i.title}</b>
                        <span className="text-muted-foreground block truncate text-[13px]">
                          {i.sub}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                          i.tag === "Copy"
                            ? "bg-tint-info text-tint-info-foreground"
                            : i.tag === "On a schedule"
                              ? "bg-tint-success text-tint-success-foreground"
                              : "bg-muted text-muted-foreground",
                        )}
                      >
                        {i.tag}
                      </span>
                      <span className="text-muted-foreground w-14 text-right text-sm tabular-nums">
                        {day(i.at)}
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
