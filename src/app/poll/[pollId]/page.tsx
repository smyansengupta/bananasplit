import { cookies } from "next/headers";

import { getPollSource } from "@/app/app/[orgSlug]/calendar/queries";
import { PollResponder } from "@/components/calendar/poll-responder";
import { getSession } from "@/lib/auth/session";
import { guestCookieName, hashGuestKey, isWellFormedGuestKey } from "@/lib/polls/guest-key";
import { buildPollView, type PollViewer } from "@/lib/polls/poll-view";
import { withSystemOrgTx } from "@/server/db/context";

import { pollOrgId } from "./poll-org";

function Missing() {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <p className="text-muted-foreground text-sm">This poll doesn&apos;t exist or was removed.</p>
    </div>
  );
}

/**
 * The public poll page (anyone with the link). Reads run on the service
 * path scoped to the poll's org; only the stripped PollView DTO reaches the
 * client (no user ids, emails or guest keys).
 */
export default async function PublicPollPage({ params }: PageProps<"/poll/[pollId]">) {
  const { pollId } = await params;
  const organizationId = await pollOrgId(pollId);
  if (!organizationId) return <Missing />;

  const session = await getSession();
  const userId = session?.user.id ?? null;
  const loaded = await withSystemOrgTx(organizationId, async ({ db }) => {
    const poll = await getPollSource(db, organizationId, pollId);
    const isMember = userId
      ? (await db.membership.count({ where: { organizationId, userId } })) > 0
      : false;
    return { poll, isMember };
  });
  const { poll, isMember } = loaded;
  if (!poll) return <Missing />;

  // Members of the poll's org answer as themselves; everyone else, signed in
  // or not, answers as a guest (0A Fix 6).
  let viewer: PollViewer;
  if (userId && isMember) {
    viewer = { kind: "member", userId };
  } else {
    const guestKey = (await cookies()).get(guestCookieName(poll.id))?.value;
    viewer = {
      kind: "guest",
      guestKeyHash: isWellFormedGuestKey(guestKey) ? hashGuestKey(guestKey) : null,
    };
  }

  const view = buildPollView(poll, viewer);

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 p-6">
      <p className="text-muted-foreground mb-4 text-xs">
        Organizers: an admin finalizes this poll from Calendar &gt; Availability polls in the app.
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
