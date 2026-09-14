import { notFound } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NotificationType } from "@/generated/prisma/client";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { requireOrgMembership, type OrgContext } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

import { NotificationPreferences } from "./notification-preferences";

export default async function NotificationSettingsPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/notifications">) {
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

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: ctx.user.id },
    select: { emailPreferences: true },
  });
  const preferences =
    user.emailPreferences && typeof user.emailPreferences === "object"
      ? (user.emailPreferences as Record<string, boolean>)
      : {};

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Notification emails</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Email me when…</CardTitle>
          <CardDescription>
            These only control email. You&apos;ll always see these in the notification bell in the
            app.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NotificationPreferences
            types={Object.values(NotificationType)}
            initialPreferences={preferences}
          />
        </CardContent>
      </Card>
    </div>
  );
}
