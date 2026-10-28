"use server";

import { redirect } from "next/navigation";

import { setActiveOrgCookie } from "@/lib/active-org-cookie";
import { requireUser } from "@/lib/auth/session";
import { getClientIp } from "@/lib/request-ip";
import { orgLogoUrl } from "@/lib/org-logo";
import { clubRoleHref, clubRoleSchema } from "@/lib/onboarding/steps";
import { getJoinedClub, setOwnClubTitle } from "@/server/onboarding/club-role";
import { checkJoinCode, joinWithCode } from "@/server/onboarding/join-code";

/**
 * "Join a club" with its code: a preview first, so the person sees which
 * club the code opens before they join it (both re-check the code, the
 * verified email and the club's allowed domain on the server), then the one
 * small club step, "Your role in <club>".
 */

export type CheckCodeResult =
  | {
      ok: true;
      org: {
        name: string;
        slug: string;
        logoUrl: string | null;
        memberCount: number;
        allowedDomain: string | null;
      };
      alreadyMember: boolean;
    }
  | { ok: false; error: string };

export async function checkInviteCodeAction(code: string): Promise<CheckCodeResult> {
  const user = await requireUser();
  const result = await checkJoinCode(
    user,
    typeof code === "string" ? code : "",
    await getClientIp(),
  );
  if (!result.ok) return { ok: false, error: result.message };
  return {
    ok: true,
    alreadyMember: result.alreadyMember,
    org: {
      name: result.org.orgName,
      slug: result.org.orgSlug,
      logoUrl: orgLogoUrl(result.org.orgLogo, 64),
      memberCount: result.org.memberCount,
      allowedDomain: result.org.allowedDomain,
    },
  };
}

export async function joinWithInviteCodeAction(code: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const result = await joinWithCode(
    user,
    typeof code === "string" ? code : "",
    await getClientIp(),
  );
  if (!result.ok) return { error: result.message };
  await setActiveOrgCookie(result.orgId);
  // Then the one small club step: "Your role in <club>".
  redirect(clubRoleHref(result.orgSlug));
}

/** "Your role in <club>": the title saves on the new membership, then into the club. */
export async function saveClubRoleAction(
  orgSlug: string,
  input: unknown,
): Promise<{ error?: string }> {
  const user = await requireUser();
  const parsed = clubRoleSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check your role." };
  const club = await getJoinedClub(user.id, typeof orgSlug === "string" ? orgSlug : "");
  if (!club) return { error: "You're not a member of this organization." };
  if (parsed.data.title !== club.title) {
    const saved = await setOwnClubTitle(user.id, club.organizationId, parsed.data.title);
    if (!saved) return { error: "Your role here is set by the organization's admins now." };
  }
  redirect(`/app/${club.slug}`);
}
