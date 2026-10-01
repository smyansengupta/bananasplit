"use client";

import { CalendarRange, ExternalLink, Link2, Trash2, Vote } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { deletePoll } from "@/app/app/[orgSlug]/calendar/polls/actions";
import { deleteQuestionPoll } from "@/app/app/[orgSlug]/calendar/polls/question-actions";
import { ItemMenu } from "@/components/item-menu";
import { PinToggle } from "@/components/pins/pins-context";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

import { copyPollLink } from "./copy-link";

/**
 * The polls page's list: both kinds of poll in one list, open ones first.
 * Every label is made on the server (dates in the poll's or the org's
 * zone), so the rows render the same before and after hydration.
 */

export type PollKind = "question" | "availability";

export interface PollListItem {
  id: string;
  kind: PollKind;
  title: string;
  href: string;
  status: { tone: "open" | "closed" | "scheduled"; label: string };
  /** "3 options · Anonymous · 12 people voted" */
  meta: string;
  /** Its creator, or an owner/admin (the actions check again). */
  canDelete: boolean;
  /** Said when asking before a delete. */
  deleteNote?: string;
}

const KINDS: Record<PollKind, { label: string; icon: typeof Vote }> = {
  question: { label: "Question", icon: Vote },
  availability: { label: "Find a time", icon: CalendarRange },
};

export function PollList({
  orgId,
  open,
  closed,
}: {
  orgId: string;
  open: PollListItem[];
  closed: PollListItem[];
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
      <Section title="Open" polls={open} empty="No open polls right now." onDelete={remove} />
      {closed.length > 0 && <Section title="Closed" polls={closed} empty="" onDelete={remove} />}
    </>
  );
}

function Section({
  title,
  polls,
  empty,
  onDelete,
}: {
  title: string;
  polls: PollListItem[];
  empty: string;
  onDelete: (poll: PollListItem) => void;
}) {
  const id = `polls-${title.toLowerCase()}`;
  return (
    <section className="space-y-2" aria-labelledby={id}>
      <h2 id={id} className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {title} <span className="tabular-nums">({polls.length})</span>
      </h2>
      {polls.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border border-dashed p-4 text-sm">{empty}</p>
      ) : (
        <ul className="bg-card divide-y overflow-hidden rounded-xl border shadow-xs">
          {polls.map((poll) => (
            <PollRow key={poll.id} poll={poll} onDelete={() => onDelete(poll)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PollRow({ poll, onDelete }: { poll: PollListItem; onDelete: () => void }) {
  const kind = KINDS[poll.kind];
  const Icon = kind.icon;
  return (
    <li className="group hover:bg-muted/40 relative flex items-center gap-3 px-4 py-3 transition-colors">
      <span
        aria-hidden
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-lg",
          poll.kind === "question"
            ? "bg-primary/10 text-primary"
            : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        {/* The link covers the row; the pin and the menu sit above it. */}
        <Link
          href={poll.href}
          className="focus-visible:after:ring-ring/50 block truncate text-sm font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-inset"
        >
          {poll.title}
        </Link>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <Badge variant="outline" className="text-muted-foreground font-normal">
            {kind.label}
          </Badge>
          <Status status={poll.status} />
          <span>{poll.meta}</span>
        </div>
      </div>
      <div className="relative z-10 flex shrink-0 items-center gap-1">
        <PinToggle
          href={poll.href}
          label={poll.title}
          className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 max-sm:opacity-100"
        />
        <ItemMenu
          label={`Actions for ${poll.title}`}
          items={[
            { label: "Open", icon: ExternalLink, href: poll.href },
            { label: "Copy link", icon: Link2, onSelect: () => copyPollLink(poll.href) },
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

function Status({ status }: { status: PollListItem["status"] }) {
  if (status.tone === "open") {
    return (
      <Badge variant="outline" className="gap-1.5">
        <span aria-hidden className="bg-success size-1.5 rounded-full" />
        {status.label}
      </Badge>
    );
  }
  return <Badge variant="secondary">{status.label}</Badge>;
}
