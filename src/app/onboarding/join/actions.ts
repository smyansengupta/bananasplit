"use server";

import { redirect } from "next/navigation";

import { setActiveOrgCookie } from "@/lib/active-org-cookie";
import { requireUser } from "@/lib/auth/session";
import { orgLogoUrl } from "@/lib/org-logo";
import { checkJoinCode, joinWithCode } from "@/server/onboarding/join-code";

/**
 * "Join with invite code" (onboarding A7). Two steps so the person sees
 * which organization the code opens before they join it; both re-check the
 * code, the verified email and the org's allowed domain on the server.
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
  const result = await checkJoinCode(user, typeof code === "string" ? code : "");
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
  const result = await joinWithCode(user, typeof code === "string" ? code : "");
  if (!result.ok) return { error: result.message };
  await setActiveOrgCookie(result.orgId);
  redirect(`/app/${result.orgSlug}`);
}
