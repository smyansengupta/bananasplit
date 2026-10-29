"use server";

import { FINANCE_WIDGET_TYPES } from "@/lib/finance/widgets";
import { OVERVIEW_WIDGET_TYPES } from "@/lib/overview/widgets";
import { saveBoard, type BoardName, type SaveBoardResult } from "@/server/boards";
import { withOrgAction } from "@/server/db/context";

/** Saves the member's own Overview or Finance board (null: back to the default). */
export const saveBoardAction = withOrgAction(
  async (ctx, board: BoardName, layout: unknown): Promise<SaveBoardResult> => {
    if (board !== "overview" && board !== "finance") return { ok: false, error: "Unknown board." };
    const types = board === "overview" ? OVERVIEW_WIDGET_TYPES : FINANCE_WIDGET_TYPES;
    return saveBoard(ctx.db, ctx.organizationId, ctx.userId, board, layout, types);
  },
);
