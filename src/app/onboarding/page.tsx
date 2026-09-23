import Link from "next/link";
import { redirect } from "next/navigation";

import { VerifyEmailNotice } from "@/components/auth/verify-email-notice";
import { getUserIdentity } from "@/lib/auth/email-verification";
import { ORG_CREATION_DENIAL_MESSAGES, orgCreationPolicy } from "@/lib/auth/org-creation";
import { requireUser } from "@/lib/auth/session";
import { withUserTx } from "@/server/db/context";
import { findPendingInvitationsForMe } from "@/server/settings/invitations";

import { CreateOrgForm } from "./create-org-form";
import { PendingInviteCard } from "./pending-invite-card";

export default async function OnboardingPage() {
  const user = await requireUser();

  const membership = await withUserTx(user.id, ({ db }) =>
    db.membership.findFirst({
      where: { userId: user.id, organization: { deletedAt: null } },
      select: { organization: { select: { slug: true } } },
      orderBy: { joinedAt: "asc" },
    }),
  );
  if (membership) redirect(`/app/${membership.organization.slug}`);

  // Orgs scheduled for deletion stay reachable at their URL, where an owner
  // can cancel during the 30-day grace period.
  const pendingDeletion = await withUserTx(user.id, ({ db }) =>
    db.membership.findMany({
      where: { userId: user.id, organization: { deletedAt: { not: null } } },
      select: { organization: { select: { name: true, slug: true, deleteScheduledFor: true } } },
    }),
  );

  const identity = await getUserIdentity(user.id);
  const verified = Boolean(identity?.emailVerified);
  // Pending invites are listed only for a verified address (0A Fix 4); the
  // lookup itself matches only the caller's verified stored email.
  const pendingInvites = verified ? await findPendingInvitationsForMe(user.id) : [];
  const policy = orgCreationPolicy(identity);

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

      {pendingDeletion.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Scheduled for deletion</h2>
          <ul className="space-y-2">
            {pendingDeletion.map(({ organization: org }) => (
              <li
                key={org.slug}
                className="flex items-center justify-between rounded-md border p-3 text-sm"
              >
                <span>
                  <span className="font-medium">{org.name}</span>
                  {org.deleteScheduledFor && (
                    <span className="text-muted-foreground">
                      {" "}
                      · deleted on{" "}
                      {org.deleteScheduledFor.toLocaleDateString("en-US", { dateStyle: "medium" })}
                    </span>
                  )}
                </span>
                <Link href={`/app/${org.slug}`} className="underline underline-offset-4">
                  Open
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pendingInvites.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Pending invites</h2>
          {pendingInvites.map((invitation) => (
            <PendingInviteCard
              key={invitation.id}
              invitation={{ id: invitation.id, role: invitation.role, orgName: invitation.orgName }}
            />
          ))}
        </section>
      )}

      {verified && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Create an organization</h2>
          {policy.denial ? (
            <p className="text-muted-foreground text-sm">
              {ORG_CREATION_DENIAL_MESSAGES[policy.denial]}
            </p>
          ) : (
            <CreateOrgForm requiresCode={policy.requiresCode} />
          )}
        </section>
      )}
    </div>
  );
}
