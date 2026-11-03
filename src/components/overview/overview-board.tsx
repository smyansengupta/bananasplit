"use client";

import type { ReactNode } from "react";

import { saveBoardAction, saveHomeModeAction } from "@/app/app/[orgSlug]/_shell/board-actions";
import { WidgetBoard, type BoardMode } from "@/components/boards/widget-board";
import type { BoardWidget, WidgetMeta } from "@/lib/boards";

/**
 * The Overview as the member's own board of widgets (the shared WidgetBoard),
 * in Ambient (Home arranges and sizes it) or Custom (as they arranged it).
 */
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
  mode,
  resting,
  compact,
}: {
  orgId: string;
  types: WidgetMeta[];
  initialLayout: BoardWidget[];
  customized: boolean;
  bodies: Record<string, ReactNode>;
  /** Each card's header controls (count chip, ↗), by widget type. */
  headerActions?: Record<string, ReactNode>;
  /** The page's greeting, on the layout switch's row. */
  intro?: ReactNode;
  /** The line under the greeting, under that row. */
  introDescription?: ReactNode;
  /** What always heads the page under the greeting: the Today strip, Up next, Get your organization started. */
  stats?: ReactNode;
  /** The admin's setup prompt or the new organization's invite card, under the widgets (Up next leads). */
  notice?: ReactNode;
  /** The member's Home layout. */
  mode: BoardMode;
  /** Widget types with nothing to show right now (Ambient rests them). */
  resting: string[];
  /** Widget types that need only one column right now. */
  compact: string[];
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
      ambient={{
        mode,
        resting,
        compact,
        onMode: (next) => saveHomeModeAction(orgId, next),
      }}
    />
  );
}
