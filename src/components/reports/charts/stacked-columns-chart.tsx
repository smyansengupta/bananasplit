"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";

import { formatCount } from "../format";
import { axisProps, ChartLegend, gridProps, SERIES, SURFACE, TooltipCard } from "./chart-kit";

export interface StackedColumn {
  /** Unique x key. */
  key: string;
  /** Axis tick text. */
  tick: string;
  /** Tooltip heading and sub-heading. */
  heading: string;
  sub?: string;
  /** Bottom segment, then top segment. */
  values: [number, number];
}

export const STACKED_CHART_HEIGHT = 240;

/**
 * Two-series stacked columns (part-to-whole per x): the bottom series wears
 * slot 1, the top slot 2, in that fixed order. Columns are at most 24px
 * wide with a 4px rounded top, separated by a 2px surface gap. A legend is
 * always shown; the tooltip lists both series and their total.
 */
export function StackedColumnsChart({
  columns,
  series,
  label,
}: {
  columns: StackedColumn[];
  /** Names of the bottom and top series. */
  series: [string, string];
  /** Accessible description of the chart. */
  label: string;
}) {
  const data = columns.map((c) => ({ ...c, bottom: c.values[0], top: c.values[1] }));
  const byKey = new Map(data.map((d) => [d.key, d]));
  return (
    <div className="flex flex-col gap-2">
      <ChartLegend
        entries={[
          { label: series[0], color: SERIES[0] },
          { label: series[1], color: SERIES[1] },
        ]}
      />
      <div role="img" aria-label={label}>
        <ResponsiveContainer width="100%" height={STACKED_CHART_HEIGHT}>
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            barCategoryGap="20%"
          >
            <CartesianGrid {...gridProps} />
            <XAxis
              dataKey="key"
              {...axisProps}
              tickFormatter={(key: string) => byKey.get(key)?.tick ?? ""}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis {...axisProps} allowDecimals={false} width={36} />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.6 }}
              content={(props: TooltipContentProps<ValueType, NameType>) => {
                const d = props.active
                  ? (props.payload?.[0]?.payload as (typeof data)[number] | undefined)
                  : undefined;
                if (!d) return null;
                return (
                  <TooltipCard
                    heading={d.heading}
                    sub={d.sub}
                    rows={[
                      { label: series[1], value: formatCount(d.top), color: SERIES[1] },
                      { label: series[0], value: formatCount(d.bottom), color: SERIES[0] },
                      { label: "total", value: formatCount(d.top + d.bottom) },
                    ]}
                  />
                );
              }}
            />
            <Bar
              dataKey="bottom"
              name={series[0]}
              stackId="stack"
              fill={SERIES[0]}
              stroke={SURFACE}
              strokeWidth={2}
              maxBarSize={24}
              isAnimationActive={false}
            />
            <Bar
              dataKey="top"
              name={series[1]}
              stackId="stack"
              fill={SERIES[1]}
              stroke={SURFACE}
              strokeWidth={2}
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
