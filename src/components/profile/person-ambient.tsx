"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { sendMemberNoteAction } from "@/app/app/[orgSlug]/people/actions";
import { createTask, updateTask } from "@/app/app/[orgSlug]/tasks/actions";
import { AmbientButton, AmbientWhy, MAX_AMBIENT } from "@/components/ambient/ambient-button";
import { AmbientPopover } from "@/components/inbox/row-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import {
  awayDays,
  joinedThisWeek,
  needsATask,
  newcomerReason,
  tooMuchOnPlate,
} from "@/lib/ambient/people";
import { runAction } from "@/lib/run-action";
import { addDaysToKey } from "@/lib/tasks/dates";
import type { PersonSheet } from "@/server/profiles/directory";

/**
 * A profile's ambient buttons (Buttons canvas, People): Say hi and Add to a
 * team for someone new, Check in on someone away a month, Give them a task
 * to someone around with nothing open, and Hand one off when they own too
 * much. The first two that apply, with the first one's reason under them.
 */
export function PersonAmbient({
  orgId,
  orgSlug,
  person,
  viewerId,
  canManageTasks,
}: {
  orgId: string;
  orgSlug: string;
  person: PersonSheet;
  viewerId: string;
  /** Owners and admins reassign anyone's tasks; anyone hands off their own. */
  canManageTasks: boolean;
}) {
  // The facts are read once, when the profile opens (react-hooks/purity).
  const [now] = useState(() => new Date());
  const isSelf = person.id === viewerId;
  const first = person.name?.trim().split(/\s+/)[0] ?? "them";
  const activity = {
    online: person.online,
    lastSeenAt: person.lastSeenAt,
    joinedAt: person.joinedAt,
  };
  const shown: { key: string; reason: string; node: ReactNode }[] = [];

  if (!isSelf && joinedThisWeek(person.joinedAt, now)) {
    const reason = newcomerReason(person.joinedAt, Boolean(person.team), now);
    // Said hi already: Add to a team may still be left.
    if (!person.sent.hi)
      shown.push({
        key: "hi",
        reason,
        node: (
          <AmbientButton
            action={{
              key: "hi",
              label: "Say hi",
              reason,
              tone: "solid",
              ariaLabel: `Say hi to ${first}`,
              run: () => sendMemberNoteAction(orgId, person.id, "hi"),
              done: `Said hi to ${first}`,
            }}
          />
        ),
      });
    if (!person.team) {
      shown.push({
        key: "team",
        reason,
        node: (
          <AmbientButton
            action={{
              key: "team",
              label: "Add to a team",
              reason,
              // A seat is picked on the org chart itself.
              href: `/app/${encodeURIComponent(orgSlug)}/people?view=chart`,
            }}
          />
        ),
      });
    }
  }

  const away = isSelf || person.sent.checkIn ? null : awayDays(activity, now);
  if (away !== null) {
    const reason = `Not around for ${away} days`;
    shown.push({
      key: "checkin",
      reason,
      node: (
        <AmbientButton
          action={{
            key: "checkin",
            label: "Check in",
            reason,
            ariaLabel: `Check in with ${first}`,
            run: () => sendMemberNoteAction(orgId, person.id, "checkin"),
            done: `Checked in with ${first}`,
          }}
        />
      ),
    });
  }

  if (needsATask({ ...activity, openTasks: person.taskCount }, now)) {
    const reason = isSelf
      ? "You're around, with nothing open"
      : `${first} is around, with nothing open`;
    shown.push({
      key: "task",
      reason,
      node: (
        <GiveATask orgId={orgId} person={person} first={first} reason={reason} isSelf={isSelf} />
      ),
    });
  }

  const handOff = person.handOff;
  if (
    handOff &&
    tooMuchOnPlate(person.ownedOpen) &&
    (isSelf || canManageTasks) &&
    handOff.tasks.length > 0
  ) {
    const reason = `${person.ownedOpen} open tasks on ${isSelf ? "your" : `${first}'s`} plate`;
    shown.push({
      key: "handoff",
      reason,
      node: <HandOneOff orgId={orgId} handOff={handOff} reason={reason} />,
    });
  }

  const actions = shown.slice(0, MAX_AMBIENT);
  if (actions.length === 0) return null;
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {actions.map((a) => (
          <span key={a.key} className="inline-flex">
            {a.node}
          </span>
        ))}
      </span>
      <AmbientWhy>{actions[0]!.reason}</AmbientWhy>
    </span>
  );
}

