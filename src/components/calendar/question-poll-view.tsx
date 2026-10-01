"use client";

import {
  Check,
  Eraser,
  EyeOff,
  Link2,
  ListPlus,
  Loader2,
  Lock,
  LockOpen,
  Plus,
  ShieldCheck,
  Trash2,
  Trophy,
  Users,
  Vote,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useOptimistic, useRef, useState, useTransition, type ReactNode } from "react";

import {
  addQuestionPollOption,
  deleteQuestionPoll,
  removeQuestionPollOption,
  setQuestionPollClosed,
  voteOnQuestionPoll,
} from "@/app/app/[orgSlug]/calendar/polls/question-actions";
import { ItemMenu } from "@/components/item-menu";
import { PinToggle } from "@/components/pins/pins-context";
import { copyPollLink } from "@/components/polls/copy-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { UserAvatar } from "@/components/user-avatar";
import {
  applyMyVote,
  MIN_OPTIONS,
  OPTION_MAX,
  tally,
  type PollVoter,
  type QuestionPollOptionView,
  type QuestionPollView,
  type TallyRow,
} from "@/lib/polls/question-poll";
import { cn } from "@/lib/utils";

import { useViewerTimeZone } from "./hooks";
import { plain } from "./poll-format";

/**
 * A question poll, for a member of its org: vote (one option or several),
 * change or clear the vote, and watch the results. The vote shows at once
 * and goes to the server a moment later, so a quick run of changes (or
 * arrowing through the choices) sends only where it ends up; the server's
 * counts replace the local ones when its refresh lands.
 *
 * Fed the stripped view (src/lib/polls/question-poll.ts): on an anonymous
 * poll it holds counts and the viewer's own choice, nobody else's name.
 */

const VOTE_DELAY_MS = 250;
const MAX_FACES = 5;

function peopleVoted(n: number): string {
  if (n === 0) return "No votes yet";
  return n === 1 ? "1 person voted" : `${n} people voted`;
}

function voteCount(n: number): string {
  return `${n} ${n === 1 ? "vote" : "votes"}`;
}

// A fixed locale, so the server's and the browser's labels agree on hydration.
function shortDay(at: Date, timeZone: string): string {
  return plain(
    new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(at),
  );
}

/** "Oct 2, 4:28 PM" in `timeZone`. */
function moment(at: Date, timeZone: string): string {
  return plain(
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(at),
  );
}

