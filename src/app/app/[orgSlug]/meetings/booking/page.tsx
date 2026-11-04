import Link from "next/link";

import { BookingLinksView } from "@/components/booking/booking-links-view";
import { Plus } from "@/components/icons";
import { MeetingsTabs } from "@/components/meetings/meetings-tabs";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { spaceIncludes } from "@/lib/billing/space";
import { NEW_EVENT_PARAM } from "@/lib/calendar/range";
import { sectionLabel } from "@/lib/nav/sidebar";
import { timeZoneOptions } from "@/lib/timezones";
import { loadBookingLinks } from "@/server/booking/view";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { meetingsWhere } from "@/server/meetings/where";

export const metadata = { title: "Booking links" };

/**
 * Meetings > Booking links (docs/features/booking.md): Meetings' third
 * part, beside Meetings and Find a time.
 * - Your booking link: every member of every space has one (made the first
 *   time this opens). Fill in the times you're free; people pick one and
 *   it goes straight onto your calendar.
 * - The organization's links (with the CRM): shared links anyone here can
 *   send ("Coffee with the president"), with one named host or several
 *   taking turns. The CRM uses them too.
 * - Coming up: what's been booked (yours; every one for owners and admins),
 *   with Cancel, and Take it for one whose host left.
 * ?edit={id} opens a link's editor on arrival (the old CRM pages land here).
 */
export default async function BookingLinksPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/meetings/booking">) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const { organization: org, user, role, settings } = await getOrgContextBySlug(orgSlug);
  const isAdmin = can({ role }, "events.write");
  const now = new Date();
  const { data, members, pipelines, meetingCount, findOpen } = await withOrgTx(org.id, async (ctx) => {
    const data = await loadBookingLinks(ctx, now);
    const members = await ctx.db.membership.findMany({
      where: { organizationId: org.id },
      select: { userId: true, user: { select: { name: true } } },
      take: 2000,
    });
    const pipelines = data.access.orgLinks
      ? await ctx.db.crmPipeline.findMany({
          where: { organizationId: org.id, archivedAt: null },
          select: { id: true, name: true },
          orderBy: { createdAt: "asc" },
        })
      : [];
    const meetingCount = await ctx.db.event.count({
      where: { AND: [meetingsWhere(org.id, user.id, isAdmin, now), { endsAt: { gt: now } }] },
    });
    // Find a time polls still taking answers, for the tab's count (as on Meetings).
    const findOpen = await ctx.db.availabilityPoll.count({
      where: {
        organizationId: org.id,
        finalizedEventId: null,
        OR: [{ closesAt: null }, { closesAt: { gte: now } }],
      },
    });
    return {
      findOpen,
      data,
      members: members
        .map((m) => ({ id: m.userId, name: m.user.name ?? "Member" }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      pipelines,
      meetingCount,
    };
  });
  const edit = typeof sp.edit === "string" ? sp.edit : null;
  const upcoming = data.upcoming.length;
  return (
    <div className="space-y-7">
      <PageHeader
        title={sectionLabel(settings?.sidebar, "meetings")}
        description={
          upcoming > 0 ? `${upcoming} booked ${upcoming === 1 ? "meeting" : "meetings"} coming up` : undefined
        }
        // The same two as every Meetings tab: Find a time beside New meeting,
        // which opens the create form on Meetings (?new=1).
        actions={
          <>
            {spaceIncludes(org, "polls") && (
              <Button variant={isAdmin ? "outline" : "create"} asChild>
                <Link href={`/app/${orgSlug}/calendar/find-a-time/new`}>
                  <Plus aria-hidden="true" />
                  Find a time
                </Link>
              </Button>
            )}
            {isAdmin && (
              <Button variant="create" asChild>
                <Link href={`/app/${orgSlug}/meetings?${NEW_EVENT_PARAM}=1`}>
                  <Plus aria-hidden="true" />
                  New meeting
                </Link>
              </Button>
            )}
          </>
        }
      />
      <MeetingsTabs
        orgSlug={orgSlug}
        current="booking"
        counts={{ upcoming: meetingCount, find: findOpen }}
      />
      <BookingLinksView
        orgId={org.id}
        orgSlug={orgSlug}
        personalSpace={data.access.personal}
        orgLinksAllowed={data.access.orgLinks}
        crmOn={data.access.crm}
        isAdmin={data.isAdmin}
        mine={data.mine}
        orgLinks={data.org}
        upcoming={data.upcoming.map((b) => ({
          ...b,
          startsAt: b.startsAt.toISOString(),
          endsAt: b.endsAt.toISOString(),
        }))}
        members={members}
        pipelines={pipelines}
        timeZones={timeZoneOptions()}
        orgTimeZone={data.access.timezone}
        openOnArrival={edit}
      />
    </div>
  );
}
