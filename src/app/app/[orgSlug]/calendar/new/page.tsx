import { notFound } from "next/navigation";

import { EventFormPage } from "@/components/calendar/event-form-page";
import type { MeetingShape } from "@/components/calendar/event-form-dialog";
import { PageHeader } from "@/components/page-header";
import { can } from "@/lib/auth/permissions";
import { sectionLabel } from "@/lib/nav/sidebar";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { listEventTags } from "@/server/events/tags";
import { getOrgMembersForPicker } from "@/server/members";

/**
 * New event, a page of its own.
 *
 * Making an event used to be a dialog laid over whichever page you pressed
 * the button on — the Calendar with a `?new=` on the end of it. That made
 * the one thing you came to do a submenu of something else: the grid kept
 * rendering behind the glass, the form had a dialog's width to say what an
 * event is, and leaving it put you on the calendar whether or not that was
 * where you started.
 *
 * `?rsvp=1` arrives from Meetings' Create new event and starts with the
 * public sign-up page switched on; `?shape=online` from New meeting.
 */
export default async function NewEventPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/calendar/new">) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContextBySlug(orgSlug);
  const { organization: org } = ctx;
  if (!can(ctx, "events.write")) notFound();

  const [members, tags] = await Promise.all([
    getOrgMembersForPicker(org.id),
    withOrgTx(org.id, ({ db }) => listEventTags(db, org.id)),
  ]);

  const rsvp = sp.rsvp === "1";
  const shapeParam = typeof sp.shape === "string" ? sp.shape.toUpperCase() : null;
  const shape: MeetingShape | undefined =
    shapeParam === "ONLINE" ? "ONLINE" : shapeParam === "IN_PERSON" ? "IN_PERSON" : undefined;
  // Back to wherever the button was: Meetings sends `from=meetings`, so
  // Cancel returns there instead of landing you on the calendar.
  const from = typeof sp.from === "string" ? sp.from : null;
  const backHref =
    from === "meetings" ? `/app/${orgSlug}/meetings` : `/app/${orgSlug}/calendar`;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-7">
      <PageHeader
        title="New event"
        description={
          rsvp
            ? "A title and a time are all it takes. You'll set the spots, cover and privacy for the sign-up page next."
            : "A title and a time are all it takes. Everything else has a sensible default."
        }
      />
      {/*
        overflow-hidden: the footer band inside the form runs the full width
        of this card with square corners of its own, so without it the card
        loses its rounded bottom. Every menu and date picker in the form is
        a portal, so nothing real is clipped.
      */}
      <div className="bg-card text-card-foreground edge rounded-card overflow-hidden px-5 pt-6 sm:px-7 sm:pt-7">
        <EventFormPage
          orgId={org.id}
          timeZone={org.timezone}
          members={members}
          tags={tags}
          defaultRsvpPage={rsvp}
          defaultShape={shape}
          backHref={backHref}
          cancelLabel={
            from === "meetings" ? `Back to ${sectionLabel(ctx.settings?.sidebar, "meetings")}` : "Cancel"
          }
        />
      </div>
    </div>
  );
}
