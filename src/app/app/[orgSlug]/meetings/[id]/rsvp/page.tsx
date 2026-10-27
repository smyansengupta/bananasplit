import { notFound, redirect } from "next/navigation";

import { RsvpManager } from "@/components/rsvp/rsvp-manager";
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
}: PageProps<"/app/[orgSlug]/meetings/[id]/rsvp">) {
  const { orgSlug, id } = await params;
  const ctx = await getOrgContextBySlug(orgSlug);
  // Members see the meeting itself (and its public link there).
  if (!can(ctx, "events.write")) redirect(`/app/${orgSlug}/meetings/${id}`);
  const { organization: org } = ctx;

  const data = await withOrgTx(org.id, ({ db }) => loadRsvpManager(db, org.id, id, org.timezone));
  if (!data) notFound();
  const mail = await resolveOrgMailRouting(org.id);
  const base = `/app/${orgSlug}/meetings/${id}`;

  return (
    <RsvpManager
      {...data.props}
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
