"use server";

import { Prisma } from "@/generated/prisma/client";
import { availabilitySchema, busyCells } from "@/lib/availability";
import { withOrgAction } from "@/server/db/context";

/**
 * Focus time's Block it off (and its Undo): saves the viewer's availability
 * with the block added as a one-day rule, the same row the profile's
 * availability form saves (UserAvailability: the rules stay on the
 * owner-only row, busy cells are all anyone else sees). An org action, so
 * it runs as the member in the organization they pressed it in; RLS keeps
 * it to their own row, and userId is the session's. The caller refreshes
 * the page.
 */
export const saveFocusAvailability = withOrgAction(
  async (ctx, input: unknown): Promise<{ ok: true } | { ok: false; error: string }> => {
    const parsed = availabilitySchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Couldn't save. Try again." };
    }
    const row = {
      rules: parsed.data as unknown as Prisma.InputJsonValue,
      busy: busyCells(parsed.data),
    };
    await ctx.db.userAvailability.upsert({
      where: { userId: ctx.userId },
      create: { userId: ctx.userId, ...row },
      update: row,
      select: { userId: true },
    });
    return { ok: true };
  },
);
