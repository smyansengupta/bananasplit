import { redirect } from "next/navigation";

/**
 * The sign-up page used to live here, with a header and tabs of its own.
 * It is a section of the event now, so this only forwards: links in old
 * emails, bookmarks and anything still pointing at /rsvp land on the right
 * part of the event rather than on a page that no longer exists.
 */
export default async function EventRsvpRedirect({
  params,
}: PageProps<"/app/[orgSlug]/calendar/[eventId]/rsvp">) {
  const { orgSlug, eventId } = await params;
  redirect(`/app/${orgSlug}/calendar/${eventId}?tab=guests`);
}
