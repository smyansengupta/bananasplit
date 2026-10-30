"use client";

import { formatCount, formatDecimal, kindLabel, longDate, shortDate } from "../format";
import { TrendChart } from "./trend-chart";

export interface AttendancePoint {
  id: string;
  title: string;
  kind: string;
  localDate: string;
  checkIns: number;
}

export const ATTENDANCE_CHART_HEIGHT = 240;

/**
 * Attendance over time (the chart kit's line and area): check-ins per
 * session in date order, with the average as the dashed reference.
 */
export function AttendanceLineChart({
  points,
  average,
}: {
  points: AttendancePoint[];
  /** Average check-ins per session in the range: the dashed line. */
  average?: number | null;
}) {
  const avg =
    average ??
    (points.length > 0 ? points.reduce((sum, p) => sum + p.checkIns, 0) / points.length : null);
  return (
    <TrendChart
      label={`Check-ins per session, ${points.length} sessions`}
      seriesLabel="Check-ins"
      height={ATTENDANCE_CHART_HEIGHT}
      format={formatCount}
      reference={
        avg === null
          ? null
          : { value: avg, label: `Average, ${formatDecimal(avg)} a session`, short: "Average" }
      }
      points={points.map((p) => ({
        key: p.id,
        tick: shortDate(p.localDate),
        heading: p.title,
        sub: `${longDate(p.localDate, true)}, ${kindLabel(p.kind)}`,
        value: p.checkIns,
      }))}
    />
  );
}
