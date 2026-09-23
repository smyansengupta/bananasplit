import { redirect } from "next/navigation";

import { VerifyEmailNotice } from "@/components/auth/verify-email-notice";
import { getUserIdentity } from "@/lib/auth/email-verification";
import { ORG_CREATION_DENIAL_MESSAGES, orgCreationDenial } from "@/lib/auth/org-creation";
import { requireUser } from "@/lib/auth/session";
import { findPendingInvitationsForEmail } from "@/lib/invitations";
import { prisma } from "@/lib/prisma";

import { CreateOrgForm } from "./create-org-form";
import { PendingInviteCard } from "./pending-invite-card";

export default async function OnboardingPage() {
  const user = await requireUser();

  const membership = await prisma.membership.findFirst({
    where: { userId: user.id },
    include: { organization: true },
  });
  if (membership) {
    redirect(`/app/${membership.organization.slug}`);
  }

  const identity = await getUserIdentity(user.id);
  const verified = Boolean(identity?.emailVerified);
  // Pending invites are listed only for a verified address (0A Fix 4).
  const pendingInvites =
    verified && identity ? await findPendingInvitationsForEmail(identity.email) : [];
  const creationDenial = orgCreationDenial(identity);

  return (
    <div className="mx-auto w-full max-w-lg space-y-8 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to CBC Portal</h1>
        <p className="text-muted-foreground text-sm">
          Create an organization or accept a pending invite to get started.
        </p>
      </div>

      {!verified && (
        <VerifyEmailNotice
          email={identity?.email ?? user.email}
          action="create an organization or accept an invite"
        />
      )}

      {pendingInvites.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Pending invites</h2>
          {pendingInvites.map((invitation) => (
            <PendingInviteCard key={invitation.id} invitation={invitation} />
          ))}
        </section>
      )}

      {verified && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Create an organization</h2>
          {creationDenial ? (
            <p className="text-muted-foreground text-sm">
              {ORG_CREATION_DENIAL_MESSAGES[creationDenial]}
            </p>
          ) : (
            <CreateOrgForm />
          )}
        </section>
      )}
    </div>
  );
}
