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
  headerActions,
  intro,
  introDescription,
  stats,
  notice,
}: {
  orgId: string;
  types: WidgetMeta[];
  initialLayout: BoardWidget[];
  customized: boolean;
  bodies: Record<string, ReactNode>;
  /** Each card's header controls (count chip, ↗), by widget type. */
  headerActions?: Record<string, ReactNode>;
  /** The page's greeting, on the Customize button's row. */
  intro?: ReactNode;
  /** The line under the greeting, under that row. */
  introDescription?: ReactNode;
  /** What always heads the page under the greeting: the stat strip, Up next, Get your club started. */
  stats?: ReactNode;
  /** The admin's setup prompt or the new club's invite card, under the widgets (Up next leads). */
  notice?: ReactNode;
}) {
  return (
    <WidgetBoard
      types={types}
      initialLayout={initialLayout}
      customized={customized}
      bodies={bodies}
      headerActions={headerActions}
      intro={intro}
      introDescription={introDescription}
      belowIntro={stats}
      footer={notice}
      hiddenOnPhone={["recent"]}
      onSave={(layout) => saveBoardAction(orgId, "overview", layout)}
    />
  );
}
