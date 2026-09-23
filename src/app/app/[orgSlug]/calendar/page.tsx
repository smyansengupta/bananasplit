import { notFound } from "next/navigation";
import Link from "next/link";

import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { requireOrgMembership, type OrgContext } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { EventCalendar } from "@/components/calendar/event-calendar";
import { Button } from "@/components/ui/button";

import { canEditEvent, getOrgEvents, getOrgMembersForPicker } from "./queries";

export default async function CalendarPage({ params }: PageProps<"/app/[orgSlug]/calendar">) {
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
      <EventCalendar
        orgId={org.id}
        orgSlug={orgSlug}
        // Drag and resize only on events this viewer may edit (0A Fix 8).
        events={events.map((event) => ({
          ...event,
          editable: canEditEvent(event, { userId: ctx.user.id, role: ctx.role }),
        }))}
        members={members}
      />
    </div>
  );
}
