import Link from "next/link";

import { VerifyEmailNotice } from "@/components/auth/verify-email-notice";
import { CreateOrgForm } from "@/app/onboarding/create-org-form";
import { getUserIdentity } from "@/lib/auth/email-verification";
import { ORG_CREATION_DENIAL_MESSAGES, orgCreationPolicy } from "@/lib/auth/org-creation";
import { requireUser } from "@/lib/auth/session";

/**
 * /app/new: create another organization (the org switcher's "Create
 * organization"). Gated by the org-creation policy (verified email;
 * PLATFORM_ORG_CREATION_ENABLED; ORG_CREATION_MODE with platform admins in
 * PLATFORM_ADMIN_EMAILS), re-checked by the action.
 */
export default async function NewOrganizationPage() {
  const user = await requireUser();
  const identity = await getUserIdentity(user.id);
  const policy = orgCreationPolicy(identity);

  return (
    <div className="mx-auto w-full max-w-lg space-y-6 p-6">
      <div className="space-y-1">
        <Link
          href="/app"
          className="text-muted-foreground text-sm underline-offset-4 hover:underline"
        >
          ← Back
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Create an organization</h1>
        <p className="text-muted-foreground text-sm">
          A separate workspace with its own members, data, integrations and settings. You become its
          owner.
        </p>
      </div>
      {policy.denial === "unverified" ? (
        <VerifyEmailNotice email={identity?.email ?? user.email} action="create an organization" />
      ) : policy.denial ? (
        <p className="rounded-md border p-4 text-sm">
          {ORG_CREATION_DENIAL_MESSAGES[policy.denial]}
        </p>
      ) : (
        <CreateOrgForm requiresCode={policy.requiresCode} />
      )}
    </div>
  );
}
