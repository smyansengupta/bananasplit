import { notFound } from "next/navigation";

import { Role } from "@/generated/prisma/client";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { requireRole } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

import { InviteForm } from "./invite-form";
import { RevokeInviteButton } from "./revoke-invite-button";

export default async function InvitationsPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/invitations">) {
  const { orgSlug } = await params;

  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) {
    notFound();
  }

  try {
    await requireRole(org.id, Role.ADMIN);
  } catch (error) {
    handleAuthErrorInPage(error);
  }

  const pending = await prisma.invitation.findMany({
    where: { organizationId: org.id, acceptedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Invitations</h1>
        <p className="text-muted-foreground text-sm">Invite new members by email.</p>
      </div>

      <InviteForm orgId={org.id} />

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Pending invites</h2>
        {pending.length === 0 ? (
          <p className="text-muted-foreground text-sm">No pending invites.</p>
        ) : (
          <ul className="space-y-2">
            {pending.map((invite) => (
              <li
                key={invite.id}
                className="flex items-center justify-between rounded-md border p-3 text-sm"
              >
                <div>
                  <div className="font-medium">{invite.email}</div>
                  <div className="text-muted-foreground text-xs">
                    Invited as {invite.role.toLowerCase()} · expires{" "}
                    {invite.expiresAt.toLocaleDateString()}
                  </div>
                </div>
                <RevokeInviteButton orgId={org.id} invitationId={invite.id} email={invite.email} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
