import { ArrowLeft, Vote } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { NewPollButtons, NewPollMenu } from "@/components/polls/new-poll-menu";
import { PollList, type PollListItem } from "@/components/polls/poll-list";
import { can } from "@/lib/auth/permissions";
import { safeTimeZone } from "@/lib/calendar/dates";
import { isPollOpen } from "@/lib/polls/question-poll";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { listQuestionPolls, type QuestionPollSummary } from "@/server/polls/question-polls";

import { getOrgPolls } from "../queries";

type AvailabilityRow = Awaited<ReturnType<typeof getOrgPolls>>[number];

/**
 * Every poll in the org, both kinds, newest first: questions people vote on
 * and find-a-time (availability) polls, split into open and closed.
 */
export default async function PollsListPage({
  params,
}: PageProps<"/app/[orgSlug]/calendar/polls">) {
  const { orgSlug } = await params;

  const { organization: org, user, role } = await getOrgContextBySlug(orgSlug);
  const { availability, questions } = await withOrgTx(org.id, async ({ db }) => ({
    availability: await getOrgPolls(db, org.id),
    questions: await listQuestionPolls(db, org.id),
  }));
  const now = new Date();
  const isAdmin = can({ role }, "events.write");
  const base = `/app/${orgSlug}/calendar/polls`;

  const all = [
    ...availability.map((p) => ({
      createdAt: p.createdAt,
      open: availabilityOpen(p, now),
      item: availabilityItem(p, base, now, p.createdById === user.id || isAdmin),
    })),
    ...questions.map((p) => ({
      createdAt: p.createdAt,
      open: isPollOpen(p, now),
      item: questionItem(
        p,
        base,
        now,
        safeTimeZone(org.timezone),
        p.createdById === user.id || isAdmin,
      ),
    })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-3">
        <Link
          href={`/app/${orgSlug}/calendar`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Calendar
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">Polls</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Ask the club a question, or find a time that works for everyone.
            </p>
          </div>
          <NewPollMenu orgSlug={orgSlug} />
        </div>
      </div>

      {all.length === 0 ? (
        <EmptyState
          icon={Vote}
          title="No polls yet"
          description="Ask a question and let people vote, or offer some days and hours and see when most people are free."
          action={<NewPollButtons orgSlug={orgSlug} />}
        />
      ) : (
        <PollList
          orgId={org.id}
          open={all.filter((p) => p.open).map((p) => p.item)}
          closed={all.filter((p) => !p.open).map((p) => p.item)}
        />
      )}
    </div>
  );
}

function people(n: number, verb: string): string {
  if (n === 0) return verb === "voted" ? "No votes yet" : "No responses yet";
  return n === 1 ? `1 person ${verb}` : `${n} people ${verb}`;
}

function shortDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(at);
}

function questionItem(
  poll: QuestionPollSummary,
  base: string,
  now: Date,
  timeZone: string,
  canDelete: boolean,
): PollListItem {
  const open = isPollOpen(poll, now);
  return {
    id: poll.id,
    kind: "question",
    title: poll.question,
    href: `${base}/${poll.id}`,
    status: open
      ? {
          tone: "open",
          label: poll.closesAt ? `Open until ${shortDate(poll.closesAt, timeZone)}` : "Open",
        }
      : { tone: "closed", label: "Closed" },
    meta: [
      `${poll.optionCount} options`,
      poll.multiple ? "Pick any" : null,
      poll.anonymous ? "Anonymous" : null,
      people(poll.voterCount, "voted"),
    ]
      .filter(Boolean)
      .join(" · "),
    canDelete,
  };
}

function availabilityOpen(poll: AvailabilityRow, now: Date): boolean {
  return !poll.finalizedEventId && !(poll.closesAt && poll.closesAt.getTime() < now.getTime());
}

function availabilityItem(
  poll: AvailabilityRow,
  base: string,
  now: Date,
  canDelete: boolean,
): PollListItem {
  const zone = safeTimeZone(poll.timezone);
  const status: PollListItem["status"] = poll.finalizedEventId
    ? {
        tone: "scheduled",
        label: poll.finalizedEvent
          ? `Scheduled ${shortDate(poll.finalizedEvent.startsAt, zone)}`
          : "Scheduled",
      }
    : availabilityOpen(poll, now)
      ? {
          tone: "open",
          label: poll.closesAt ? `Open until ${shortDate(poll.closesAt, zone)}` : "Open",
        }
      : { tone: "closed", label: "Closed" };
  return {
    id: poll.id,
    kind: "availability",
    title: poll.title,
    href: `${base}/${poll.id}`,
    status,
    meta: [
      dateSpan(poll),
      `${poll.durationMinutes}-minute meeting`,
      people(poll.respondentCount, "responded"),
    ]
      .filter(Boolean)
      .join(" · "),
    canDelete,
    deleteNote: poll.finalizedEventId ? "The event it scheduled stays on the calendar." : undefined,
  };
}

/** "Sep 29 – Oct 3" in the poll's own zone, the days it offers. */
function dateSpan(poll: AvailabilityRow): string | null {
  if (!poll.firstSlotAt || !poll.lastSlotEndsAt) return null;
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: safeTimeZone(poll.timezone),
  });
  // The last slot's end, less a minute, so a window ending at midnight stays on its day.
  const last = new Date(poll.lastSlotEndsAt.getTime() - 60_000);
  return fmt.formatRange(poll.firstSlotAt, last);
}
