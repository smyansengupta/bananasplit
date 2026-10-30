import { redirect } from "next/navigation";

import { TableFrame } from "@/components/databases/table-frame";
import { JoinCodeCard } from "@/components/onboarding/join-code-card";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UserAvatar } from "@/components/user-avatar";
import { Role } from "@/generated/prisma/enums";
import { absoluteAppUrl } from "@/lib/app-url";
import { canActOnMember } from "@/lib/auth/member-roles";
import { assignableRoles, can } from "@/lib/auth/permissions";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { userPublicSelect } from "@/server/members";
import { getOrCreateJoinCode } from "@/server/onboarding/join-code";

import { SettingsCard } from "../settings-card";
import { InviteForm } from "./invite-form";
import { LeaveOrgCard } from "./leave-org-card";
import { MemberRowActions } from "./member-row-actions";
import { PendingInvites, type PendingInviteRow } from "./pending-invites";

function roleLabel(role: Role) {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

/** Request-time check, outside the render body (react-hooks/purity). */
function isPast(date: Date): boolean {
  return date.getTime() <= Date.now();
}

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/**
 * Settings > Members: the roster (everyone), invitations (OWNER/ADMIN) and
 * leaving. Emails are shown to OWNER/ADMIN always, and to members only when
 * Privacy > "Members see each other's emails" is on: the email column is not
 * even selected otherwise.
 */
export default async function MembersPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/members">) {
  const { orgSlug } = await params;
  const { organization, role, user, settings } = await getOrgContextBySlug(orgSlug);
  // A Personal space has one member and no invitations or join code.
  if (organization.kind === "PERSONAL") redirect(`/app/${organization.slug}/settings`);
  const orgId = organization.id;
  const canManage = can({ role }, "members.changeRole");
  const canInvite = can({ role }, "members.invite");
  const showEmails =
    can({ role }, "members.viewEmails") || Boolean(settings?.showMemberEmailsToMembers);

  const { members, invites, joinCode } = await withOrgTx(orgId, async ({ db }) => {
    const members = await db.membership.findMany({
      where: { organizationId: orgId },
      orderBy: { joinedAt: "asc" },
      select: {
        userId: true,
        role: true,
        title: true,
        joinedAt: true,
        user: { select: { ...userPublicSelect, email: showEmails } },
      },
    });
    const invites = canInvite
      ? await db.invitation.findMany({
          where: { organizationId: orgId, acceptedAt: null },
          orderBy: { createdAt: "desc" },
          take: 100,
          select: {
            id: true,
            email: true,
            role: true,
            expiresAt: true,
            createdAt: true,
            invitedBy: { select: { name: true } },
          },
        })
      : [];
    // The shareable invite code, made the first time an admin opens this page.
    const joinCode = canInvite ? await getOrCreateJoinCode(db, orgId, user.id) : null;
    return { members, invites, joinCode };
  });

  const inviteRows: PendingInviteRow[] = invites.map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    expiresAt: i.expiresAt.toISOString(),
    expired: isPast(i.expiresAt),
    invitedByName: i.invitedBy.name,
  }));
  const ownerCount = members.filter((m) => m.role === Role.OWNER).length;
  const selfRole = role;
  const pendingCount = inviteRows.filter((i) => !i.expired).length;
  const expiredCount = inviteRows.length - pendingCount;
  const summary = [
    `${members.length} member${members.length === 1 ? "" : "s"}`,
    canInvite && pendingCount > 0
      ? `${pendingCount} invite${pendingCount === 1 ? "" : "s"} pending`
      : null,
    canInvite && expiredCount > 0 ? `${expiredCount} expired` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-7.5">
      <PageHeader title="Members" description={summary} />

      <TableFrame maxHeight="none">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="hidden sm:table-cell">Joined</TableHead>
              {canManage && (
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => {
              const email = "email" in m.user ? (m.user.email as string | undefined) : undefined;
              const displayName = m.user.name ?? email ?? "Member";
              const isSelf = m.userId === user.id;
              const actOnRow = canActOnMember(role, m.role);
              return (
                <TableRow key={m.userId}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <UserAvatar user={{ ...m.user, email }} size="md" />
                      <div className="min-w-0">
                        <div className="truncate font-semibold">
                          {displayName}
                          {isSelf && (
                            <span className="text-muted-foreground ml-1.5 text-[13px] font-normal">
                              (you)
                            </span>
                          )}
                        </div>
                        {email && (
                          <div className="text-muted-foreground truncate text-[13px]">{email}</div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {m.title ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={m.role === Role.OWNER ? "accent" : "secondary"}>
                      {roleLabel(m.role)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden sm:table-cell">
                    {dateFormat.format(m.joinedAt)}
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <MemberRowActions
                        orgId={orgId}
                        userId={m.userId}
                        memberName={displayName}
                        currentRole={m.role}
                        currentTitle={m.title}
                        isSelf={isSelf}
                        viewerRole={selfRole}
                        canActOnRow={actOnRow && !isSelf}
                        roleOptions={assignableRoles(role)}
                        canEditTitle={isSelf || actOnRow}
                        canTransfer={can({ role }, "members.transferOwnership") && !isSelf}
                      />
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableFrame>

      {canInvite && (
        <div className="grid items-start gap-4.5 xl:grid-cols-2">
          <InviteForm orgId={orgId} />
          <PendingInvites orgId={orgId} invites={inviteRows} />
        </div>
      )}

      {joinCode && (
        <SettingsCard
          title="Invite code"
          description={`Share it with your members instead of emailing each one. They enter it after setting up their profile, and see ${organization.name}'s name before they join.`}
        >
          <JoinCodeCard
            orgId={orgId}
            joinUrlBase={absoluteAppUrl("/join")}
            initial={{
              code: joinCode.code,
              enabled: joinCode.enabled,
              allowedDomain: joinCode.allowedDomain,
              useCount: joinCode.useCount,
            }}
          />
        </SettingsCard>
      )}

      <LeaveOrgCard
        orgId={orgId}
        orgName={organization.name}
        isLastOwner={role === Role.OWNER && ownerCount <= 1}
      />
    </div>
  );
}
