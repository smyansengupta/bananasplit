import { Prisma } from "@/generated/prisma/client";
import { parseAvailability, type Availability } from "@/lib/availability";
import { parseStoredLinks, type ProfileLink } from "@/lib/profile/links";
import { parsePersonalTheme, type PersonalTheme } from "@/lib/theme/personal";
import { withUserTx } from "@/server/db/context";

/**
 * Profile setup (onboarding Flow A). Every step saves straight into the
 * user's own row as they go (withUserTx; RLS and the column grant allow the
 * user's own row only), so leaving halfway loses nothing and the flow
 * resumes where it stopped. onboardedAt is the flowchart's
 * "Profile complete?": set on the review step, never cleared.
 */

export interface OnboardingProfile {
  id: string;
  name: string | null;
  email: string;
  emailVerified: boolean;
  image: string | null;
  avatar: Prisma.JsonValue | null;
  pronouns: string | null;
  major: string | null;
  gradYear: number | null;
  bio: string | null;
  links: ProfileLink[];
  timezone: string | null;
  preferredTitle: string | null;
  themePreference: PersonalTheme | null;
  availability: Availability;
  onboardedAt: Date | null;
  /** Whether the account can use its Google photo (it has an OAuth image). */
  hasGooglePhoto: boolean;
  /** Live orgs the user already belongs to (an emailed invite joined before setup). */
  memberships: { name: string; slug: string }[];
}

export async function getOnboardingProfile(userId: string): Promise<OnboardingProfile | null> {
  return withUserTx(userId, async ({ db }) => {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        image: true,
        avatar: true,
        pronouns: true,
        major: true,
        gradYear: true,
        bio: true,
        links: true,
        timezone: true,
        preferredTitle: true,
        themePreference: true,
        availability: true,
        onboardedAt: true,
      },
    });
    if (!user) return null;
    const memberships = await db.membership.findMany({
      where: { userId, organization: { deletedAt: null } },
      select: { organization: { select: { name: true, slug: true } } },
      orderBy: { joinedAt: "asc" },
    });
    return {
      ...user,
      emailVerified: Boolean(user.emailVerified),
      links: parseStoredLinks(user.links),
      themePreference: parsePersonalTheme(user.themePreference),
      availability: parseAvailability(user.availability),
      hasGooglePhoto: Boolean(user.image),
      memberships: memberships.map((m) => m.organization),
    };
  });
}

/** Whether the user still has to run profile setup (cheap; own row). */
export async function needsProfileSetup(userId: string): Promise<boolean> {
  const row = await withUserTx(userId, ({ db }) =>
    db.user.findUnique({ where: { id: userId }, select: { onboardedAt: true } }),
  );
  return row !== null && row.onboardedAt === null;
}

export interface OnboardingFields {
  preferredTitle?: string | null;
  themePreference?: PersonalTheme | null;
  availability?: Availability;
}

/** Saves the onboarding-only columns (already validated). Undefined = untouched. */
export async function updateOwnOnboardingFields(
  userId: string,
  values: OnboardingFields,
): Promise<void> {
  const data: Prisma.UserUpdateInput = {};
  if (values.preferredTitle !== undefined) data.preferredTitle = values.preferredTitle;
  if (values.themePreference !== undefined) {
    data.themePreference = values.themePreference
      ? (values.themePreference as unknown as Prisma.InputJsonValue)
      : Prisma.DbNull;
  }
  if (values.availability !== undefined) {
    data.availability = values.availability as unknown as Prisma.InputJsonValue;
  }
  if (Object.keys(data).length === 0) return;
  await withUserTx(userId, ({ db }) =>
    db.user.update({ where: { id: userId }, data, select: { id: true } }),
  );
}

/** "Profile complete": the gate in /app and the org layout lets the user through. */
export async function markProfileSetupComplete(userId: string): Promise<void> {
  await withUserTx(userId, ({ db }) =>
    db.user.updateMany({
      where: { id: userId, onboardedAt: null },
      data: { onboardedAt: new Date() },
    }),
  );
}
