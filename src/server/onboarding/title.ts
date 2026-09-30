import { withUserTx } from "@/server/db/context";

/**
 * The title picked in profile setup (User.preferredTitle), read from the
 * user's own row for a new Membership: org creation, invitations and the
 * invite code all start the member with it; admins change it afterwards.
 */
export async function ownPreferredTitle(userId: string): Promise<string | null> {
  const row = await withUserTx(userId, ({ db }) =>
    db.user.findUnique({ where: { id: userId }, select: { preferredTitle: true } }),
  );
  return row?.preferredTitle ?? null;
}
