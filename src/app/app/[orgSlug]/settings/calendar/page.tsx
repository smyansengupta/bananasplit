import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { requireOrgMembership } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

import { getIcsFeedActiveSince } from "./actions";
import { FeedUrlCard } from "./feed-url-card";

export default async function CalendarSettingsPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/calendar">) {
  const { orgSlug } = await params;

  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) {
    notFound();
  }

  try {
    await requireOrgMembership(org.id);
  } catch (error) {
    handleAuthErrorInPage(error);
  }

  // Only a hash of the token is stored, so an existing link cannot be shown
  // again: the page shows when it was created, and regenerating returns a
  // new URL once.
  const activeSince = await getIcsFeedActiveSince();
  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  const feedBaseUrl = `${protocol}://${host}/api/calendar/feed/`;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Calendar feed</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Subscribe from another calendar app</CardTitle>
          <CardDescription>
            Add this URL to Google Calendar, Apple Calendar, or Outlook to see every event
            you&apos;re invited to. Subscribed feeds are polled on the other app&apos;s own schedule
            — often hours behind — so treat this as a mirror, not a live view.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FeedUrlCard feedBaseUrl={feedBaseUrl} activeSince={activeSince?.toISOString() ?? null} />
        </CardContent>
      </Card>
    </div>
  );
}
