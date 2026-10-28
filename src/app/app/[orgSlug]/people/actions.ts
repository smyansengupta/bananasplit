"use server";

import { z } from "zod";

import { withOrgAction } from "@/server/db/context";
import {
  getPersonSheet,
  searchPeopleInTx,
  type PeopleSearchResult,
  type PersonSheet,
} from "@/server/profiles/directory";

/**
 * People directory reads for the client (search as you type, the profile
 * sheet). Each runs in one withOrgAction transaction as the session user
 * (a non-member gets NotFoundError before anything is read), in a space
 * that includes People; reads stay allowed while a club is paused.
 */

const query = z.string().max(200);
const userId = z.string().min(1).max(64);

const searchTx = withOrgAction(
  async (ctx, raw: string): Promise<PeopleSearchResult> =>
    searchPeopleInTx(ctx.db, ctx.organizationId, query.parse(raw).slice(0, 80)),
  { feature: "people" },
);

/** Member ids matching `q`, best first (close matches when nothing matches exactly). */
export async function searchPeopleAction(
  organizationId: string,
  q: string,
): Promise<PeopleSearchResult> {
  return searchTx(organizationId, q);
}

const sheetTx = withOrgAction(
  async (ctx, raw: string): Promise<PersonSheet | null> => {
    const id = userId.parse(raw);
    const settings = await ctx.db.orgSettings.findUnique({
      where: { organizationId: ctx.organizationId },
      select: { showMemberEmailsToMembers: true },
    });
    const org = await ctx.db.organization.findUnique({
      where: { id: ctx.organizationId },
      select: { timezone: true },
    });
    return getPersonSheet(
      ctx.organizationId,
      id,
      {
        id: ctx.userId,
        role: ctx.role,
        membersSeeEmails: settings?.showMemberEmailsToMembers === true,
      },
      org?.timezone ?? "UTC",
    );
  },
  { feature: "people" },
);

/** One current member's profile sheet, or null when they are not a member of this org. */
export async function loadPersonSheetAction(
  organizationId: string,
  id: string,
): Promise<PersonSheet | null> {
  return sheetTx(organizationId, id);
}
