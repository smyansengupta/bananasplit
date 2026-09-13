import { redirect } from "next/navigation";

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

  const pendingInvites = await findPendingInvitationsForEmail(user.email);

  return (
    <div className="mx-auto w-full max-w-lg space-y-8 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to CBC Portal</h1>
        <p className="text-muted-foreground text-sm">
          Create an organization or accept a pending invite to get started.
        </p>
      </div>

      {pendingInvites.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Pending invites</h2>
          {pendingInvites.map((invitation) => (
            <PendingInviteCard key={invitation.id} invitation={invitation} />
          ))}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Create an organization</h2>
        <CreateOrgForm />
      </section>
    </div>
  );
}
