import { redirect } from "next/navigation";

/**
 * Sign-ups are run from the meeting (docs/features/meetings.md). The old path
 * still works, because hosts have pasted it into their own notes and messages.
 * It needs no permission check: the page it forwards to does its own, and
 * sends anyone who can't edit the event to the meeting itself.
 *
 * Only the new-page banner (?new=1) is carried across; anything else on the
 * old link is dropped.
 */
export default async function RsvpMoved({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/calendar/[eventId]/rsvp">) {
  const { orgSlug, eventId } = await params;
  const { new: fresh } = await searchParams;
  const isNew = (Array.isArray(fresh) ? fresh[0] : fresh) === "1";
  redirect(`/app/${orgSlug}/meetings/${eventId}/rsvp${isNew ? "?new=1" : ""}`);
}