export function QuestionPoll({
  poll,
  orgId,
  orgSlug,
  timeZone,
}: {
  poll: QuestionPollView;
  orgId: string;
  orgSlug: string;
  /** The org's zone: what the server renders times in, before the viewer's own. */
  timeZone: string;
}) {
  const router = useRouter();
  const zone = useViewerTimeZone(timeZone);
  const href = `/app/${orgSlug}/calendar/polls/${poll.id}`;
  const headingId = useId();
  const [confirmElement, confirm] = useConfirm();

  // --- the viewer's vote, shown before the server has it ---------------------
  const [mine, setMine] = useOptimistic(poll.myVotes);
  const [, startVote] = useTransition();
  const latestVote = useRef(0);

  const live = applyMyVote(
    Object.fromEntries(poll.options.map((o) => [o.id, o.votes ?? 0])),
    poll.voterCount,
    poll.myVotes,
    mine,
  );
  const rows = new Map(
    tally(
      poll.options.map((o) => ({ id: o.id, votes: live.votes[o.id] ?? 0 })),
      live.voters,
    ).map((row) => [row.id, row]),
  );

  function sendVote(next: string[]) {
    const ticket = ++latestVote.current;
    startVote(async () => {
      setMine(next);
      await new Promise((resolve) => setTimeout(resolve, VOTE_DELAY_MS));
      // A later change is on its way and carries the final choice.
      if (ticket !== latestVote.current) return;
      const result = await voteOnQuestionPoll(orgId, poll.id, next);
      if (result.error)
        toast({ title: "Your vote wasn't saved", description: result.error, tone: "error" });
    });
  }

  function choose(optionId: string) {
    if (!poll.canVote) return;
    if (poll.multiple) {
      sendVote(
        mine.includes(optionId) ? mine.filter((id) => id !== optionId) : [...mine, optionId],
      );
    } else if (!mine.includes(optionId)) {
      sendVote([optionId]);
    }
  }

  /** Who picked an option, with the viewer's own choice as it is now. */
  function votersOf(option: QuestionPollOptionView): PollVoter[] | null {
    if (!option.voters) return null;
    const others = option.voters.filter((v) => v.key !== "me");
    return mine.includes(option.id) && poll.me ? [poll.me, ...others] : others;
  }

  // --- closing, deleting ----------------------------------------------------
  const [isClosing, startClosing] = useTransition();
  function setClosed(closed: boolean) {
    startClosing(async () => {
      const result = await setQuestionPollClosed(orgId, poll.id, closed);
      if (result.error) {
        toast({
          title: closed ? "Couldn't close the poll" : "Couldn't reopen the poll",
          description: result.error,
          tone: "error",
        });
        return;
      }
      toast({
        title: closed ? "Poll closed" : "Poll reopened",
        description: closed ? "The results are final; nobody can vote." : "People can vote again.",
        duration: 4_000,
      });
    });
  }

  async function remove() {
    const deleted = await confirm({
      title: "Delete this poll?",
      description: "Everyone's votes go with it. This can't be undone.",
      confirmLabel: "Delete poll",
      run: async () => (await deleteQuestionPoll(orgId, poll.id)).error,
    });
    if (!deleted) return;
    toast({ title: "Poll deleted", description: poll.question });
    router.push(`/app/${orgSlug}/calendar/polls`);
  }

  async function removeOption(option: QuestionPollOptionView) {
    const votes = live.votes[option.id] ?? 0;
    const removed = await confirm({
      title: `Remove “${option.label}”?`,
      description:
        poll.resultsVisible && votes > 0
          ? `Its ${voteCount(votes)} ${votes === 1 ? "is" : "are"} removed too.`
          : "Any votes for it are removed too.",
      confirmLabel: "Remove option",
      run: async () => (await removeQuestionPollOption(orgId, poll.id, option.id)).error,
    });
    if (removed) toast({ title: "Option removed", description: option.label, duration: 4_000 });
  }

  const canRemoveOptions = poll.canManage && poll.isOpen && poll.options.length > MIN_OPTIONS;
  const closedAt = poll.closedAt ?? poll.closesAt;
  const myLabels = poll.options.filter((o) => mine.includes(o.id)).map((o) => o.label);

  return (
    <article className="space-y-5" aria-labelledby={headingId}>
      {confirmElement}

      {/* ------------------------------------------------------------ header */}
      <header className="bg-card space-y-4 rounded-xl border p-5 shadow-xs sm:p-6">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-xs font-medium">
              <Vote aria-hidden className="size-3.5" />
              <span>Question</span>
              <span aria-hidden>·</span>
              <span>
                {poll.askedBy ? `Asked by ${poll.askedBy}, ` : "Asked "}
                {shortDay(poll.createdAt, zone)}
              </span>
            </p>
            <h1
              id={headingId}
              className="text-xl font-semibold tracking-tight break-words sm:text-2xl"
            >
              {poll.question}
            </h1>
            {poll.description && (
              <p className="text-muted-foreground max-w-prose text-sm break-words whitespace-pre-wrap">
                {poll.description}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <PinToggle href={href} label={poll.question} />
            <ItemMenu
              label="Poll actions"
              items={[
                { label: "Copy link", icon: Link2, onSelect: () => copyPollLink(href) },
                poll.canManage &&
                  (poll.isOpen
                    ? {
                        label: "Close poll",
                        icon: Lock,
                        onSelect: () => setClosed(true),
                        disabled: isClosing,
                      }
                    : {
                        label: "Reopen poll",
                        icon: LockOpen,
                        onSelect: () => setClosed(false),
                        disabled: isClosing,
                      }),
                poll.canManage && {
                  label: "Delete",
                  icon: Trash2,
                  destructive: true,
                  onSelect: () => void remove(),
                },
              ]}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {poll.isOpen ? (
            <Badge variant="outline" className="gap-1.5">
              <span aria-hidden className="bg-success size-1.5 rounded-full" />
              Open
            </Badge>
          ) : (
            <Badge variant="secondary">
              <Lock aria-hidden />
              Closed
            </Badge>
          )}
          {poll.isOpen && poll.closesAt && (
            <span className="text-muted-foreground text-xs">
              Closes {moment(poll.closesAt, zone)}
            </span>
          )}
          {poll.anonymous && (
            <Badge variant="outline">
              <ShieldCheck aria-hidden />
              Anonymous
            </Badge>
          )}
          {poll.hideResultsUntilClosed && poll.isOpen && (
            <Badge variant="outline">
              <EyeOff aria-hidden />
              Results when it closes
            </Badge>
          )}
          {poll.allowMemberOptions && poll.isOpen && (
            <Badge variant="outline">
              <ListPlus aria-hidden />
              Anyone can add options
            </Badge>
          )}
        </div>
      </header>

      {!poll.isOpen && (
        <div className="bg-muted/50 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm">
          <span className="flex items-center gap-2">
            <Lock aria-hidden className="text-muted-foreground size-4 shrink-0" />
            <span>
              {closedAt ? `Closed ${moment(closedAt, zone)}.` : "Closed."} The results are final.
            </span>
          </span>
          {poll.canManage && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setClosed(false)}
              disabled={isClosing}
            >
              {isClosing ? (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              ) : (
                <LockOpen aria-hidden className="size-4" />
              )}
              Reopen
            </Button>
          )}
        </div>
      )}

      {/* ----------------------------------------------------------- options */}
      <section className="space-y-3" aria-label="Options">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-sm font-medium">
            {poll.canVote ? (poll.multiple ? "Pick as many as you like" : "Pick one") : "Results"}
          </h2>
          <p className="text-muted-foreground inline-flex items-center gap-1.5 text-sm tabular-nums">
            <Users aria-hidden className="size-4" />
            {peopleVoted(live.voters)}
          </p>
        </div>

        <fieldset className="min-w-0">
          <legend className="sr-only">{poll.question}</legend>
          <ul className="space-y-2.5">
            {poll.options.map((option) => (
              <OptionRow
                key={option.id}
                pollId={poll.id}
                option={option}
                row={rows.get(option.id)}
                voters={votersOf(option)}
                selected={mine.includes(option.id)}
                multiple={poll.multiple}
                canVote={poll.canVote}
                isOpen={poll.isOpen}
                resultsVisible={poll.resultsVisible}
                onChoose={() => choose(option.id)}
                menu={
                  canRemoveOptions ? (
                    <ItemMenu
                      label={`Actions for “${option.label}”`}
                      className="opacity-0 group-hover/option:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 max-sm:opacity-100"
                      items={[
                        {
                          label: "Remove option",
                          icon: Trash2,
                          destructive: true,
                          onSelect: () => void removeOption(option),
                        },
                      ]}
                    />
                  ) : null
                }
              />
            ))}
          </ul>
        </fieldset>
        <p className="sr-only" aria-live="polite">
          {myLabels.length > 0
            ? `Your vote: ${myLabels.join(", ")}`
            : poll.canVote
              ? "You haven't voted."
              : ""}
        </p>

        {(poll.canAddOption || (poll.canVote && mine.length > 0)) && (
          <div className="flex flex-wrap items-start justify-between gap-2">
            {poll.canAddOption ? <AddOption orgId={orgId} pollId={poll.id} /> : <span />}
            {poll.canVote && mine.length > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={() => sendVote([])}>
                <Eraser aria-hidden className="size-4" />
                Clear my vote
              </Button>
            )}
          </div>
        )}

        <div className="space-y-2 pt-1">
          {poll.anonymous && (
            <Notice icon={ShieldCheck}>
              Anonymous: only the counts are shown. Nobody, not even admins, can see who voted for
              what.
            </Notice>
          )}
          {poll.isOpen && poll.hideResultsUntilClosed && !poll.resultsVisible && (
            <Notice icon={EyeOff}>
              The results are hidden until the poll closes. Until then you see only your own vote.
            </Notice>
          )}
          {poll.isOpen && poll.hideResultsUntilClosed && poll.resultsVisible && (
            <Notice icon={EyeOff}>
              Voters see these results when the poll closes. You see them now because you asked or
              you&apos;re an admin.
            </Notice>
          )}
        </div>
      </section>
    </article>
  );
}

