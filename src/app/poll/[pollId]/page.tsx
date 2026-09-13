import { getPollById } from "@/app/app/[orgSlug]/calendar/queries";
import { PollResponder } from "@/components/calendar/poll-responder";
import { getSession } from "@/lib/auth/session";

export default async function PublicPollPage({ params }: PageProps<"/poll/[pollId]">) {
  const { pollId } = await params;

  const poll = await getPollById(pollId);
  if (!poll) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-muted-foreground text-sm">
          This poll doesn&apos;t exist or was removed.
        </p>
      </div>
    );
  }

  const session = await getSession();

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 p-6">
      <p className="text-muted-foreground mb-4 text-xs">
        Organizers: finalize this poll from the Calendar &gt; Availability polls page in the app.
      </p>
      <PollResponder poll={poll} currentUserId={session?.user.id ?? null} canFinalize={false} />
    </div>
  );
}
