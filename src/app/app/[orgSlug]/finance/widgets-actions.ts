"use server";

import { withOrgAction } from "@/server/db/context";
import { saveFinanceLayout, type SaveLayoutResult } from "@/server/finance/widgets";

/** Saves the member's own finance board (null: back to the default). */
export const saveFinanceWidgetsAction = withOrgAction(
  async (ctx, layout: unknown): Promise<SaveLayoutResult> =>
    saveFinanceLayout(ctx.db, ctx.organizationId, ctx.userId, layout),
);
