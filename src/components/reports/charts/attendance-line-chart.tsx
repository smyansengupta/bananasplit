"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";

import { formatCount, kindLabel, longDate, shortDate } from "../format";
import { axisProps, gridProps, SERIES, SURFACE, TooltipCard } from "./chart-kit";

export interface AttendancePoint {
  id: string;
  title: string;
  kind: string;
  localDate: string;
  checkIns: number;
}

export const ATTENDANCE_CHART_HEIGHT = 240;

/**
 * Attendance over time: one point per session, a single series (slot 1, no
 * legend box; the card title names it). 2px line, 8px markers with a 2px
 * surface ring, a crosshair tooltip, and the latest value labelled at the
 * end of the line.
 */
export function AttendanceLineChart({ points }: { points: AttendancePoint[] }) {
  const byId = new Map(points.map((p) => [p.id, p]));
  const lastIndex = points.length - 1;
  return (
    <div role="img" aria-label={`Check-ins per session, ${points.length} sessions`}>
      <ResponsiveContainer width="100%" height={ATTENDANCE_CHART_HEIGHT}>
        <LineChart data={points} margin={{ top: 16, right: 28, bottom: 0, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis
            dataKey="id"
            {...axisProps}
            tickFormatter={(id: string) => {
              const p = byId.get(id);
              return p ? shortDate(p.localDate) : "";
            }}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis {...axisProps} allowDecimals={false} width={36} />
          <Tooltip
            cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
            content={(props: TooltipContentProps<ValueType, NameType>) => {
              const p = props.active ? (props.payload?.[0]?.payload as AttendancePoint | undefined) : undefined;
              if (!p) return null;
              return (
                <TooltipCard
                  heading={p.title}
                  sub={`${longDate(p.localDate, true)} · ${kindLabel(p.kind)}`}
                  rows={[{ label: "checked in", value: formatCount(p.checkIns), color: SERIES[0] }]}
                />
              );
            }}
          />
          <Line
            type="linear"
            dataKey="checkIns"
            name="Check-ins"
            stroke={SERIES[0]}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={{ r: 4, fill: SERIES[0], stroke: SURFACE, strokeWidth: 2 }}
            activeDot={{ r: 6, fill: SERIES[0], stroke: SURFACE, strokeWidth: 2 }}
            isAnimationActive={false}
            label={(props: { index?: number; x?: number | string; y?: number | string; value?: unknown }) => {
              if (props.index !== lastIndex) return <g />;
              return (
                <text
                  x={Number(props.x) + 8}
                  y={Number(props.y) - 8}
                  fill="var(--foreground)"
                  fontSize={12}
                  fontWeight={600}
                >
                  {formatCount(Number(props.value))}
                </text>
              );
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
