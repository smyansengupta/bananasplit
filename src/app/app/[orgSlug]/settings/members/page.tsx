import { UserPlus } from "@/components/icons";
import { redirect } from "next/navigation";

import { JoinCodeCard } from "@/components/onboarding/join-code-card";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Role } from "@/generated/prisma/enums";
import { inviteReason, roleFix, staleInviteDays } from "@/lib/ambient/people";
import { absoluteAppUrl } from "@/lib/app-url";
import { can } from "@/lib/auth/permissions";
import { INVITATION_EXPIRY_DAYS } from "@/lib/invitations";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { getOrCreateJoinCode } from "@/server/onboarding/join-code";
import { loadChartForPeople, loadDirectory } from "@/server/profiles/directory";

import { SettingsCard } from "../settings-card";
import { InviteDialog } from "./invite-dialog";
import { LeaveOrgCard } from "./leave-org-card";
import { MembersRoster } from "./members-roster";

/** Request-time check, outside the render body (react-hooks/purity). */
function isPast(date: Date): boolean {
  return date.getTime() <= Date.now();
}

/** Resend invite's reason, once an invite has waited three days since its last send. */
function staleReason(expiresAt: Date): string | undefined {
  const sentAt = new Date(expiresAt.getTime() - INVITATION_EXPIRY_DAYS * 86_400_000);
  const days = staleInviteDays(sentAt.toISOString(), new Date());
  return days === null ? undefined : inviteReason(days);
}

/**
 * Admin panel › Members: one Invite card (Invite people and the join code,
 * OWNER/ADMIN), the roster (everyone, with emails as far as the viewer may
 * see them; owners and admins edit roles and titles in place and see the
 * invites still waiting as rows), then Leave. People is the directory;
 * this is where membership is managed.
 */
export default async function MembersPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/members">) {
  const { orgSlug } = await params;
  const { organization, role, user, settings } = await getOrgContextBySlug(orgSlug);
  // A Personal space has one member and no invitations or join code.
  if (organization.kind === "PERSONAL") redirect(`/app/${organization.slug}/settings`);
  const orgId = organization.id;
  const canInvite = can({ role }, "members.invite");
  const showEmails =
    can({ role }, "members.viewEmails") || settings?.showMemberEmailsToMembers === true;

  const [{ ownerCount, joinCode, emailRows, inviteRows, chart }, directory] = await Promise.all([
    withOrgTx(orgId, async ({ db }) => ({
      ownerCount: await db.membership.count({
        where: { organizationId: orgId, role: Role.OWNER },
      }),
      joinCode: canInvite ? await getOrCreateJoinCode(db, orgId, user.id) : null,
      emailRows: showEmails
        ? await db.membership.findMany({
            where: { organizationId: orgId },
            select: { userId: true, user: { select: { email: true } } },
          })
        : [],
      inviteRows: canInvite
        ? await db.invitation.findMany({
            where: { organizationId: orgId, acceptedAt: null },
            orderBy: { createdAt: "desc" },
            take: 100,
            select: { id: true, email: true, role: true, expiresAt: true },
          })
        : [],
      // Seats on the published chart, for Fix role (owners and admins).
      chart: can({ role }, "members.changeRole") ? await loadChartForPeople(db, orgId) : null,
    })),
    loadDirectory(orgId, organization.timezone),
  ]);
  const joinUrlBase = absoluteAppUrl("/join");
  const emails = Object.fromEntries(
    emailRows.filter((m) => m.user.email).map((m) => [m.userId, m.user.email as string]),
  );
  const invites = inviteRows.map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    expiresAt: i.expiresAt.toISOString(),
    expired: isPast(i.expiresAt),
    stale: staleReason(i.expiresAt),
  }));
  // Fix role: someone whose role gives less than their seat needs.
  const roleFixes: Record<string, { to: Role; reason: string }> = {};
  if (chart) {
    for (const p of directory.people) {
      const seats = chart.positions
        .filter((s) => s.userId === p.id)
        .map((s) => ({ title: s.title, top: !s.reportsToId, isAdvisor: s.isAdvisor }));
      const fix = seats.length > 0 ? roleFix(p.role, seats) : null;
      if (fix) roleFixes[p.id] = { to: fix.to, reason: fix.reason };
    }
  }

  return (
    <div className="space-y-7.5">
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
            invites.length > 0
              ? `${invites.length} ${invites.length === 1 ? "invite is" : "invites are"} waiting, at the end of the roster below.`
              : undefined
          }
          className="max-w-3xl"
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

      <section
        id="roster"
        aria-label="Roster"
        className="bg-card edge rounded-card min-w-0 scroll-mt-6 p-[18px] sm:p-6"
      >
        <MembersRoster
          orgId={orgId}
          orgSlug={orgSlug}
          viewerId={user.id}
          people={directory.people}
          emails={emails}
          invites={invites}
          roleFixes={roleFixes}
          access={{
            role: role ?? "MEMBER",
            canManage: can({ role }, "members.changeRole"),
            canInvite,
            canTransfer: can({ role }, "members.transferOwnership"),
          }}
        />
      </section>

      <div className="max-w-3xl">
        <LeaveOrgCard
        orgId={orgId}
        orgName={organization.name}
          isLastOwner={role === Role.OWNER && ownerCount <= 1}
        />
      </div>
    </div>
  );
}
