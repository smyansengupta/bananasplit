import { CalendarClock, Plus } from "@/components/icons";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { MeetingsTabs } from "@/components/meetings/meetings-tabs";
import { PageHeader } from "@/components/page-header";
import { FindATimeCards, type FindATimeCard } from "@/components/polls/find-a-time-cards";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { sectionLabel } from "@/lib/nav/sidebar";
import { safeTimeZone } from "@/lib/calendar/dates";
import { FIND_A_TIME_KEEP_DAYS } from "@/lib/polls/expiry";
import { responsesLite, summarizePoll } from "@/lib/polls/poll-summary";
import { NEW_EVENT_PARAM } from "@/lib/calendar/range";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { coHostedEventIds } from "@/server/booking/co-hosted";
import { meetingsWhere } from "@/server/meetings/where";
import { planGate } from "@/server/billing/plan-gate";

import { availabilityItem, availabilityOpen, dateSpan } from "../polls/poll-items";
import { getOrgPolls, getPollResults } from "../queries";

/**
 * Find a time: the space's availability polls (When2meet-style), newest
 * first, open ones on top. It lives under Meetings (a tab beside Coming up
 * and Past), since it is how a meeting gets its date; its look is its own.
 * In Personal it is the only kind of poll (a question needs members to
 * vote), so older Personal question polls get a pointer to their list.
 */
export default async function FindATimePage({
  params,
}: PageProps<"/app/[orgSlug]/calendar/find-a-time">) {
  const { orgSlug } = await params;
  const planLock = await planGate(orgSlug, "polls");
  if (planLock) return planLock;

  const { organization: org, user, role, settings } = await getOrgContextBySlug(orgSlug);
  const personal = org.kind === "PERSONAL";
  const isAdmin = can({ role }, "events.write");
  const now = new Date();
  const coHosted = isAdmin ? [] : await coHostedEventIds(org.id, user.id, now);
  const { polls, results, questionCount, meetingCount } = await withOrgTx(
    org.id,
    async ({ db }) => {
      const polls = await getOrgPolls(db, org.id);
      return {
        // The Meetings tab's count: the meetings still to come, as Meetings counts them.
        meetingCount: await db.event.count({
          where: {
            AND: [meetingsWhere(org.id, user.id, isAdmin, now, coHosted), { endsAt: { gt: now } }],
          },
        }),
        polls,
        results: await getPollResults(
          db,
          org.id,
          polls.map((p) => p.id),
        ),
        questionCount: personal ? await db.poll.count({ where: { organizationId: org.id } }) : 0,
      };
    },
  );
  const base = `/app/${orgSlug}`;
  // Each poll as a card: its results summed up on the server (the rows hold
  // user ids), in the poll's own zone.
  const items = polls.map((p) => {
    const zone = safeTimeZone(p.timezone);
    const rows = results.get(p.id) ?? { slots: [], responses: [] };
    const card: FindATimeCard = {
      item: availabilityItem(p, base, now, p.createdById === user.id || isAdmin),
      canBook: isAdmin,
      summary: summarizePoll(rows.slots, responsesLite(rows.responses), p.durationMinutes, zone),
      timeZone: zone,
      durationMinutes: p.durationMinutes,
      span: dateSpan(p),
      firstDay: p.firstSlotAt,
    };
    return { open: availabilityOpen(p, now), card };
  });
  const openCards = items.filter((p) => p.open).map((p) => p.card);
  const closedCards = items.filter((p) => !p.open).map((p) => p.card);

  // The live line: what's still taking answers, and how many came in.
  const openPolls = polls.filter((p) => availabilityOpen(p, now));
  const answered = openPolls.reduce((n, p) => n + p.respondentCount, 0);

  return (
    <div className="space-y-7">
      <PageHeader
        title={sectionLabel(settings?.sidebar, "meetings")}
        description={
          items.length === 0
            ? undefined
            : `${openPolls.length} open, ${answered === 1 ? "1 answer" : `${answered} answers`} so far`
        }
        // The same two as Meetings' header: Find a time beside New meeting,
        // which opens the create form on Meetings (?new=1).
        actions={
          <>
            <Button variant={isAdmin ? "outline" : "create"} asChild>
              <Link href={`${base}/calendar/find-a-time/new`}>
                <Plus aria-hidden="true" />
                Find a time
              </Link>
            </Button>
            {isAdmin && (
              <Button variant="create" asChild>
                <Link href={`${base}/meetings?${NEW_EVENT_PARAM}=1`}>
                  <Plus aria-hidden="true" />
                  New meeting
                </Link>
              </Button>
            )}
          </>
        }
      />

      <MeetingsTabs
        orgSlug={orgSlug}
        current="find"
        counts={{ upcoming: meetingCount, find: openPolls.length }}
      />

      {items.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No meeting times to pick yet"
          description="Pick days and hours, share the link, see the best time."
        />
      ) : (
        <div className="space-y-7.5">
          {openCards.length > 0 && (
            <section aria-labelledby="fat-open" className="space-y-4">
              <h2 id="fat-open" className="heading text-[17px]">
                Taking answers
              </h2>
              <FindATimeCards cards={openCards} feature />
            </section>
          )}
          {closedCards.length > 0 && (
            <section aria-labelledby="fat-closed" className="space-y-4">
              <h2 id="fat-closed" className="heading text-[17px]">
                Closed and scheduled
              </h2>
              <FindATimeCards cards={closedCards} />
            </section>
          )}
        </div>
      )}

      {/* Not on a phone: the empty state and Find a time say it there. */}
      {items.length > 0 && (
        <p className="text-muted-foreground text-[13px] max-md:hidden">
          Each poll deletes itself {FIND_A_TIME_KEEP_DAYS} days after its last date.
        </p>
      )}

      {questionCount > 0 && (
        <p className="text-muted-foreground text-sm">
          You also have{" "}
          {questionCount === 1 ? "a question poll" : `${questionCount} question polls`}.{" "}
          <Link
            href={`${base}/calendar/polls`}
            className="text-foreground underline underline-offset-2"
          >
            See {questionCount === 1 ? "it" : "them"}
          </Link>
        </p>
      )}
    </div>
  );
}
