import { UserPlus } from "@/components/icons";
import Link from "next/link";
import { redirect } from "next/navigation";

import { JoinCodeCard } from "@/components/onboarding/join-code-card";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Role } from "@/generated/prisma/enums";
import { absoluteAppUrl } from "@/lib/app-url";
import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { getOrCreateJoinCode } from "@/server/onboarding/join-code";

import { SettingsCard } from "../settings-card";
import { InviteDialog } from "./invite-dialog";
import { LeaveOrgCard } from "./leave-org-card";

/**
 * Admin panel › Members: inviting (OWNER/ADMIN) and leaving. The roster
 * itself is People's Table layout (roles and titles edited in place,
 * invites waiting as rows), so it isn't repeated here: one Invite card
 * holds Invite people and the join code, then Leave.
 */
export default async function MembersPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/members">) {
  const { orgSlug } = await params;
  const { organization, role, user } = await getOrgContextBySlug(orgSlug);
  // A Personal space has one member and no invitations or join code.
  if (organization.kind === "PERSONAL") redirect(`/app/${organization.slug}/settings`);
  const orgId = organization.id;
  const canInvite = can({ role }, "members.invite");

  const { ownerCount, joinCode, pending } = await withOrgTx(orgId, async ({ db }) => ({
    ownerCount: await db.membership.count({ where: { organizationId: orgId, role: Role.OWNER } }),
    joinCode: canInvite ? await getOrCreateJoinCode(db, orgId, user.id) : null,
    pending: canInvite
      ? await db.invitation.count({ where: { organizationId: orgId, acceptedAt: null } })
      : 0,
  }));
  const joinUrlBase = absoluteAppUrl("/join");
  const peopleTable = `/app/${orgSlug}/people?view=table`;

  return (
    <div className="max-w-3xl space-y-7.5">
      <PageHeader title="Members" />

      {canInvite && joinCode && (
        <SettingsCard
          title="Invite"
          id="code"
          action={
            <InviteDialog
              orgId={orgId}
              orgSlug={orgSlug}
              link={{
                code: joinCode.code,
                enabled: joinCode.enabled,
                url: `${joinUrlBase}/${joinCode.code}`,
              }}
              trigger={
                <Button variant="create">
                  <UserPlus aria-hidden="true" />
                  Invite people
                </Button>
              }
            />
          }
          description={
            <>
              Roles, titles and {pending > 0 ? `${pending} waiting invites` : "invites"} are on{" "}
              <Link href={peopleTable} className="text-foreground underline underline-offset-4">
                People
              </Link>
              .
            </>
          }
        >
          <JoinCodeCard
            orgId={orgId}
            joinUrlBase={joinUrlBase}
            initial={{
              code: joinCode.code,
              enabled: joinCode.enabled,
              allowedDomain: joinCode.allowedDomain,
              useCount: joinCode.useCount,
            }}
          />
        </SettingsCard>
      )}

      {!canInvite && (
        <p className="text-muted-foreground text-sm">
          Everyone in {organization.name} is on{" "}
          <Link
            href={`/app/${orgSlug}/people`}
            className="text-foreground underline underline-offset-4"
          >
            People
          </Link>
          .
        </p>
      )}

      <LeaveOrgCard
        orgId={orgId}
        orgName={organization.name}
        isLastOwner={role === Role.OWNER && ownerCount <= 1}
      />
    </div>
  );
}
