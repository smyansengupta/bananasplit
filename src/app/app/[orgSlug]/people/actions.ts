"use server";

import { z } from "zod";

import { NotificationType } from "@/generated/prisma/enums";
import { checkInText, sayHiText } from "@/lib/ambient/people";
import { personHref } from "@/lib/profile/href";
import { localDateKey } from "@/lib/tasks/dates";
import { withOrgAction } from "@/server/db/context";
import { notifyUser } from "@/server/notifications";
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

/**
 * Say hi (someone new) and Check in (someone away a month): a short note
 * from the viewer, the words written here, reaching them as a notification
 * (in the Inbox and by email, as a mention does: there's no message type of
 * its own) that links back to the sender's profile. Once per pair for a
 * hello, once a day for a check-in.
 */
const NOTE_KINDS = ["hi", "checkin"] as const;
type NoteKind = (typeof NOTE_KINDS)[number];

const sendNoteTx = withOrgAction(
  async (
    ctx,
    rawId: unknown,
    rawKind: unknown,
  ): Promise<{ ok: true } | { ok: false; error: string }> => {
    const to = userId.safeParse(rawId);
    if (!to.success || !(NOTE_KINDS as readonly unknown[]).includes(rawKind)) {
      return { ok: false, error: "That person isn't here." };
    }
    const kind = rawKind as NoteKind;
    if (to.data === ctx.userId) return { ok: false, error: "That's you." };
    const [member, org, me] = await Promise.all([
      ctx.db.membership.findUnique({
        where: { userId_organizationId: { userId: to.data, organizationId: ctx.organizationId } },
        select: { user: { select: { name: true } } },
      }),
      ctx.db.organization.findUnique({
        where: { id: ctx.organizationId },
        select: { name: true, slug: true, timezone: true },
      }),
      ctx.db.user.findUnique({ where: { id: ctx.userId }, select: { name: true } }),
    ]);
    if (!member || !org) return { ok: false, error: "That person isn't a member any more." };
    const who = me?.name?.trim() || "Someone";
    await notifyUser(ctx.db, ctx.organizationId, to.data, {
      type: NotificationType.TASK_MENTIONED,
      title: kind === "hi" ? `${who} says hi` : `${who} is checking in`,
      body: kind === "hi" ? sayHiText(org.name) : checkInText(member.user.name),
      linkUrl: personHref(org.slug, ctx.userId),
      actorId: ctx.userId,
      dedupeKey:
        kind === "hi"
          ? `hi:${ctx.userId}`
          : `checkin:${ctx.userId}:${localDateKey(new Date(), org.timezone)}`,
    });
    return { ok: true };
  },
  { onRefused: "return", feature: "people" },
);

export async function sendMemberNoteAction(
  organizationId: string,
  id: string,
  kind: NoteKind,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await sendNoteTx(organizationId, id, kind);
  return "ok" in result ? result : { ok: false, error: "This organization is paused." };
}