function OptionRow({
  pollId,
  option,
  row,
  voters,
  selected,
  multiple,
  canVote,
  isOpen,
  resultsVisible,
  onChoose,
  menu,
}: {
  pollId: string;
  option: QuestionPollOptionView;
  row: TallyRow | undefined;
  voters: PollVoter[] | null;
  selected: boolean;
  multiple: boolean;
  canVote: boolean;
  isOpen: boolean;
  resultsVisible: boolean;
  onChoose: () => void;
  menu: ReactNode;
}) {
  const leading = resultsVisible && Boolean(row?.leading);
  const body = (
    <>
      {canVote ? (
        <>
          <input
            type={multiple ? "checkbox" : "radio"}
            name={`poll-${pollId}`}
            className="sr-only"
            checked={selected}
            onChange={onChoose}
          />
          <Indicator multiple={multiple} checked={selected} />
        </>
      ) : (
        <span
          aria-hidden
          className={cn(
            "mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full",
            selected ? "bg-primary text-primary-foreground" : "bg-muted",
          )}
        >
          {selected && <Check className="size-3" strokeWidth={3} />}
        </span>
      )}
      <span className="min-w-0 flex-1 space-y-2">
        <span className="flex items-start justify-between gap-3">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium break-words">{option.label}</span>
            {selected && (
              <span className="text-primary inline-flex items-center gap-1 text-xs font-medium">
                <Check aria-hidden className="size-3.5" />
                You voted
              </span>
            )}
          </span>
          {resultsVisible && row && (
            <span
              className={cn(
                "shrink-0 text-sm tabular-nums",
                leading ? "text-foreground font-semibold" : "text-muted-foreground",
              )}
            >
              {row.percent}%
            </span>
          )}
        </span>
        {resultsVisible && row && (
          <>
            <span aria-hidden className="bg-muted block h-2 overflow-hidden rounded-full">
              <span
                className={cn(
                  "block h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none",
                  leading ? "bg-primary" : "bg-primary/35",
                )}
                style={{ width: `${row.percent}%` }}
              />
            </span>
            <span className="text-muted-foreground flex min-h-5 items-center justify-between gap-3 text-xs">
              <span className="flex items-center gap-1.5 tabular-nums">
                {voteCount(row.votes)}
                {leading && (
                  <span className="text-primary inline-flex items-center gap-1 font-medium">
                    <span aria-hidden>·</span>
                    {!isOpen && <Trophy aria-hidden className="size-3.5" />}
                    {isOpen ? "Leading" : "Top choice"}
                  </span>
                )}
              </span>
              {voters && voters.length > 0 && <Faces voters={voters} />}
            </span>
          </>
        )}
      </span>
    </>
  );

  return (
    <li
      className={cn(
        "group/option bg-card relative flex items-start rounded-xl border transition-colors",
        selected
          ? "border-primary/60 bg-primary/5"
          : canVote && "hover:border-foreground/20 hover:bg-muted/30",
        canVote && "has-[input:focus-visible]:ring-ring/50 has-[input:focus-visible]:ring-3",
      )}
    >
      {canVote ? (
        <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 px-3.5 py-3">
          {body}
        </label>
      ) : (
        <div className="flex min-w-0 flex-1 items-start gap-3 px-3.5 py-3">{body}</div>
      )}
      {menu && <div className="py-2.5 pe-2">{menu}</div>}
    </li>
  );
}

