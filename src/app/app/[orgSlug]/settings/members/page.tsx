import { notFound } from "next/navigation";

import { Role } from "@/generated/prisma/client";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { requireOrgMembership, type OrgContext } from "@/lib/auth/guards";
import { canManageMembers } from "@/lib/auth/member-roles";
import { prisma } from "@/lib/prisma";

import { MemberRowActions } from "./member-row-actions";

export default async function MembersPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/members">) {
  const { orgSlug } = await params;

  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) {
    notFound();
  }

  let ctx: OrgContext;
  try {
    ctx = await requireOrgMembership(org.id);
  } catch (error) {
    handleAuthErrorInPage(error);
  }

  const canManage = canManageMembers(ctx.role);

  const memberships = await prisma.membership.findMany({
    where: { organizationId: org.id },
    include: { user: true },
    orderBy: { joinedAt: "asc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <p className="text-muted-foreground text-sm">
          {memberships.length} member{memberships.length === 1 ? "" : "s"}
        </p>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Joined</TableHead>
              {canManage && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {memberships.map((membership) => {
              const displayName = membership.user.name ?? membership.user.email;
              const isSelf = membership.userId === ctx.user.id;
              return (
                <TableRow key={membership.userId}>
                  <TableCell>
                    <div className="font-medium">{displayName}</div>
                    <div className="text-muted-foreground text-xs">{membership.user.email}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={membership.role === Role.OWNER ? "default" : "secondary"}>
                      {membership.role.charAt(0) + membership.role.slice(1).toLowerCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {membership.joinedAt.toLocaleDateString()}
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      {!isSelf && (
                        <MemberRowActions
                          orgId={org.id}
                          userId={membership.userId}
                          currentRole={membership.role}
                          memberName={displayName}
                          viewerRole={ctx.role}
                        />
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
