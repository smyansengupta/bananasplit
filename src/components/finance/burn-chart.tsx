"use client";

import { ChartColumn } from "@/components/icons";

import { BarsChart } from "@/components/reports/charts/bars-chart";
import { IconChip } from "@/components/ui/stat";
import { formatCents } from "@/lib/finance/money";

const monthShort = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
const monthLong = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** Axis money: $0, $500, $1.5K. */
function axisMoney(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1000) {
    const k = dollars / 1000;
    return `$${k.toFixed(k % 1 ? 1 : 0)}K`;
  }
  return `$${Math.round(dollars)}`;
}

/**
 * Money in and out by month (the chart kit's columns): money in beside
 * money out, and out split into what's paid and what's still waiting to be
 * paid back (hatched: the "not yet" of submitted and approved expenses).
 */
export function BurnChart({
  data,
}: {
  data: { month: string; inCents: number; outCents: number; pendingCents?: number }[];
}) {
  if (data.length === 0) {
    return (
      <div className="text-muted-foreground flex min-h-28 flex-col items-center justify-center gap-2.5 py-6 text-center text-sm">
        <IconChip icon={ChartColumn} className="text-muted-foreground" />
        No activity yet this period.
      </div>
    );
  }

  return (
    <BarsChart
      label={`Money in and out by month, ${data.length} months`}
      format={formatCents}
      formatAxis={axisMoney}
      series={[
        { label: "In", color: "var(--chart-2)", stack: "in" },
        { label: "Out, paid", color: "var(--chart-1)", stack: "out" },
        {
          label: "Out, waiting to be paid back",
          color: "var(--chart-1)",
          stack: "out",
          hatch: true,
        },
      ]}
      data={data.map((m) => {
        const date = new Date(`${m.month}-01T00:00:00Z`);
        const pending = Math.min(m.pendingCents ?? 0, m.outCents);
        return {
          key: m.month,
          tick: monthShort.format(date),
          heading: monthLong.format(date),
          values: [m.inCents, m.outCents - pending, pending],
        };
      })}
    />
  );
}
