import { Prisma } from "@/generated/prisma/client";
import { withUserTx } from "@/server/db/context";

/**
 * The organization the user just joined (a code, an invite link or an
 * emailed invite; docs/features/personal-and-clubs.md), for "You're in
 * <org>": the profile screen that follows. Membership.title stays with the
 * owners and admins (RLS P2-02); this screen doesn't ask for a role.
 */

export interface JoinedClub {
  organizationId: string;
  name: string;
  slug: string;
  logo: Prisma.JsonValue | null;
}

/** The club the user just joined, by slug; null when they aren't a member of a live club. */
export async function getJoinedClub(userId: string, slug: string): Promise<JoinedClub | null> {
  return withUserTx(userId, async ({ db }) => {
    const membership = await db.membership.findFirst({
      where: { userId, organization: { slug, kind: "CLUB", deletedAt: null } },
      select: { organization: { select: { id: true, name: true, slug: true, logo: true } } },
    });
    if (!membership) return null;
    const { id, name, slug: orgSlug, logo } = membership.organization;
    return { organizationId: id, name, slug: orgSlug, logo };
  });
}
