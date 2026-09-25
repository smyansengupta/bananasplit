import Link from "next/link";

import { EventCalendar, type CalendarItem } from "@/components/calendar/event-calendar";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { allDaySpan } from "@/lib/calendar/dates";
import { parseCalendarRange } from "@/lib/calendar/range";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { getOrgMembersForPicker } from "@/server/members";

import { getEventsInRange } from "./queries";

/**
 * The org calendar. The server reads only the visible window (FullCalendar's
 * datesSet puts it in ?from=&to=; see src/lib/calendar/range.ts), with the
 * kind and visibility filters. Editing (create, drag, resize) is offered only
 * to OWNER/ADMIN; members see and RSVP.
 */
export default async function CalendarPage({ params, searchParams }: PageProps<"/app/[orgSlug]/calendar">) {
  const { orgSlug } = await params;
  const { organization: org, role } = await getOrgContextBySlug(orgSlug);
  const range = parseCalendarRange(await searchParams, org.timezone);
  const canManage = can({ role }, "events.write");

  const events = await withOrgTx(org.id, ({ db }) =>
    getEventsInRange(db, org.id, {
      from: range.from,
      to: range.to,
      kinds: range.kinds,
      visibility: range.visibility,
    }),
  );
  const members = canManage ? await getOrgMembersForPicker(org.id) : [];

  const items: CalendarItem[] = events.map((e) => {
    if (e.allDay) {
      const span = allDaySpan(e.startsAt, e.endsAt, org.timezone);
      return {
        id: e.id,
        title: e.title,
        start: span.start,
        end: span.endExclusive,
        allDay: true,
        kind: e.kind,
        visibility: e.visibility,
        syncState: e.googleSyncState,
        needsReview: e.needsReview,
      };
    }
    return {
      id: e.id,
      title: e.title,
      start: e.startsAt.toISOString(),
      end: e.endsAt.toISOString(),
      allDay: false,
      kind: e.kind,
      visibility: e.visibility,
      syncState: e.googleSyncState,
      needsReview: e.needsReview,
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href={`/app/${orgSlug}/calendar/polls`}>Availability polls</Link>
          </Button>
          {can({ role }, "integrations.view") && (
            <Button variant="outline" asChild>
              <Link href={`/app/${orgSlug}/calendar/sync`}>Sync and website feed</Link>
            </Button>
          )}
        </div>
      </div>
      <EventCalendar
        orgId={org.id}
        orgSlug={orgSlug}
        timeZone={org.timezone}
        items={items}
        members={members.map((m) => ({ id: m.id, name: m.name, image: m.image, avatar: m.avatar, title: m.title }))}
        canManage={canManage}
        window={{
          fromKey: range.fromKey,
          toKey: range.toKey,
          view: range.view,
          kinds: range.kinds,
          visibility: range.visibility,
        }}
      />
    </div>
  );
}
