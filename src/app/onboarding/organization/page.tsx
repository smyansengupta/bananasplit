import Link from "next/link";
import { redirect } from "next/navigation";

import { VerifyEmailNotice } from "@/components/auth/verify-email-notice";
import { exitClass, SetupShell } from "@/components/onboarding/setup-shell";
import { getUserIdentity } from "@/lib/auth/email-verification";
import { ORG_CREATION_DENIAL_MESSAGES, orgCreationPolicy } from "@/lib/auth/org-creation";
import { requireUser } from "@/lib/auth/session";
import { needsProfileSetup } from "@/server/onboarding/profile";

import { ClubBasicsStep } from "./club-basics-step";

export const metadata = { title: "Set up your organization · Bananasplit" };

/**
 * B1 · Club basics (onboarding Flow B, entered from A7's "Create a club").
 * The creator becomes the club's OWNER; B2-B6 follow under its URL.
 */
export default async function ClubBasicsPage() {
  const user = await requireUser();
  if (await needsProfileSetup(user.id)) {
    redirect(`/onboarding?callbackUrl=${encodeURIComponent("/onboarding/organization")}`);
  }
  const identity = await getUserIdentity(user.id);
  const policy = orgCreationPolicy(identity);

  const notice =
    policy.denial === "unverified" ? (
      <VerifyEmailNotice email={identity?.email ?? user.email} action="create an organization" />
    ) : policy.denial ? (
      <p className="bg-muted text-muted-foreground rounded-field m-0 px-4 py-3.5 text-[15px] leading-normal">
        {ORG_CREATION_DENIAL_MESSAGES[policy.denial]}
      </p>
    ) : undefined;

  return (
    <SetupShell
      subject="your organization"
      exit={
        <Link href="/onboarding" className={exitClass}>
          Exit
        </Link>
      }
    >
      <ClubBasicsStep requiresCode={policy.requiresCode} notice={notice} />
    </SetupShell>
  );
}
