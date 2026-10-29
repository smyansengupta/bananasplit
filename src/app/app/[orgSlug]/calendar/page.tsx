import { CalendarClock, CalendarSync, Video } from "@/components/icons";
import Link from "next/link";

import { EventCalendar, type CalendarItem } from "@/components/calendar/event-calendar";
import { NewEventButton } from "@/components/calendar/new-event-button";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { spaceIncludes } from "@/lib/billing/space";
import {
  addDaysToKey,
  allDaySpan,
  safeTimeZone,
  zonedDateKey,
  zonedMidnight,
} from "@/lib/calendar/dates";
import { weekWindowFor } from "@/lib/calendar/grid";
import { parseCalendarRange } from "@/lib/calendar/range";
import { meetingTypeColor, parseMeetingTypes } from "@/lib/meetings/meeting-types";
import { DEFAULT_REMINDER_MINUTES } from "@/lib/meetings/reminders";
import { sectionLabel } from "@/lib/nav/sidebar";

import { dueDateKey, fromDateKey } from "@/lib/tasks/dates";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { getOrgMembersForPicker } from "@/server/members";
import { getCalendarTasks } from "@/server/tasks/queries";

import { getEventsInRange, getViewerRsvps, rangeWhere } from "./queries";

/**
 * The org calendar. The server reads only the visible window (the view puts
 * it in ?from=&to=; see src/lib/calendar/range.ts), with the kind and
 * visibility filters, and hands the grid a small summary per event. Editing
 * (create, drag, edit, delete) is offered only to OWNER/ADMIN; members see
 * the calendar and RSVP.
 *
 * Tasks' due dates show on their days too (the Tasks filter turns them off,
 * ?tasks=0): this is the one calendar, for meetings and for work. Each is
 * a task the viewer can see, and opens it.
 */
export default async function CalendarPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/calendar">) {
  const { orgSlug } = await params;
  const { organization: org, user, role, settings } = await getOrgContextBySlug(orgSlug);
  // A new event starts with the organization's reminders (Settings > General).
  const defaultReminderMinutes = settings?.meetingReminderMinutes ?? [...DEFAULT_REMINDER_MINUTES];
  const range = parseCalendarRange(await searchParams, org.timezone);
  const canManage = can({ role }, "events.write");
  // The Tasks layer is one of the task views; Google sync a data connection.
  const tasksLayer = spaceIncludes(org, "taskViews");

  // The header's live line counts this week (Sunday first, in the club's
  // zone), whatever window the grid is showing.
  const zone = safeTimeZone(org.timezone);
  const todayKey = zonedDateKey(new Date(), zone);
  const week = weekWindowFor(todayKey);

  const { events, rsvps, tasks, thisWeek } = await withOrgTx(org.id, async ({ db }) => {
    const found = await getEventsInRange(db, org.id, {
      from: range.from,
      to: range.to,
      kinds: range.kinds,
      visibility: range.visibility,
    });
    return {
      events: found,
      rsvps: await getViewerRsvps(
        db,
        org.id,
        user.id,
        found.map((e) => e.id),
      ),
      // A kind filter is about events; tasks stay out while one is on.
      tasks:
        tasksLayer && range.tasks && range.kinds.length === 0
          ? await getCalendarTasks(db, org.id, {
              dueFrom: fromDateKey(range.fromKey),
              dueTo: fromDateKey(addDaysToKey(range.toKey, -1)),
            })
          : [],
      thisWeek: await db.event.count({
        where: rangeWhere(org.id, {
          from: zonedMidnight(week.fromKey, zone),
          to: zonedMidnight(week.toKey, zone),
        }),
      }),
    };
  });
  const members = canManage ? await getOrgMembersForPicker(org.id) : [];

  const meetingTypes = parseMeetingTypes(settings?.eventTypes);
  const items: CalendarItem[] = events.map((e) => {
    const shared = {
      id: e.id,
      title: e.title,
      kind: e.kind,
      typeColor: meetingTypeColor(meetingTypes, e.meetingType),
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
    return {
      ...shared,
      start: e.startsAt.toISOString(),
      end: e.endsAt.toISOString(),
      allDay: false,
    };
  });
  for (const t of tasks) {
    if (!t.dueDate) continue;
    const day = dueDateKey(t.dueDate);
    items.push({
      id: t.id,
      title: t.title,
      start: day,
      end: addDaysToKey(day, 1),
      allDay: true,
      kind: "OTHER",
      visibility: "INTERNAL",
      location: null,
      syncState: "NOT_APPLICABLE",
      needsReview: false,
      rsvp: null,
      task: { done: t.status === "COMPLETED" },
    });
  }

  return (
    <div className="space-y-7">
      <PageHeader
        title={sectionLabel(settings?.sidebar, "calendar")}
        description={
          thisWeek === 0
            ? "Nothing scheduled this week"
            : `${thisWeek} ${thisWeek === 1 ? "event" : "events"} this week`
        }
        actions={
          <>
            {/* Planning a meeting starts here as often as from the sidebar. */}
            {/* On a phone New event (last here) moves to the top right; the rest is in the menu. */}
            {spaceIncludes(org, "polls") && (
              <Button variant="outline" className="max-md:hidden" asChild>
                <Link href={`/app/${orgSlug}/calendar/find-a-time/new`}>
                  <CalendarClock aria-hidden="true" />
                  Find a time
                </Link>
              </Button>
            )}
            {can({ role }, "events.write") && (
              <Button variant="outline" className="max-md:hidden" asChild>
                <Link href={`/app/${orgSlug}/meetings`}>
                  <Video aria-hidden="true" />
                  Meetings
                </Link>
              </Button>
            )}
            {can({ role }, "integrations.view") && spaceIncludes(org, "integrations") && (
              <Button variant="outline" size="icon" className="max-md:hidden" asChild>
                <Link
                  href={`/app/${orgSlug}/calendar/sync`}
                  aria-label="Google Calendar sync and website feed"
                  title="Google Calendar sync and website feed"
                >
                  <CalendarSync className="size-[18px]" aria-hidden="true" />
                </Link>
              </Button>
            )}
            {canManage && <NewEventButton />}
          </>
        }
      />
      <EventCalendar
        orgId={org.id}
        orgSlug={orgSlug}
        timeZone={org.timezone}
        defaultReminderMinutes={defaultReminderMinutes}
        meetingTypes={meetingTypes}
        items={items}
        members={members.map((m) => ({
          id: m.id,
          name: m.name,
          image: m.image,
          avatar: m.avatar,
          title: m.title,
        }))}
        canManage={canManage}
        orgTodayKey={todayKey}
        window={{
          fromKey: range.fromKey,
          toKey: range.toKey,
          view: range.view,
          kinds: range.kinds,
          visibility: range.visibility,
          tasks: tasksLayer && range.tasks,
        }}
        tasksLayer={tasksLayer}
      />
    </div>
  );
}