/** The radio dot or checkbox tick, drawn to match the card it sits in. */
function Indicator({ multiple, checked }: { multiple: boolean; checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-0.5 grid size-[18px] shrink-0 place-items-center border-2 transition-colors",
        multiple ? "rounded-[5px]" : "rounded-full",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-muted-foreground/40 bg-background group-hover/option:border-primary/60",
      )}
    >
      {checked &&
        (multiple ? (
          <Check className="size-3" strokeWidth={3} />
        ) : (
          <span className="bg-primary-foreground size-1.5 rounded-full" />
        ))}
    </span>
  );
}

/** Who picked an option: a few faces, the rest as "+N"; all the names on hover. */
function Faces({ voters }: { voters: PollVoter[] }) {
  const names = voters.map((v) => (v.key === "me" ? "You" : v.name));
  const shown = voters.slice(0, MAX_FACES);
  return (
    <span className="flex shrink-0 items-center" title={names.join(", ")}>
      <span className="sr-only">Voted: {names.join(", ")}.</span>
      <span aria-hidden className="flex -space-x-1.5">
        {shown.map((v) => (
          <UserAvatar
            key={v.key}
            user={{ name: v.name, image: v.image, avatar: v.avatar }}
            size="xs"
            className="ring-card ring-2"
          />
        ))}
      </span>
      {voters.length > MAX_FACES && (
        <span aria-hidden className="ms-1.5 tabular-nums">
          +{voters.length - MAX_FACES}
        </span>
      )}
    </span>
  );
}

function AddOption({ orgId, pollId }: { orgId: string; pollId: string }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isAdding, startAdding] = useTransition();
  const inputId = useId();

  function close() {
    setOpen(false);
    setLabel("");
    setError(null);
  }

  function add() {
    if (!label.trim() || isAdding) return;
    setError(null);
    startAdding(async () => {
      const result = await addQuestionPollOption(orgId, pollId, label);
      // Inside the same transition, so the field clears as the new option appears.
      startAdding(() => {
        if (result.error) setError(result.error);
        else setLabel("");
      });
    });
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus aria-hidden className="size-4" />
        Add an option
      </Button>
    );
  }
  return (
    <form
      className="w-full space-y-1.5 sm:max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <label htmlFor={inputId} className="sr-only">
        New option
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={inputId}
          autoFocus
          value={label}
          maxLength={OPTION_MAX}
          placeholder="Another option"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          onChange={(e) => {
            setLabel(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
          }}
        />
        <Button type="submit" disabled={isAdding || !label.trim()}>
          {isAdding && <Loader2 aria-hidden className="size-4 animate-spin" />}
          Add
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Stop adding options"
          onClick={close}
        >
          <X className="size-4" />
        </Button>
      </div>
      {error && (
        <p id={`${inputId}-error`} className="text-destructive text-xs" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function Notice({ icon: Icon, children }: { icon: typeof ShieldCheck; children: ReactNode }) {
  return (
    <p className="text-muted-foreground flex items-start gap-2 text-xs">
      <Icon aria-hidden className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
