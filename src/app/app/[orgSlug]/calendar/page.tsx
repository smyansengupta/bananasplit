import { notFound } from "next/navigation";
import Link from "next/link";

import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { requireOrgMembership } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { EventCalendar } from "@/components/calendar/event-calendar";
import { Button } from "@/components/ui/button";

import { getOrgEvents, getOrgMembersForPicker } from "./queries";

export default async function CalendarPage({ params }: PageProps<"/app/[orgSlug]/calendar">) {
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

  const [events, memberships] = await Promise.all([
    getOrgEvents(org.id),
    getOrgMembersForPicker(org.id),
  ]);
  const members = memberships.map((m) => ({
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    image: m.user.image,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
        <Button variant="outline" asChild>
          <Link href={`/app/${orgSlug}/calendar/polls`}>Availability polls</Link>
        </Button>
      </div>
      <EventCalendar orgId={org.id} orgSlug={orgSlug} events={events} members={members} />
    </div>
  );
}
