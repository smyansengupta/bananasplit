import { Mail, Tag, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Role } from "@/generated/prisma/client";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { requireOrgMembership, type OrgContext } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export default async function SettingsPage({ params }: PageProps<"/app/[orgSlug]/settings">) {
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

  const canManageMembers = ctx.role === Role.OWNER || ctx.role === Role.ADMIN;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href={`/app/${orgSlug}/settings/members`}>
          <Card className="hover:bg-accent/50 transition-colors">
            <CardHeader>
              <Users className="text-muted-foreground mb-2 size-5" aria-hidden="true" />
              <CardTitle className="text-sm font-medium">Members</CardTitle>
              <CardDescription>
                View the roster and, if you manage members, change roles.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        {canManageMembers && (
          <Link href={`/app/${orgSlug}/settings/invitations`}>
            <Card className="hover:bg-accent/50 transition-colors">
              <CardHeader>
                <Mail className="text-muted-foreground mb-2 size-5" aria-hidden="true" />
                <CardTitle className="text-sm font-medium">Invitations</CardTitle>
                <CardDescription>
                  Invite new members by email and manage pending invites.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        )}
        {canManageMembers && (
          <Link href={`/app/${orgSlug}/settings/labels`}>
            <Card className="hover:bg-accent/50 transition-colors">
              <CardHeader>
                <Tag className="text-muted-foreground mb-2 size-5" aria-hidden="true" />
                <CardTitle className="text-sm font-medium">Labels</CardTitle>
                <CardDescription>Manage the shared label palette used on tasks.</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        )}
      </div>
    </div>
  );
}
