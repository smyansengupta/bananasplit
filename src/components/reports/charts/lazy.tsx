"use client";

import dynamic from "next/dynamic";

import { ChartSkeleton } from "./chart-kit";

/**
 * The report charts, loaded on the client only (next/dynamic, ssr: false):
 * recharts stays out of the server render and the initial bundle, and each
 * placeholder has the chart's exact height so nothing shifts when it lands.
 */

export const LazyAttendanceLineChart = dynamic(
  () => import("./attendance-line-chart").then((m) => m.AttendanceLineChart),
  { ssr: false, loading: () => <ChartSkeleton height={240} /> },
);

export const LazyStackedColumnsChart = dynamic(
  () => import("./stacked-columns-chart").then((m) => m.StackedColumnsChart),
  { ssr: false, loading: () => <ChartSkeleton height={266} /> },
);
