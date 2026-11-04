import { redirect } from "next/navigation";

/**
 * Door mode moved with the rest of sign-up management, under the meeting
 * (docs/features/meetings.md). The old path forwards, because a host who
 * bookmarked door mode still has it. The page it forwards to checks that the
 * visitor can edit the event.
 */
export default async function DoorMoved({
  params,
}: PageProps<"/app/[orgSlug]/calendar/[eventId]/rsvp/door">) {
  const { orgSlug, eventId } = await params;
  redirect(`/app/${orgSlug}/meetings/${eventId}/rsvp/door`);
}
