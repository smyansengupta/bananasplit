"use client";

import type { ComponentProps } from "react";

import {
  restoreReportWidgetsAction,
  saveReportLayoutAction,
} from "@/app/app/[orgSlug]/databases/reports/report-actions";
import { WidgetBoard, type SaveBoard } from "@/components/boards/widget-board";
import type { BoardWidget } from "@/lib/boards";
import type { ReportWidget } from "@/lib/reports/catalog";

const toLayout = (widgets: readonly ReportWidget[]): BoardWidget[] =>
  widgets.map(({ id, type, w, h }) => ({ id, type, w, h }));

/**
 * The saved report's board: every change saves itself, and Reset puts the
 * suggested widgets back on the board at once (from what the save answers,
 * not a later refresh), with an Undo that brings the old widgets back
 * exactly, settings and all.
 */
export function reportBoardSave(orgId: string, reportId: string): SaveBoard {
  return async (layout) => {
    const result = await saveReportLayoutAction(orgId, reportId, layout);
    if (!result.ok) return result;
    if (layout !== null || !result.widgets) return { ok: true };
    const before = result.before ?? [];
    return {
      ok: true,
      layout: toLayout(result.widgets),
      undo: before.length
        ? async () => {
            const back = await restoreReportWidgetsAction(orgId, reportId, before);
            return back.ok ? { ok: true, layout: toLayout(back.widgets) } : back;
          }
        : undefined,
    };
  };
}

export function ReportBoard({
  orgId,
  reportId,
  ...props
}: Omit<ComponentProps<typeof WidgetBoard>, "onSave"> & { orgId: string; reportId: string }) {
  return <WidgetBoard {...props} onSave={reportBoardSave(orgId, reportId)} />;
}
