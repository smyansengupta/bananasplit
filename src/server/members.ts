import type { Prisma, Role } from "@/generated/prisma/client";
import { withOrgTx } from "@/server/db/context";

/**
 * Member reads shared by every section (member pickers, the person column,
 * task assignees, the org chart).
 *
 * userPublicSelect is the ONE shape of a user that other members may see:
 * id, name, the OAuth image and the uploaded avatar variants. Never email
 * (the roster shows emails only when Privacy allows it, through its own
 * query), never profile fields the user did not choose to share.
 */
export const userPublicSelect = {
  id: true,
  name: true,
  image: true,
  avatar: true,
} satisfies Prisma.UserSelect;

export type UserPublic = Prisma.UserGetPayload<{ select: typeof userPublicSelect }>;

export interface OrgMemberOption extends UserPublic {
  role: Role;
  /** Per-org title ("VP Ops & Programs"), if set. */
  title: string | null;
}

/**
 * Every member of `organizationId` for a picker, sorted by name, for the
 * session user (who must be a member: withOrgTx refuses anyone else). Runs
 * in the caller's transaction when there is one for the same org.
 */
export async function getOrgMembersForPicker(organizationId: string): Promise<OrgMemberOption[]> {
  const rows = await withOrgTx(organizationId, ({ db }) =>
    db.membership.findMany({
      where: { organizationId },
      select: { role: true, title: true, user: { select: userPublicSelect } },
    }),
  );
  return rows
    .map((m) => ({ ...m.user, role: m.role, title: m.title }))
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" }));
}
