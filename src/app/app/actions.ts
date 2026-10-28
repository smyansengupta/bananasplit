"use server";

import { redirect } from "next/navigation";

import { setActiveOrgCookie } from "@/lib/active-org-cookie";
import { NotFoundError } from "@/lib/auth/errors";
import { requireUser } from "@/lib/auth/session";
import { withOrgAction, withUserTx } from "@/server/db/context";

/** Membership check only: set_context refuses a non-member with NotFoundError. */
const enterOrg = withOrgAction(async (ctx) => ctx.organizationId);

/**
 * The org switcher. Resolves the slug (a renamed org's old slug resolves to
 * its current one), confirms membership on the RLS path, remembers the org
 * in the active-org cookie and navigates to it. The switcher only lists the
 * caller's orgs, so an unknown slug or a non-member is a silent no-op, as
 * before.
 */
export async function switchActiveOrg(orgSlug: string): Promise<void> {
  const user = await requireUser();
  const org = await withUserTx(user.id, async ({ db }) => {
    const rows = await db.$queryRaw<{ organizationId: string; canonicalSlug: string }[]>`
      SELECT "organizationId", "canonicalSlug" FROM app.resolve_org_slug(${orgSlug})`;
    return rows[0] ?? null;
  });
  if (!org) return;

  try {
    await enterOrg(org.organizationId);
  } catch (error) {
    if (error instanceof NotFoundError) return;
    throw error;
  }

  await setActiveOrgCookie(org.organizationId);
  redirect(`/app/${org.canonicalSlug}`);
}
