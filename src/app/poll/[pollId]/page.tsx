import { cookies } from "next/headers";

import { getPollSource } from "@/app/app/[orgSlug]/calendar/queries";
import { PollResponder } from "@/components/calendar/poll-responder";
import { getSession } from "@/lib/auth/session";
import { guestCookieName, hashGuestKey, isWellFormedGuestKey } from "@/lib/polls/guest-key";
import { buildPollView, type PollViewer } from "@/lib/polls/poll-view";
import { prisma } from "@/lib/prisma";

export default async function PublicPollPage({ params }: PageProps<"/poll/[pollId]">) {
  const { pollId } = await params;

  const poll = await getPollSource(pollId);
  if (!poll) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-muted-foreground text-sm">
          This poll doesn&apos;t exist or was removed.
        </p>
      </div>
    );
  }

  // Members of the poll's org answer as themselves; everyone else, signed in
  // or not, answers as a guest (0A Fix 6).
  const session = await getSession();
  const isMember = session
    ? Boolean(
        await prisma.membership.findUnique({
          where: {
            userId_organizationId: { userId: session.user.id, organizationId: poll.organizationId },
          },
          select: { userId: true },
        }),
      )
    : false;

  let viewer: PollViewer;
  if (session && isMember) {
    viewer = { kind: "member", userId: session.user.id };
  } else {
    const guestKey = (await cookies()).get(guestCookieName(poll.id))?.value;
    viewer = {
      kind: "guest",
      guestKeyHash: isWellFormedGuestKey(guestKey) ? hashGuestKey(guestKey) : null,
    };
  }

  // Only the stripped DTO reaches the client: no user ids, emails or keys.
  const view = buildPollView(poll, viewer);

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 p-6">
      <p className="text-muted-foreground mb-4 text-xs">
        Organizers: finalize this poll from the Calendar &gt; Availability polls page in the app.
      </p>
      {session && !isMember && (
        <p className="text-muted-foreground mb-4 text-sm">
          You&apos;re signed in, but not a member of the organization running this poll, so
          you&apos;ll answer as a guest.
        </p>
      )}
      <PollResponder poll={view} respondAs={viewer.kind} canFinalize={false} />
    </div>
  );
}
