"use server";

import { withOrgAction } from "@/server/db/context";

/**
 * "Mark all as seen" on Since you were here: the previous visit moves up to
 * now, so everything listed counts as seen and the widget starts again
 * from here. Own row only (RLS on MemberPrefs, and userId is the session's).
 * The caller refreshes the page.
 */
export const markHomeSeen = withOrgAction(async (ctx): Promise<{ ok: true }> => {
  const now = new Date();
  const where = {
    organizationId_userId: { organizationId: ctx.organizationId, userId: ctx.userId },
  };
  await ctx.db.memberPrefs.upsert({
    where,
    create: {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      homeVisitAt: now,
      homePrevVisitAt: now,
    },
    update: { homeVisitAt: now, homePrevVisitAt: now },
    select: { userId: true },
  });
  return { ok: true };
});
