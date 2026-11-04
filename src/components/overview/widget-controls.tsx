import { CardControls, OpenLink } from "./bits";

/**
 * The card-header controls of the Overview's recap and waiting widgets,
 * for the page's headerActions: what goes beside each title (a count, a
 * date) and the ↗ to the page behind it. Server components.
 */

function Muted({ children }: { children: string }) {
  return <span className="text-muted-foreground text-[13px] whitespace-nowrap">{children}</span>;
}

/** Since you were here: when that was, then ↗ to the Inbox's updates. */
export function SinceYouWereHereControls({
  orgSlug,
  sinceLabel,
}: {
  orgSlug: string;
  sinceLabel: string | null;
}) {
  return (
    <CardControls chips={sinceLabel ? <Muted>{sinceLabel}</Muted> : null}>
      <OpenLink href={`/app/${orgSlug}/inbox?view=updates`} label="Inbox" />
    </CardControls>
  );
}

/** Waiting on you: how many, then ↗ to the Inbox. */
export function WaitingOnYouControls({ orgSlug, count }: { orgSlug: string; count: number }) {
  return (
    <CardControls count={count || undefined}>
      <OpenLink href={`/app/${orgSlug}/inbox`} label="Inbox" />
    </CardControls>
  );
}

/** Waiting on others: how many, then ↗ to the tasks you made. */
export function WaitingOnOthersControls({ orgSlug, count }: { orgSlug: string; count: number }) {
  return (
    <CardControls count={count || undefined}>
      <OpenLink href={`/app/${orgSlug}/tasks?view=list&status=open`} label="Tasks" />
    </CardControls>
  );
}

/** Deadlines: how many in the next three weeks, then ↗ to the calendar. */
export function DeadlinesControls({ orgSlug, count }: { orgSlug: string; count: number }) {
  return (
    <CardControls count={count || undefined}>
      <OpenLink href={`/app/${orgSlug}/calendar`} label="Calendar" />
    </CardControls>
  );
}

/** Votes: how many are open, then ↗ to Forms. */
export function VotesControls({ orgSlug, count }: { orgSlug: string; count: number }) {
  return (
    <CardControls count={count || undefined}>
      <OpenLink href={`/app/${orgSlug}/forms`} label="Forms" />
    </CardControls>
  );
}
