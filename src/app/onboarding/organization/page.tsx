import Link from "next/link";
import { redirect } from "next/navigation";

import { VerifyEmailNotice } from "@/components/auth/verify-email-notice";
import { OnboardingFrame, StepCard } from "@/components/onboarding/step-card";
import { getUserIdentity } from "@/lib/auth/email-verification";
import { ORG_CREATION_DENIAL_MESSAGES, orgCreationPolicy } from "@/lib/auth/org-creation";
import { requireUser } from "@/lib/auth/session";
import { ORG_STEP_COUNT } from "@/lib/onboarding/steps";
import { needsProfileSetup } from "@/server/onboarding/profile";

import { CreateOrgForm } from "../create-org-form";

/**
 * B1 · Name the org (onboarding Flow B, entered from A7's "Create an
 * organization"). The creator becomes the org's OWNER; B2-B5 follow under
 * the new org's URL.
 */
export default async function NameOrgPage() {
  const user = await requireUser();
  if (await needsProfileSetup(user.id)) redirect("/onboarding/profile/basics");
  const identity = await getUserIdentity(user.id);
  const policy = orgCreationPolicy(identity);

  return (
    <OnboardingFrame>
      <StepCard
        tone="warning"
        step={{ index: 1, total: ORG_STEP_COUNT }}
        title="Set up your organization"
        description="You'll be its admin. Everything here can be changed later in Settings."
      >
        {policy.denial === "unverified" ? (
          <VerifyEmailNotice
            email={identity?.email ?? user.email}
            action="create an organization"
          />
        ) : policy.denial ? (
          <p className="rounded-md border p-4 text-sm">
            {ORG_CREATION_DENIAL_MESSAGES[policy.denial]}
          </p>
        ) : (
          <CreateOrgForm requiresCode={policy.requiresCode} flow="onboarding" />
        )}
        <div className="text-muted-foreground flex justify-between border-t pt-3 text-xs">
          <Link href="/onboarding" className="hover:underline">
            Back
          </Link>
          <Link href="/onboarding/join" className="hover:underline">
            Join one with an invite code instead
          </Link>
        </div>
      </StepCard>
    </OnboardingFrame>
  );
}
