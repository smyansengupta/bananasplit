import { redirect } from "next/navigation";

import { BackLink } from "@/components/back-link";
import { PollResponder } from "@/components/calendar/poll-responder";
import { PickTimeAmbient } from "@/components/polls/pick-time-ambient";
import { PollResultsHero } from "@/components/polls/poll-results-hero";
import { timeForEveryone } from "@/lib/ambient/calendar";
import { can } from "@/lib/auth/permissions";
import { buildPollView } from "@/lib/polls/poll-view";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { planGate } from "@/server/billing/plan-gate";

import { getPollMemberNames, getPollSource } from "../../queries";
import { AvailabilityPollActions } from "./poll-actions";

/**
 * One find-a-time (availability) poll: mark when you're free, see everyone's
 * answers, and (owners and admins) schedule it. Any other id is handed to
 * Polls, which shows a question poll or a 404.
 */
export default async function FindATimePollPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/calendar/find-a-time/[pollId]">) {
  const { orgSlug, pollId } = await params;
  // From a card's "Book best time".
  const { book } = await searchParams;
  const bookBest = (Array.isArray(book) ? book[0] : book) === "1";
  const planLock = await planGate(orgSlug, "polls");
  if (planLock) return planLock;
  const { organization: org, user, role } = await getOrgContextBySlug(orgSlug);
  const loaded = await withOrgTx(org.id, async ({ db }) => {
    const poll = await getPollSource(db, org.id, pollId);
    if (!poll) return null;
    return { poll, memberNames: await getPollMemberNames(db, org.id, poll) };
  });
  if (!loaded) redirect(`/app/${orgSlug}/calendar/polls/${pollId}`);

  const { poll, memberNames } = loaded;
  // Finalizing creates an event, which is ADMIN+ (the event service).
  const canFinalize = can({ role }, "events.write");
  const canDelete = poll.createdById === user.id || canFinalize;
  const isOpen = !poll.finalizedEventId && !(poll.closesAt && poll.closesAt < new Date());

  const view = buildPollView(poll, { kind: "member", userId: user.id }, { memberNames });
  // One time works for everyone who answered: Pick it.
  const forAll =
    isOpen && canFinalize
      ? timeForEveryone(
          poll.slots,
          poll.responses.map((r) => ({
            slotId: r.slotId,
            who: r.userId ?? r.guestKeyHash ?? `guest:${r.guestName ?? ""}`,
            availability: r.availability,
          })),
        )
      : null;
  const pickLabel = forAll
    ? new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
        timeZone: poll.timezone,
      })
        .format(forAll.slot.startsAt)
        // "Thu 6 PM", not "Thu 6:00 PM".
        .replace(/:00/, "")
    : "";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* On a phone the poll's actions are one menu, on this row (the title gets the width). */}
      <div className="flex items-center justify-between gap-2">
        <BackLink href={`/app/${orgSlug}/calendar/find-a-time`} label="Find a time" />
        <div className="md:hidden">
          <AvailabilityPollActions
            orgId={org.id}
            orgSlug={orgSlug}
            pollId={poll.id}
            title={poll.title}
            isOpen={isOpen}
            canDelete={canDelete}
            scheduled={Boolean(poll.finalizedEventId)}
            compact
          />
        </div>
      </div>
      {/* The answer first: the best times and who can make them. */}
      <PollResultsHero poll={view} />
      {forAll && (
        <PickTimeAmbient
          orgId={org.id}
          orgSlug={orgSlug}
          pollId={poll.id}
          slotId={forAll.slot.id}
          label={pickLabel}
          reason={`Works for all ${forAll.people} who answered`}
        />
      )}
      <PollResponder
        poll={view}
        respondAs="member"
        orgId={org.id}
        orgSlug={orgSlug}
        canFinalize={canFinalize}
        bookBest={bookBest}
        actions={
          <AvailabilityPollActions
            orgId={org.id}
            orgSlug={orgSlug}
            pollId={poll.id}
            title={poll.title}
            isOpen={isOpen}
            canDelete={canDelete}
            scheduled={Boolean(poll.finalizedEventId)}
          />
        }
      />
    </div>
  );
}
