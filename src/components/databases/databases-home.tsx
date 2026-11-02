import Link from "next/link";
import type { ReactNode } from "react";

import {
  ArrowUpRight,
  ChartColumn,
  ChartLine,
  Database,
  Lock,
  Plus,
  TriangleAlert,
} from "@/components/icons";
import { ReportIcon } from "@/components/reports/saved/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Databases home (the Databases tab): a line of numbers, the
 * organization's own databases as cards (how many rows, how fast they're
 * growing, the report on each or a way to make one), the built-in ones as
 * a list, and beside them what changed this week and the reports. Data
 * from the page (src/app/app/[orgSlug]/databases/page.tsx).
 */

export interface HomeDatabase {
  id: string;
  name: string;
  icon: string | null;
  href: string;
  count: number;
  unit: string;
  /** Rows added in each of the last eight weeks, oldest first. */
  weeks: number[];
  thisWeek: number;
  /** The newest row's name. */
  latest: string | null;
  /** "Owners and admins" when it isn't every member's. */
  restricted: string | null;
  /** The report on it, or where to make one (null without Reports). */
  report: { title: string; href: string } | null;
  newReportHref: string | null;
  /** Its pin toggle (the sidebar's Pinned). */
  pin?: ReactNode;
}

export interface HomeBuiltIn {
  key: string;
  name: string;
  detail: string;
  href: string;
  count: number;
  thisWeek: number;
  newReportHref: string | null;
  report: { title: string; href: string } | null;
}

export interface WeekNote {
  tag: string;
  tone: "good" | "info" | "warn";
  text: string;
  where: string;
  href: string;
}

const TINTS = [
  "bg-tint-success text-tint-success-foreground",
  "bg-tint-info text-tint-info-foreground",
  "bg-tint-accent text-tint-accent-foreground",
  "bg-tint-danger text-tint-danger-foreground",
];

const TAG_TONE: Record<WeekNote["tone"], string> = {
  good: "bg-tint-success text-tint-success-foreground",
  info: "bg-tint-info text-tint-info-foreground",
  warn: "bg-tint-danger text-tint-danger-foreground",
};

function Spark({ values }: { values: number[] }) {
  if (values.every((v) => v === 0)) return null;
  const max = Math.max(1, ...values);
  const step = 110 / (values.length - 1);
  const points = values.map(
    (v, i) => `${(i * step).toFixed(1)},${(32 - (v / max) * 28).toFixed(1)}`,
  );
  return (
    <svg
      viewBox="0 0 110 34"
      className="h-[34px] w-[110px] shrink-0"
      role="img"
      aria-label={`Rows added each week: ${values.join(", ")}`}
    >
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="var(--chart-1)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Stat({ icon, value, label }: { icon: ReactNode; value: ReactNode; label: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3.5">
      <span className="bg-card ring-foreground/6 grid size-[52px] shrink-0 place-items-center rounded-full shadow-[var(--edge-highlight)] ring-1">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="numeral block text-[28px] leading-none">{value}</span>
        <span className="text-muted-foreground mt-1.5 block text-[13px]">{label}</span>
      </span>
    </div>
  );
}

const CARD = "bg-card text-card-foreground ring-foreground/6 rounded-card edge ring-1";

