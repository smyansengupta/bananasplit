import { ArrowLeft, CalendarRange, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { PinToggle } from "@/components/pins/pins-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { safeTimeZone } from "@/lib/calendar/dates";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";

import { getOrgPolls } from "../queries";

type PollRow = Awaited<ReturnType<typeof getOrgPolls>>[number];

export default async function PollsListPage({
  params,
}: PageProps<"/app/[orgSlug]/calendar/polls">) {
  const { orgSlug } = await params;

  const { organization: org } = await getOrgContextBySlug(orgSlug);
  const polls = await withOrgTx(org.id, ({ db }) => getOrgPolls(db, org.id));
  const now = new Date().getTime();
  const isOpen = (p: PollRow) => !p.finalizedEventId && !(p.closesAt && p.closesAt.getTime() < now);
  const open = polls.filter(isOpen);
  const past = polls.filter((p) => !isOpen(p));

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
            <h1 className="text-2xl font-semibold tracking-tight">Availability polls</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              People mark when they&apos;re free; an admin schedules the time that suits the most.
            </p>
          </div>
          <Button asChild>
            <Link href={`/app/${orgSlug}/calendar/polls/new`}>
              <Plus aria-hidden className="size-4" />
              New poll
            </Link>
          </Button>
        </div>
      </div>

      {polls.length === 0 ? (
        <EmptyState
          icon={CalendarRange}
          title="No polls yet"
          description="Pick some dates and hours, share the link, and see when most people are free."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href={`/app/${orgSlug}/calendar/polls/new`}>Create a poll</Link>
            </Button>
          }
        />
      ) : (
        <>
          <PollSection
            title="Open"
            empty="No open polls."
            polls={open}
            orgSlug={orgSlug}
            now={now}
          />
          {past.length > 0 && (
            <PollSection title="Closed" empty="" polls={past} orgSlug={orgSlug} now={now} />
          )}
        </>
      )}
    </div>
  );
}

function PollSection({
  title,
  empty,
  polls,
  orgSlug,
  now,
}: {
  title: string;
  empty: string;
  polls: PollRow[];
  orgSlug: string;
  now: number;
}) {
  const id = `polls-${title.toLowerCase()}`;
  return (
    <section className="space-y-2" aria-labelledby={id}>
      <h2 id={id} className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {title} <span className="tabular-nums">({polls.length})</span>
      </h2>
      {polls.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">{empty}</p>
      ) : (
        <ul className="divide-border bg-card divide-y rounded-lg border">
          {polls.map((poll) => (
            <li key={poll.id} className="group relative">
              <PinToggle
                href={`/app/${orgSlug}/calendar/polls/${poll.id}`}
                label={poll.title}
                className="absolute top-1/2 right-10 z-10 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              />
              <Link
                href={`/app/${orgSlug}/calendar/polls/${poll.id}`}
                className="hover:bg-muted/50 focus-visible:ring-ring/50 flex items-center gap-3 px-4 py-3 transition-colors outline-none first:rounded-t-lg last:rounded-b-lg focus-visible:ring-3 focus-visible:ring-inset"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate font-medium">{poll.title}</span>
                    <PollStatus poll={poll} now={now} />
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {[
                      dateSpan(poll),
                      `${poll.durationMinutes}-minute meeting`,
                      poll.respondentCount === 0
                        ? "No responses yet"
                        : poll.respondentCount === 1
                          ? "1 person responded"
                          : `${poll.respondentCount} people responded`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <ChevronRight aria-hidden className="text-muted-foreground size-4 shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PollStatus({ poll, now }: { poll: PollRow; now: number }) {
  const zone = safeTimeZone(poll.timezone);
  if (poll.finalizedEventId) {
    return (
      <Badge variant="secondary">
        {poll.finalizedEvent
          ? `Scheduled ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: zone }).format(poll.finalizedEvent.startsAt)}`
          : "Scheduled"}
      </Badge>
    );
  }
  if (poll.closesAt && poll.closesAt.getTime() < now)
    return <Badge variant="outline">Closed</Badge>;
  return (
    <Badge variant="outline" className="gap-1">
      <span aria-hidden className="bg-success size-1.5 rounded-full" />
      {poll.closesAt
        ? `Open until ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: zone }).format(poll.closesAt)}`
        : "Open"}
    </Badge>
  );
}

/** "Sep 29 – Oct 3" in the poll's own zone, the days it offers. */
function dateSpan(poll: PollRow): string | null {
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