/** Give them a task: a title, and it's theirs. */
function GiveATask({
  orgId,
  person,
  first,
  reason,
  isSelf,
}: {
  orgId: string;
  person: PersonSheet;
  first: string;
  reason: string;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [pending, start] = useTransition();
  const due = addDaysToKey(person.todayKey, 7);
  return (
    <AmbientPopover
      action={{
        key: "task",
        label: isSelf ? "Take a task" : "Give them a task",
        reason,
        ariaLabel: isSelf ? "Make yourself a task" : `Give ${first} a task`,
      }}
    >
      {(close) => (
        <form
          className="space-y-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            const text = title.trim();
            if (!text || pending) return;
            start(async () => {
              const result = await runAction(() =>
                // Due in a week: an organization may require a date on every task.
                createTask(orgId, { title: text, ownerId: person.id, dueDate: due }),
              );
              if (!result) return;
              if ("error" in result && result.error) {
                toast({ title: result.error, tone: "error" });
                return;
              }
              if ("confirm" in result && result.confirm) {
                toast({
                  title: `${first} is above you on the org chart`,
                  description: "Make the task in Tasks to confirm giving it to them.",
                });
                return;
              }
              close();
              setTitle("");
              toast({ title: isSelf ? "Task added" : `Gave ${first} a task` });
              router.refresh();
            });
          }}
        >
          <Input
            autoFocus
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs doing"
            aria-label="Task title"
          />
          <p className="text-muted-foreground text-[12.5px]">
            Due in a week. Change it on the task.
          </p>
          <Button type="submit" size="sm" className="w-full" disabled={!title.trim() || pending}>
            {isSelf ? "Add it" : `Give it to ${first}`}
          </Button>
        </form>
      )}
    </AmbientPopover>
  );
}

/** Hand one off: one of their soonest tasks, to whoever has the least on. */
function HandOneOff({
  orgId,
  handOff,
  reason,
}: {
  orgId: string;
  handOff: NonNullable<PersonSheet["handOff"]>;
  reason: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const to = handOff.to;
  const toFirst = to.name?.trim().split(/\s+/)[0] ?? "them";
  return (
    <AmbientPopover className="w-80" action={{ key: "handoff", label: "Hand one off", reason }}>
      {(close) => (
        <div className="space-y-2">
          <p className="text-muted-foreground text-[13px]">
            {toFirst} has the least on right now. Pick one to hand over.
          </p>
          <ul className="flex flex-col gap-1">
            {handOff.tasks.map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 break-words">{t.title}</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  aria-label={`Hand ${t.title} to ${toFirst}`}
                  onClick={() =>
                    start(async () => {
                      const result = await runAction(() =>
                        updateTask(orgId, t.id, { ownerId: to.id }),
                      );
                      if (!result) return;
                      if ("error" in result && result.error) {
                        toast({ title: result.error, tone: "error" });
                        return;
                      }
                      if ("confirm" in result && result.confirm) {
                        toast({
                          title: `${toFirst} is above you on the org chart`,
                          description: "Open the task to confirm handing it to them.",
                        });
                        return;
                      }
                      close();
                      toast({ title: `Handed to ${toFirst}` });
                      router.refresh();
                    })
                  }
                >
                  To {toFirst}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </AmbientPopover>
  );
}
