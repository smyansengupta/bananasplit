import { redirect } from "next/navigation";

/**
 * RSVPs became Meetings (docs/features/meetings.md). The old path still works,
 * because clubs have pasted it into their own notes and messages.
 */
export default async function RsvpsMoved({ params }: PageProps<"/app/[orgSlug]/calendar/rsvp">) {
  const { orgSlug } = await params;
  redirect(`/app/${orgSlug}/meetings`);
}
