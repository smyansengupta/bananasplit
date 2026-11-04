import { CalendarClock, Info } from "@/components/icons";
import { cookies } from "next/headers";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";

import { getPollMemberNames, getPollSource } from "@/app/app/[orgSlug]/calendar/queries";
import { PollResponder } from "@/components/calendar/poll-responder";
import { signInPath } from "@/lib/auth/callback-url";
import { getSession } from "@/lib/auth/session";
import { guestCookieName, hashGuestKey, isWellFormedGuestKey } from "@/lib/polls/guest-key";
import { buildPollView, type PollViewer } from "@/lib/polls/poll-view";
import { withSystemOrgTx } from "@/server/db/context";

import { pollOrgId } from "./poll-org";

function Missing() {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <EmptyState
        icon={CalendarClock}
        title="This poll isn't available"
        description="The link may be mistyped, or the poll was deleted. Ask whoever sent it for a new one."
        className="w-full max-w-md"
      />
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
    if (!poll) return { poll, isMember: false, memberNames: new Map<string, string>() };
    const isMember = userId
      ? (await db.membership.count({ where: { organizationId, userId } })) > 0
      : false;
    // Guests see who they're meeting: members by name, as in the app.
    const memberNames = await getPollMemberNames(db, organizationId, poll);
    return { poll, isMember, memberNames };
  });
  const { poll, isMember, memberNames } = loaded;
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

  const view = buildPollView(poll, viewer, { memberNames });
  const isOpen = !poll.finalizedEventId && !(poll.closesAt && poll.closesAt < new Date());

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      <PollResponder
        poll={view}
        respondAs={viewer.kind}
        canFinalize={false}
        notices={
          session && !isMember ? (
            <div className="bg-muted rounded-tile flex gap-2.5 p-3.5 text-sm" role="note">
              <Info aria-hidden className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              <p>
                You&apos;re signed in, but not a member of the organization running this poll, so
                you&apos;ll answer as a guest.
              </p>
            </div>
          ) : !session && isOpen ? (
            // Guests need nothing but a name. A member who isn't signed in
            // (an in-app link sends them here too) can sign in instead.
            <p className="text-muted-foreground text-sm">
              No account needed: add your name and mark when you&apos;re free.{" "}
              <Link
                href={signInPath(`/poll/${poll.id}`)}
                className="text-foreground underline-offset-4 hover:underline"
              >
                A member? Sign in
              </Link>{" "}
              to answer as yourself.
            </p>
          ) : undefined
        }
      />
    </div>
  );
}
