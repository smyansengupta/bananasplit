import { notFound, redirect } from "next/navigation";

import { RsvpFullAmbient } from "@/components/meetings/meeting-ambient";
import { RsvpManager } from "@/components/rsvp/rsvp-manager";
import { eventAmbient } from "@/lib/ambient/calendar";
import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { resolveOrgMailRouting } from "@/server/email/mailer";
import { loadRsvpManager } from "@/server/rsvp/manage";
import { smsDelivery } from "@/server/sms";

/**
 * A meeting's public sign-up page, run from the suite: the guest list
 * (check-in, payments, moving people, adding them, CSV) and the page's
 * settings. Owners and admins only; RLS also limits the sign-ups (emails,
 * phones) to them.
 *
 * It lives under Meetings; the Calendar's old `/calendar/{id}/rsvp` forwards
 * here.
 */
export default async function MeetingRsvpPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/meetings/[id]/rsvp">) {
  const { orgSlug, id } = await params;
  // A page just made by the meeting form (?new=1) opens on its settings with the link copied.
  const { new: fresh } = await searchParams;
  const justCreated = (Array.isArray(fresh) ? fresh[0] : fresh) === "1";
  const ctx = await getOrgContextBySlug(orgSlug);
  // Members see the meeting itself (and its public link there).
  if (!can(ctx, "events.write")) redirect(`/app/${orgSlug}/meetings/${id}`);
  const { organization: org } = ctx;

  const data = await withOrgTx(org.id, ({ db }) => loadRsvpManager(db, org.id, id, org.timezone));
  if (!data) notFound();
  const mail = await resolveOrgMailRouting(org.id);
  const base = `/app/${orgSlug}/meetings/${id}`;
  // Full, and people still want in: Open a waitlist, Add seats.
  const { page, guests } = data.props;
  const full = eventAmbient(
    {
      startsAt: data.event.startsAt,
      endsAt: data.event.endsAt,
      timeZone: org.timezone,
      canEdit: true,
      rsvp: {
        enabled: page.enabled,
        url: page.url,
        going: guests.filter((g) => g.status === "GOING").length,
        waitlist: guests.filter((g) => g.status === "WAITLIST").length,
        capacity: page.settings.capacity,
        waitlistOn: page.settings.waitlist,
      },
      checkedIn: 0,
      thankedAt: null,
    },
    new Date(),
  ).filter((a) => a.kind === "open-waitlist" || a.kind === "add-seats");

  return (
    <RsvpManager
      {...data.props}
      justCreated={justCreated}
      ambient={
        full.length > 0 ? (
          <RsvpFullAmbient orgId={org.id} eventId={data.event.id} items={full} />
        ) : null
      }
      links={{
        back: { href: base, label: data.event.title },
        edit: `${base}?edit=1`,
        door: `${base}/rsvp/door`,
        flyer: `/e/${data.event.rsvpSlug}/flyer`,
      }}
      messaging={{
        email: mail.mode === "org" ? "org" : "platform",
        texts: smsDelivery() === "live",
      }}
    />
  );
}
