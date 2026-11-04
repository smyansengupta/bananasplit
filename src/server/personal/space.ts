import { randomInt } from "node:crypto";

import { OrgKind, OrgPlan, Role } from "@/generated/prisma/client";
import { trialEndsAtFrom } from "@/lib/billing/space";
import { isValidTimeZone } from "@/lib/timezones";
import { writeOrgAuditLog } from "@/server/audit";
import { withSystemOrgTx, withUserTx } from "@/server/db/context";
import { sqlStateOf } from "@/server/db/errors";
import { newOrgId, scheduleTrialReminder } from "@/server/settings/org-creation";

/**
 * Personal spaces (docs/features/personal-and-clubs.md). Every account has
 * one: an Organization of kind PERSONAL, plan FREE, owned by the user
 * (personalOwnerId, unique) and with them as its only member. It holds their
 * own tasks, calendar, availability polls, RSVP pages, files and databases,
 * so those work exactly as in a club (row security, jobs, public links).
 * The database refuses a second member, an invitation or a join code
 * (app.personal_space_guard), and kind never changes.
 *
 * A new space starts with a free trial of Personal Plus: plan FREE with a
 * trialEndsAt TRIAL_DAYS out (src/lib/billing/space.ts), no card asked,
 * and a reminder queued before it ends.
 *
 * Made by ensurePersonalSpace when the quick profile (onboarding step 1) is
 * saved, and lazily by /app for anyone who doesn't have one yet. It never
 * counts toward the club creation limits (ORG_CREATION_LIMITS).
 */

export interface PersonalSpace {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  /** Scheduled for deletion (danger zone): its URL shows the cancel page. */
  deletedAt: Date | null;
}

const SPACE_SELECT = {
  id: true,
  slug: true,
  name: true,
  timezone: true,
  deletedAt: true,
} as const;

const SLUG_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/** A Personal space's slug: never shown as a name, so random (me-xxxxxxxxxx). */
export function personalSlug(): string {
  let out = "me-";
  for (let i = 0; i < 10; i++) out += SLUG_ALPHABET[randomInt(SLUG_ALPHABET.length)];
  return out;
}

/** "Maya's space", from the first name; "Personal" without one. */
export function personalSpaceName(name: string | null | undefined): string {
  const first = name?.trim().split(/\s+/)[0]?.slice(0, 70);
  return first ? `${first}'s space` : "Personal";
}

/** The user's Personal space (live or scheduled for deletion), or null. */
export async function getPersonalSpace(userId: string): Promise<PersonalSpace | null> {
  return withUserTx(userId, ({ db }) =>
    db.organization.findFirst({
      where: { personalOwnerId: userId, kind: OrgKind.PERSONAL },
      select: SPACE_SELECT,
    }),
  );
}

/**
 * The user's Personal space, made if they don't have one. Idempotent: a
 * second call (or a race: the unique personalOwnerId) returns the first.
 */
export async function ensurePersonalSpace(userId: string): Promise<PersonalSpace> {
  const found = await getPersonalSpace(userId);
  if (found) return found;

  const me = await withUserTx(userId, ({ db }) =>
    db.user.findUnique({ where: { id: userId }, select: { name: true, timezone: true } }),
  );
  if (!me) throw new Error("ensurePersonalSpace: no such user");

  const orgId = newOrgId();
  const name = personalSpaceName(me.name);
  const timezone = me.timezone && isValidTimeZone(me.timezone) ? me.timezone : "America/New_York";
  try {
    return await withSystemOrgTx(orgId, { userId }, async ({ db }) => {
      const trialEndsAt = trialEndsAtFrom();
      const space = await db.organization.create({
        data: {
          id: orgId,
          name,
          slug: personalSlug(),
          timezone,
          kind: OrgKind.PERSONAL,
          personalOwnerId: userId,
          plan: OrgPlan.FREE,
          trialEndsAt,
        },
        select: SPACE_SELECT,
      });
      await scheduleTrialReminder(db, orgId, trialEndsAt);
      await db.membership.create({
        data: { organizationId: orgId, userId, role: Role.OWNER },
      });
      await writeOrgAuditLog(db, {
        organizationId: orgId,
        action: "org.created",
        targetType: "Organization",
        targetId: orgId,
        diff: { name, kind: "PERSONAL", timezone },
      });
      return space;
    });
  } catch (error) {
    // Made a moment ago by another request (personalOwnerId is unique).
    if (sqlStateOf(error) === "23505") {
      const again = await getPersonalSpace(userId);
      if (again) return again;
    }
    throw error;
  }
}

/**
 * Gives the user's Personal space their time zone (picked on the profile
 * step, say, after the space was made from the device's), so its due dates
 * and all-day events land on the owner's days. Nothing to do without one.
 */
export async function setPersonalSpaceTimezone(userId: string, timezone: string): Promise<void> {
  if (!isValidTimeZone(timezone)) return;
  const space = await getPersonalSpace(userId);
  if (!space || space.timezone === timezone) return;
  await withSystemOrgTx(space.id, { userId }, ({ db }) =>
    db.organization.update({ where: { id: space.id }, data: { timezone }, select: { id: true } }),
  );
}

/** Where the user's Personal space opens: /app/{slug}. */
export async function personalHomeHref(userId: string): Promise<string> {
  const space = await ensurePersonalSpace(userId);
  return `/app/${space.slug}`;
}
