import "server-only";

import { spaceLimits, type PlanSpace } from "@/lib/billing/space";
import type { TxClient } from "@/server/db/context";

/**
 * Whether one more member fits the organization's plan (PLAN_LIMITS
 * members: Free holds TEAM_FREE_MEMBER_CAP, a trial and the paid plans have
 * no cap). Called inside the join transaction, before the membership is
 * written: it first takes the org's member-cap advisory lock, held to the
 * end of that transaction, so every way in (an email invite, the join code)
 * counts one at a time and two people can't both take the last seat.
 * Members over the cap after a trial ends stay: only new joins are refused.
 * Returns the refusal to show, or null when there's room.
 */
export async function memberCapRefusal(db: TxClient, orgId: string): Promise<string | null> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`member-cap:${orgId}`}, 0))`;
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: CAP_SELECT,
  });
  // Only an organization has a cap (and a Personal space never takes a member).
  if (!org || org.kind !== "CLUB") return null;
  const members = await db.membership.count({ where: { organizationId: orgId } });
  return capRefusal(org, members);
}

/** The columns capRefusal needs. */
export const CAP_SELECT = {
  name: true,
  kind: true,
  plan: true,
  trialEndsAt: true,
  planAfterTrial: true,
} as const;

/**
 * The refusal for one more member when the org already has `members`, or
 * null when there's room: the check itself, without the lock, for a
 * preview (the join-code screen says a Free org is full before Join).
 */
export function capRefusal(org: { name: string } & PlanSpace, members: number): string | null {
  if (org.kind !== "CLUB") return null;
  const cap = spaceLimits(org).members;
  if (cap === null || members < cap) return null;
  return `${org.name} is on Free, which has room for ${cap} members, and it's full. Ask an owner to move it to Team so you can join.`;
}
