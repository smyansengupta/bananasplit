"use client";

import { saveBoardAction } from "@/app/app/[orgSlug]/_shell/board-actions";
import { WidgetBoard } from "@/components/boards/widget-board";
import type { DashboardData } from "@/app/app/[orgSlug]/finance/queries";
import type { BoardWidget } from "@/lib/boards";
import type { FinanceSetupState } from "@/lib/finance/setup";
import { FINANCE_WIDGETS, type WidgetTypeId } from "@/lib/finance/widgets";

import { WidgetBody } from "./finance-widgets";

/**
 * The finance dashboard as the member's own board of widgets (the shared
 * WidgetBoard): add, drag, resize, remove, saved to their MemberPrefs row.
 */
export function FinanceBoard({
  orgId,
  orgSlug,
  data,
  setup,
  initialLayout,
  customized,
}: {
  orgId: string;
  orgSlug: string;
  data: DashboardData;
  /** Where finance setup stands, for the setup widget. */
  setup?: FinanceSetupState;
  initialLayout: BoardWidget[];
  customized: boolean;
}) {
  return (
    <WidgetBoard
      types={FINANCE_WIDGETS}
      initialLayout={initialLayout}
      customized={customized}
      intro={data.period ? `Your board · ${data.period.label}` : "Your board"}
      renderBody={(type) => <WidgetBody type={type as WidgetTypeId} data={data} orgSlug={orgSlug} setup={setup} />}
      onSave={(layout) => saveBoardAction(orgId, "finance", layout)}
    />
  );
}
