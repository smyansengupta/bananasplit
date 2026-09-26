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
import { canActOnMember } from "@/lib/auth/member-roles";
import { assignableRoles, can } from "@/lib/auth/permissions";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { userPublicSelect } from "@/server/members";

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
  const orgId = organization.id;
  const canManage = can({ role }, "members.changeRole");
  const canInvite = can({ role }, "members.invite");
  const showEmails =
    can({ role }, "members.viewEmails") || Boolean(settings?.showMemberEmailsToMembers);

  const { members, invites } = await withOrgTx(orgId, async ({ db }) => {
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
    return { members, invites };
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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <p className="text-muted-foreground text-sm">
          {members.length} member{members.length === 1 ? "" : "s"}
          {canInvite && inviteRows.length > 0
            ? ` · ${inviteRows.length} invite${inviteRows.length === 1 ? "" : "s"} pending`
            : ""}
        </p>
      </div>

      {canInvite && (
        <section className="space-y-3 rounded-lg border p-4" aria-labelledby="invite-heading">
          <div>
            <h2 id="invite-heading" className="text-sm font-medium">
              Invite people
            </h2>
            <p className="text-muted-foreground text-xs">
              They get an email link that is valid for 7 days. They must sign in with the invited
              address, and verify it, to join.
            </p>
          </div>
          <InviteForm orgId={orgId} />
          <PendingInvites orgId={orgId} invites={inviteRows} />
        </section>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="hidden sm:table-cell">Joined</TableHead>
              {canManage && <TableHead className="text-right">Actions</TableHead>}
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
                        <div className="truncate font-medium">
                          {displayName}
                          {isSelf && (
                            <span className="text-muted-foreground ml-2 text-xs font-normal">
                              (you)
                            </span>
                          )}
                        </div>
                        {email && (
                          <div className="text-muted-foreground truncate text-xs">{email}</div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {m.title ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={m.role === Role.OWNER ? "default" : "secondary"}>
                      {roleLabel(m.role)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden text-sm sm:table-cell">
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
      </div>

      <LeaveOrgCard
        orgId={orgId}
        orgName={organization.name}
        isLastOwner={role === Role.OWNER && ownerCount <= 1}
      />
    </div>
  );
}
