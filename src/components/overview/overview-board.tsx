"use client";

import type { ReactNode } from "react";

import { saveBoardAction } from "@/app/app/[orgSlug]/_shell/board-actions";
import { WidgetBoard } from "@/components/boards/widget-board";
import type { BoardWidget, WidgetMeta } from "@/lib/boards";

/** The Overview as the member's own board of widgets (the shared WidgetBoard). */
export function OverviewBoard({
  orgId,
  types,
  initialLayout,
  customized,
  bodies,
}: {
  orgId: string;
  types: WidgetMeta[];
  initialLayout: BoardWidget[];
  customized: boolean;
  bodies: Record<string, ReactNode>;
}) {
  return (
    <WidgetBoard
      types={types}
      initialLayout={initialLayout}
      customized={customized}
      bodies={bodies}
      intro="Your Overview. Customize it however you like."
      onSave={(layout) => saveBoardAction(orgId, "overview", layout)}
    />
  );
}
