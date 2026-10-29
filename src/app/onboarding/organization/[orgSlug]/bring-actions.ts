"use server";

import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { bringSections, type BringSection } from "@/lib/onboarding/bring";
import { orgStepHref } from "@/lib/onboarding/steps";
import { clearBring, isBringId, rememberBring } from "@/server/personal/bring-cookie";
import { loadBringable, movedSummary, movePersonalItems } from "@/server/personal/move";

/**
 * "Bring anything in?" (B7 of club setup, and Move to a club). The move
 * runs as the signed-in user; app.move_personal_items checks that the
 * Personal space is theirs and that they own or run the club, so calling
 * this directly gets the same answers as the page.
 */

export type BringResult =
  | {
      ok: true;
      summary: string;
      /** What's left to bring: what came along (a folder's notes, a poll's event) is gone too. */
      sections: BringSection[];
    }
  | { ok: false; error: string };

const SLUG = /^[a-z0-9-]{1,60}$/;

/** Moves the ticked items from the user's Personal space into the club. */
export async function bringIntoClubAction(
  organizationId: string,
  selection: unknown,
): Promise<BringResult> {
  const user = await requireUser();
  const result = await movePersonalItems(user.id, organizationId, selection);
  if (!result.ok) return result;
  await clearBring();
  const left = await loadBringable(user.id);
  return {
    ok: true,
    summary: movedSummary(result.moved),
    sections: left ? bringSections(left) : [],
  };
}

/** Skip or Finish: into the club (as its admin after setup). */
export async function finishBringAction(orgSlug: string, welcome: boolean): Promise<void> {
  await requireUser();
  await clearBring();
  const slug = SLUG.test(orgSlug) ? orgSlug : "";
  // From setup (welcome), your profile comes next; from Move, straight back in.
  redirect(!slug ? "/app" : welcome ? orgStepHref(slug, "profile") : `/app/${slug}`);
}

/**
 * Move to a club, with no club to move into yet: remember the item, then
 * start a club. Club setup's last step starts with it ticked.
 */
export async function startClubWithItemAction(itemId: string): Promise<void> {
  await requireUser();
  if (isBringId(itemId)) await rememberBring(itemId);
  redirect("/onboarding/organization");
}
