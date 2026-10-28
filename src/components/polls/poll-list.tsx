"use client";

import { CalendarRange, Link2, Trash2, UserPlus, Vote } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { deletePoll } from "@/app/app/[orgSlug]/calendar/polls/actions";
import { deleteQuestionPoll } from "@/app/app/[orgSlug]/calendar/polls/question-actions";
import { ItemMenu } from "@/components/item-menu";
import { PinToggle } from "@/components/pins/pins-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toaster";
import { IconChip } from "@/components/ui/stat";
import { cn } from "@/lib/utils";

import { copyGuestPollLink, copyPollLink } from "./copy-link";
import { PollStatusBadge, type PollStatusTone } from "./poll-status-badge";

/**
 * A list of polls, open ones first: Polls lists questions and Find a time
 * its availability polls (`showKind` marks each row's kind, for a list with
 * both). Every label is made on the server (dates in the poll's or the
 * org's zone), so the rows render the same before and after hydration.
 */

export type PollKind = "question" | "availability";

export interface PollListItem {
  id: string;
  kind: PollKind;
  title: string;
  href: string;
  /** An open availability poll takes guests' answers on its public page. */
  takesGuests?: boolean;
  status: { tone: PollStatusTone; label: string };
  /** "3 options · Anonymous · 12 people voted" */
  meta: string;
  /** Its creator, or an owner/admin (the actions check again). */
  canDelete: boolean;
  /** Said when asking before a delete. */
  deleteNote?: string;
}

/**
 * Shown on hover or focus, so the row stays quiet. Not on a phone at all:
 * there the "…" menu holds Delete, and there are no pins.
 */
const HOVER_ONLY =
  "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 max-md:hidden";

const KINDS: Record<PollKind, { label: string; icon: typeof Vote }> = {
  question: { label: "Question", icon: Vote },
  availability: { label: "Find a time", icon: CalendarRange },
};

export function PollList({
  orgId,
  open,
  closed,
  showKind = false,
}: {
  orgId: string;
  open: PollListItem[];
  closed: PollListItem[];
  showKind?: boolean;
}) {
  const router = useRouter();
  const [confirmElement, confirm] = useConfirm();

  async function remove(poll: PollListItem) {
    const deleted = await confirm({
      title: `Delete “${poll.title}”?`,
      description:
        poll.kind === "question"
          ? "Everyone's votes go with it. This can't be undone."
          : `Everyone's answers go with it, and its link stops working.${poll.deleteNote ? ` ${poll.deleteNote}` : ""}`,
      confirmLabel: "Delete poll",
      run: async () =>
        (poll.kind === "question"
          ? await deleteQuestionPoll(orgId, poll.id)
          : await deletePoll(orgId, poll.id)
        ).error,
    });
    if (!deleted) return;
    router.refresh();
    toast({ title: "Poll deleted", description: poll.title });
  }

  return (
    <>
      {confirmElement}
      <Section
        title="Open"
        polls={open}
        empty="No open polls right now."
        showKind={showKind}
        onDelete={remove}
      />
      {closed.length > 0 && (
        <Section title="Closed" polls={closed} empty="" showKind={showKind} onDelete={remove} />
      )}
    </>
  );
}

function Section({
  title,
  polls,
  empty,
  showKind,
  onDelete,
}: {
  title: string;
  polls: PollListItem[];
  empty: string;
  showKind: boolean;
  onDelete: (poll: PollListItem) => void;
}) {
  const id = `polls-${title.toLowerCase()}`;
  return (
    <section className="space-y-3" aria-labelledby={id}>
      <h2 id={id} className="heading flex items-center gap-2 text-[17px]">
        {title} <Badge variant="secondary">{polls.length}</Badge>
      </h2>
      {polls.length === 0 ? (
        <p className="text-muted-foreground bg-muted hatch rounded-tile p-4 text-sm">{empty}</p>
      ) : (
        <ul className="bg-card text-card-foreground ring-foreground/6 edge rounded-card p-2 ring-1">
          {polls.map((poll) => (
            <PollRow
              key={poll.id}
              poll={poll}
              showKind={showKind}
              onDelete={() => onDelete(poll)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function PollRow({
  poll,
  showKind,
  onDelete,
}: {
  poll: PollListItem;
  showKind: boolean;
  onDelete: () => void;
}) {
  const kind = KINDS[poll.kind];
  const Icon = kind.icon;
  return (
    <li className="group hover:bg-muted rounded-tile [&+&]:before:border-border/70 relative flex items-center gap-3.5 px-3 py-3 transition-colors hover:before:border-transparent max-md:hover:bg-transparent [&+&]:before:absolute [&+&]:before:top-0 [&+&]:before:right-3 [&+&]:before:left-[3.75rem] [&+&]:before:border-t">
      <IconChip icon={Icon} className="max-md:hidden" />
      <div className="min-w-0 flex-1 space-y-1.5">
        {/* The link covers the row; the pin and the menu sit above it. */}
        <Link
          href={poll.href}
          className="focus-visible:after:outline-foreground block truncate text-[15px] font-semibold outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 max-md:line-clamp-2 max-md:whitespace-normal"
        >
          {poll.title}
        </Link>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px]">
          {showKind && <Badge variant="secondary">{kind.label}</Badge>}
          <PollStatusBadge tone={poll.status.tone}>{poll.status.label}</PollStatusBadge>
          <span>{poll.meta}</span>
        </div>
      </div>
      <div className="relative z-10 flex shrink-0 items-center gap-1">
        <PinToggle href={poll.href} label={poll.title} className={HOVER_ONLY} />
        {poll.canDelete && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="Delete poll"
            aria-label={`Delete ${poll.title}`}
            onClick={onDelete}
            className={cn(HOVER_ONLY, "text-muted-foreground hover:text-destructive")}
          >
            <Trash2 aria-hidden className="size-4" />
          </Button>
        )}
        <ItemMenu
          label={`Actions for ${poll.title}`}
          items={[
            poll.takesGuests && {
              label: "Copy guest link",
              icon: UserPlus,
              onSelect: () => copyGuestPollLink(poll.id),
            },
            { label: "Copy member link", icon: Link2, onSelect: () => copyPollLink(poll.href) },
            poll.canDelete && {
              label: "Delete",
              icon: Trash2,
              destructive: true,
              onSelect: onDelete,
            },
          ]}
        />
      </div>
    </li>
  );
}
