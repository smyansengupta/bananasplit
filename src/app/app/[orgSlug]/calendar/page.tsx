import Link from "next/link";

import { EventCalendar, type CalendarItem } from "@/components/calendar/event-calendar";
import { CalendarShotButton } from "@/components/ai/calendar-shot-button";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { allDaySpan, safeTimeZone, zonedDateKey } from "@/lib/calendar/dates";
import { parseCalendarRange } from "@/lib/calendar/range";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { getOrgMembersForPicker } from "@/server/members";

import { getEventsInRange, getViewerRsvps } from "./queries";

/**
 * The org calendar. The server reads only the visible window (the view puts
 * it in ?from=&to=; see src/lib/calendar/range.ts), with the kind and
 * visibility filters, and hands the grid a small summary per event. Editing
 * (create, drag, edit, delete) is offered only to OWNER/ADMIN; members see
 * the calendar and RSVP.
 */
export default async function CalendarPage({ params, searchParams }: PageProps<"/app/[orgSlug]/calendar">) {
  const { orgSlug } = await params;
  const { organization: org, user, role } = await getOrgContextBySlug(orgSlug);
  const range = parseCalendarRange(await searchParams, org.timezone);
  const canManage = can({ role }, "events.write");

  const { events, rsvps } = await withOrgTx(org.id, async ({ db }) => {
    const found = await getEventsInRange(db, org.id, {
      from: range.from,
      to: range.to,
      kinds: range.kinds,
      visibility: range.visibility,
    });
    return { events: found, rsvps: await getViewerRsvps(db, org.id, user.id, found.map((e) => e.id)) };
  });
  const members = canManage ? await getOrgMembersForPicker(org.id) : [];

  const items: CalendarItem[] = events.map((e) => {
    const shared = {
      id: e.id,
      title: e.title,
      kind: e.kind,
      visibility: e.visibility,
      location: e.location,
      syncState: e.googleSyncState,
      needsReview: e.needsReview,
      rsvp: rsvps.get(e.id) ?? null,
    };
    if (e.allDay) {
      const span = allDaySpan(e.startsAt, e.endsAt, org.timezone);
      return { ...shared, start: span.start, end: span.endExclusive, allDay: true };
    }
    return { ...shared, start: e.startsAt.toISOString(), end: e.endsAt.toISOString(), allDay: false };
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Calendar</h1>
        <div className="flex flex-wrap gap-2">
          {can({ role }, "events.write") && <CalendarShotButton orgId={org.id} orgSlug={orgSlug} />}
          <Button variant="outline" size="sm" asChild>
            <Link href={`/app/${orgSlug}/calendar/polls`}>Polls</Link>
          </Button>
          {can({ role }, "integrations.view") && (
            <Button variant="outline" size="sm" asChild>
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
        orgTodayKey={zonedDateKey(new Date(), safeTimeZone(org.timezone))}
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