export function DatabasesHome({
  stats,
  custom,
  builtIn,
  notes,
  reports,
  newDatabase,
  newReportHref,
  reportsHref,
}: {
  stats: {
    databases: number;
    addedThisWeek: number;
    across: number;
    reports: number | null;
    withoutReport: number;
    empty: number;
  };
  custom: HomeDatabase[];
  builtIn: HomeBuiltIn[];
  notes: WeekNote[];
  /** Null without Reports. */
  reports: { title: string; sub: string; href: string }[] | null;
  /** The New database dialog with a card as its trigger (admins), or null. */
  newDatabase: ReactNode;
  newReportHref: string | null;
  reportsHref: string | null;
}) {
  return (
    <div className="space-y-7">
      <section aria-label="At a glance" className="flex flex-wrap gap-x-11 gap-y-4">
        <Stat
          icon={<Database className="size-[22px]" aria-hidden="true" />}
          value={stats.databases}
          label="Databases"
        />
        <Stat
          icon={<ChartLine className="size-[22px]" aria-hidden="true" />}
          value={`+${stats.addedThisWeek.toLocaleString("en-US")}`}
          label={`Rows added this week, across ${stats.across}`}
        />
        {stats.reports !== null && (
          <Stat
            icon={<ChartColumn className="size-[22px]" aria-hidden="true" />}
            value={stats.reports}
            label={stats.withoutReport ? `Reports. ${stats.withoutReport} have none` : "Reports"}
          />
        )}
        {stats.empty > 0 && (
          <Stat
            icon={<TriangleAlert className="size-[22px]" aria-hidden="true" />}
            value={stats.empty}
            label="Empty databases"
          />
        )}
      </section>

      <div className="flex flex-wrap items-start gap-7">
        <div className="flex min-w-0 flex-[999_1_600px] flex-col gap-7">
          {(custom.length > 0 || newDatabase) && (
            <section aria-labelledby="h-yours" className="space-y-3.5">
              <div className="flex flex-wrap items-baseline gap-2.5">
                <h2 id="h-yours" className="heading text-[17px]">
                  Your databases
                </h2>
                <span className="text-muted-foreground text-[13.5px]">
                  Made by your organization
                </span>
              </div>
              <ul className="grid gap-4.5 sm:grid-cols-2 xl:grid-cols-3">
                {custom.map((d, i) => (
                  <li key={d.id} className={cn(CARD, "flex flex-col gap-2.5 p-5")}>
                    <Link href={d.href} className="group/db flex items-center gap-2.5 outline-none">
                      <span
                        className={cn(
                          "grid size-9 shrink-0 place-items-center rounded-full",
                          TINTS[i % TINTS.length],
                        )}
                      >
                        <ReportIcon name={d.icon} className="size-[17px]" />
                      </span>
                      <span className="heading line-clamp-2 min-w-0 flex-1 text-[16px] break-words group-hover/db:underline">
                        {d.name}
                      </span>
                      {d.pin}
                      {d.restricted && (
                        <span
                          title={d.restricted}
                          className="text-muted-foreground grid size-7 shrink-0 place-items-center"
                        >
                          <Lock className="size-3.5" aria-label={d.restricted} />
                        </span>
                      )}
                    </Link>
                    <div className="flex items-end justify-between gap-3">
                      <span>
                        <span className="numeral block text-[28px] leading-none">
                          {d.count.toLocaleString("en-US")}
                        </span>
                        <span className="text-muted-foreground text-[13px]">{d.unit}</span>
                      </span>
                      <Spark values={d.weeks} />
                    </div>
                    <p className="text-[13.5px]">
                      {d.thisWeek > 0 ? (
                        <b>+{d.thisWeek} this week</b>
                      ) : (
                        <span className="text-muted-foreground">Nothing added this week</span>
                      )}
                      {d.latest && (
                        <span className="text-muted-foreground"> Latest: {d.latest}</span>
                      )}
                    </p>
                    {(d.report || d.newReportHref) && (
                      <div className="border-border mt-auto flex flex-wrap items-center gap-2 border-t pt-3">
                        {d.report ? (
                          <Link
                            href={d.report.href}
                            className="min-w-0 truncate text-[13px] font-semibold hover:underline"
                          >
                            {d.report.title}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground text-xs">No report yet</span>
                        )}
                        <span className="flex-1" />
                        {d.newReportHref && (
                          <Button asChild size="sm" variant="outline">
                            <Link href={d.newReportHref}>Report on this</Link>
                          </Button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
                {newDatabase && <li>{newDatabase}</li>}
              </ul>
            </section>
          )}

          {builtIn.length > 0 && (
            <section aria-labelledby="h-built" className="space-y-3.5">
              <div className="flex flex-wrap items-baseline gap-2.5">
                <h2 id="h-built" className="heading text-[17px]">
                  Built in
                </h2>
                <span className="text-muted-foreground text-[13.5px]">
                  Kept for you as you use Bananasplit
                </span>
              </div>
              <ul className={cn(CARD, "divide-border divide-y px-5")}>
                {builtIn.map((b) => (
                  <li key={b.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3.5">
                    <Link href={b.href} className="min-w-32 flex-1 font-semibold hover:underline">
                      {b.name}
                    </Link>
                    <span className="text-muted-foreground min-w-0 flex-[2] basis-48 text-[13px]">
                      {b.detail}
                    </span>
                    <span className="numeral w-16 text-right text-[18px]">
                      {b.count.toLocaleString("en-US")}
                    </span>
                    <span
                      className={cn(
                        "w-12 text-right text-xs font-semibold tabular-nums",
                        b.thisWeek > 0 ? "text-tint-success-foreground" : "text-muted-foreground",
                      )}
                    >
                      {b.thisWeek > 0 ? `+${b.thisWeek}` : ""}
                    </span>
                    <span className="flex w-36 justify-end">
                      {b.report ? (
                        <Link
                          href={b.report.href}
                          className="truncate text-[13px] font-semibold hover:underline"
                        >
                          {b.report.title}
                        </Link>
                      ) : b.newReportHref ? (
                        <Button asChild size="sm" variant="ghost">
                          <Link href={b.newReportHref}>Report on this</Link>
                        </Button>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside
          aria-label="This week in your data"
          className="flex min-w-0 flex-[1_1_320px] flex-col gap-4.5"
        >
          <section className={cn(CARD, "space-y-1 p-5")}>
            <h2 className="heading mb-2 text-[17px]">This week in your data</h2>
            {notes.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nothing new this week.</p>
            ) : (
              <ul className="divide-border divide-y">
                {notes.map((n) => (
                  <li key={n.text + n.where}>
                    <Link href={n.href} className="group/note flex items-start gap-3 py-2.5">
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
                          TAG_TONE[n.tone],
                        )}
                      >
                        {n.tag}
                      </span>
                      <span className="min-w-0 flex-1 text-[13.5px]">
                        <span className="group-hover/note:underline">{n.text}</span>
                        <span className="text-muted-foreground block text-xs">{n.where}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {reports && (
            <section className={cn(CARD, "space-y-3 p-5")}>
              <div className="flex items-center gap-2">
                <h2 className="heading flex-1 text-[17px]">Reports</h2>
                {reportsHref && (
                  <Link
                    href={reportsHref}
                    aria-label="All reports"
                    className="hover:bg-muted text-muted-foreground grid size-8 place-items-center rounded-full"
                  >
                    <ArrowUpRight className="size-4" aria-hidden="true" />
                  </Link>
                )}
              </div>
              {reports.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No reports yet. Make one on any database.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {reports.map((r) => (
                    <li key={r.href}>
                      <Link href={r.href} className="group/rep block">
                        <b className="block text-sm group-hover/rep:underline">{r.title}</b>
                        <span className="text-muted-foreground text-[12.5px]">{r.sub}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {newReportHref && (
                <Button asChild variant="outline" size="sm">
                  <Link href={newReportHref}>
                    <Plus aria-hidden="true" />
                    Create new report
                  </Link>
                </Button>
              )}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
