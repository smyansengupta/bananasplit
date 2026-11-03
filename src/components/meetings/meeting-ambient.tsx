"use client";

import { useRouter } from "next/navigation";

import {
  addRsvpSeats,
  openRsvpWaitlist,
} from "@/app/app/[orgSlug]/calendar/[eventId]/rsvp/actions";
import { addLinkAction } from "@/app/app/[orgSlug]/links/actions";
import {
  carryOverActionItems,
  draftAgendaFromOpenItems,
  remindMaybes,
  remindMembers,
  sendThankYou,
  turnTodosIntoTasks,
  type AmbientResult,
} from "@/app/app/[orgSlug]/meetings/ambient-actions";
import { createNote } from "@/app/app/[orgSlug]/notes/actions";
import { createTask } from "@/app/app/[orgSlug]/tasks/actions";
import { AmbientActions } from "@/components/ambient/ambient-button";
import { DoorOpen, NotebookText, Video } from "@/components/icons";
import {
  AmbientField,
  AmbientMessage,
  AmbientRow,
  type AmbientItem,
} from "@/components/tasks/ambient-pills";
import { toast } from "@/components/ui/toaster";
import { createDecision, decide } from "@/server/decisions/actions";
import type { EventAmbientKind } from "@/lib/ambient/calendar";
import { todoLabel, type MeetingAmbientKind } from "@/lib/ambient/meetings";

/**
 * A meeting's ambient buttons (Buttons2: Calendar and Meetings). The page
 * decides what shows (src/lib/ambient, on the server, so the first paint
 * and the browser agree) and hands over the kinds and reasons; these do
 * each job in place. Their actions check again that the job still applies.
 */

/** A week from today in the browser's own calendar, as a date key. */
function weekFromToday(): string {
  const d = new Date(Date.now() + 7 * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type HeaderKind = EventAmbientKind | MeetingAmbientKind;

/** A count job: toast how many it reached, then step aside. */
function counted(job: () => Promise<AmbientResult>, words: (n: number) => string) {
  return async () => {
    const result = await job();
    if (!result.error) toast({ title: words(result.count ?? 0) });
    return result;
  };
}

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** The meeting header's ambient buttons, under the title: the first two. */
export function MeetingHeaderAmbient({
  orgId,
  orgSlug,
  eventId,
  title,
  items,
  joinUrl,
  noteId,
  rsvpUrl,
}: {
  orgId: string;
  orgSlug: string;
  eventId: string;
  title: string;
  items: readonly { kind: HeaderKind; reason: string }[];
  joinUrl: string | null;
  noteId: string | null;
  rsvpUrl: string | null;
}) {
  const router = useRouter();
  const base = `/app/${orgSlug}/meetings/${eventId}`;
  const built = items.map(({ kind, reason }): AmbientItem | null => {
    const key = kind;
    switch (kind) {
      case "join":
        return joinUrl
          ? {
              key,
              reason,
              action: {
                key,
                label: "Join",
                reason,
                icon: Video,
                tone: "solid",
                href: joinUrl,
                external: true,
              },
            }
          : null;
      case "take-notes":
        return noteId
          ? {
              key,
              reason,
              action: {
                key,
                label: "Take notes",
                reason,
                icon: NotebookText,
                href: `/app/${orgSlug}/notes/${noteId}`,
              },
            }
          : {
              key,
              reason,
              action: {
                key,
                label: "Take notes",
                reason,
                icon: NotebookText,
                // A note tied to the meeting, opened to write in.
                run: async () => {
                  const made = await createNote(orgId, {
                    title: `${title} meeting notes`,
                    eventId,
                  });
                  if (made.noteId) router.push(`/app/${orgSlug}/notes/${made.noteId}`);
                  return made;
                },
              },
            };
      case "draft-agenda":
        return {
          key,
          reason,
          action: {
            key,
            label: "Draft from open items",
            reason,
            tone: "spark",
            run: counted(
              () => draftAgendaFromOpenItems(orgId, eventId),
              (n) => `Agenda drafted with ${plural(n, "item", "items")}`,
            ),
          },
        };
      case "door":
        return {
          key,
          reason,
          action: {
            key,
            label: "Open door check-in",
            reason,
            icon: DoorOpen,
            tone: "solid",
            href: `${base}/rsvp/door`,
          },
        };
      case "open-waitlist":
        return {
          key,
          reason,
          action: {
            key,
            label: "Open a waitlist",
            reason,
            tone: "spark",
            run: () => openRsvpWaitlist(orgId, eventId),
            done: "New sign-ups join the waitlist",
          },
        };
      case "add-seats":
        return { key, reason, node: <AddSeats orgId={orgId} eventId={eventId} reason={reason} /> };
      case "share-rsvp":
        return rsvpUrl
          ? {
              key,
              reason,
              action: {
                key,
                label: "Share RSVP link",
                reason,
                run: async () => {
                  try {
                    if (typeof navigator.share === "function") {
                      await navigator.share({ title, url: rsvpUrl });
                      return {};
                    }
                    await navigator.clipboard.writeText(rsvpUrl);
                    toast({ title: "Link copied" });
                    return {};
                  } catch {
                    // Closing the share sheet isn't a failure; nothing to say.
                    return undefined;
                  }
                },
              },
            }
          : null;
      case "remind-members":
        return {
          key,
          reason,
          action: {
            key,
            label: "Remind members",
            reason,
            run: counted(
              () => remindMembers(orgId, eventId),
              (n) => `Reminded ${plural(n, "member", "members")}`,
            ),
          },
        };
      case "thank-you":
        return {
          key,
          reason,
          node: (
            <AmbientMessage
              label="Send a thank-you"
              reason={reason}
              hint="Goes to the members who came, in the app and by email as they choose."
              text={`Thanks for coming to ${title}! It was great to see you.`}
              send={(message) => sendThankYou(orgId, eventId, message)}
              done="Thank-you sent"
            />
          ),
        };
      case "log-attendance":
        return {
          key,
          reason,
          action: { key, label: "Log attendance", reason, href: `${base}/rsvp` },
        };
    }
  });
  return <AmbientRow items={built} why align="start" />;
}

/** Add seats: how many more, prefilled. */
function AddSeats({ orgId, eventId, reason }: { orgId: string; eventId: string; reason: string }) {
  return (
    <AmbientField
      label="Add seats"
      reason={reason}
      hint="More spots. People on the waitlist move up into them."
      initial="10"
      type="number"
      submitLabel="Add seats"
      submit={(value) => addRsvpSeats(orgId, eventId, Number(value))}
      done="Seats added"
    />
  );
}

/** The RSVP page's full-event buttons: Open a waitlist, Add seats. */
export function RsvpFullAmbient({
  orgId,
  eventId,
  items,
}: {
  orgId: string;
  eventId: string;
  items: readonly { kind: EventAmbientKind; reason: string }[];
}) {
  const built = items.map(({ kind, reason }): AmbientItem | null =>
    kind === "open-waitlist"
      ? {
          key: kind,
          reason,
          action: {
            key: kind,
            label: "Open a waitlist",
            reason,
            tone: "spark",
            run: () => openRsvpWaitlist(orgId, eventId),
            done: "New sign-ups join the waitlist",
          },
        }
      : kind === "add-seats"
        ? { key: kind, reason, node: <AddSeats orgId={orgId} eventId={eventId} reason={reason} /> }
        : null,
  );
  return <AmbientRow items={built} why align="start" />;
}

/** Carry them over, in the agenda: last time's action items still open. */
export function CarryOver({
  orgId,
  eventId,
  count,
}: {
  orgId: string;
  eventId: string;
  count: number;
}) {
  return (
    <AmbientActions
      why
      className="items-start"
      actions={[
        {
          key: "carry-over",
          label: "Carry them over",
          reason: `${plural(count, "action item", "action items")} from last time still open`,
          tone: "spark",
          run: counted(
            () => carryOverActionItems(orgId, eventId),
            (n) => `Carried over ${plural(n, "item", "items")}`,
          ),
        },
      ]}
    />
  );
}

/** Remind maybes, on the Invited card. */
export function RemindMaybes({
  orgId,
  eventId,
  count,
}: {
  orgId: string;
  eventId: string;
  count: number;
}) {
  return (
    <AmbientActions
      why
      className="items-start"
      actions={[
        {
          key: "remind-maybes",
          label: "Remind maybes",
          reason: `${plural(count, "maybe hasn't", "maybes haven't")} decided`,
          run: counted(
            () => remindMaybes(orgId, eventId),
            (n) => `Reminded ${plural(n, "maybe", "maybes")}`,
          ),
        },
      ]}
    />
  );
}

/**
 * Beside the meeting's tasks: while it's under way, Add an action item;
 * from its notes, Turn 3 to-dos into tasks and Log the decision.
 */
export function MeetingNotesAmbient({
  orgId,
  orgSlug,
  eventId,
  meetingTitle,
  underWay,
  todos,
  decision,
}: {
  orgId: string;
  orgSlug: string;
  eventId: string;
  meetingTitle: string;
  underWay: boolean;
  /** To-dos in the notes that aren't tasks yet. */
  todos: number;
  /** The first decision in the notes not yet logged. */
  decision: string | null;
}) {
  const items: (AmbientItem | null)[] = [
    underWay
      ? {
          key: "action-item",
          reason: "It's under way",
          node: (
            <AmbientField
              label="Add an action item"
              reason="It's under way"
              hint="A task from this meeting, linked to it."
              initial=""
              submitLabel="Add"
              submit={async (title) => {
                const make = async (extra: { dueDate?: string }) =>
                  (await createTask(orgId, { title, ...extra })) as {
                    error?: string;
                    taskId?: string;
                  };
                let made = await make({});
                // An organization that wants a date on every task: a week out.
                if (made.error && /due date/i.test(made.error)) {
                  made = await make({ dueDate: weekFromToday() });
                }
                if (made.error || !made.taskId)
                  return { error: made.error ?? "The task couldn't be made." };
                return addLinkAction(
                  orgId,
                  orgSlug,
                  { kind: "event", id: eventId },
                  { kind: "task", id: made.taskId },
                );
              }}
              done="Action item added"
            />
          ),
        }
      : null,
    todos > 0
      ? {
          key: "todos",
          reason: `${plural(todos, "to-do", "to-dos")} in the notes, no tasks yet`,
          action: {
            key: "todos",
            label: todoLabel(todos),
            reason: `${plural(todos, "to-do", "to-dos")} in the notes, no tasks yet`,
            tone: "spark",
            run: counted(
              () => turnTodosIntoTasks(orgId, eventId),
              (n) => `Made ${plural(n, "task", "tasks")}`,
            ),
          },
        }
      : null,
    decision
      ? {
          key: "decision",
          reason: "A decision in the notes",
          node: (
            <AmbientField
              label="Log the decision"
              reason="A decision in the notes"
              hint="Logged as decided, linked to this meeting."
              initial={decision}
              submitLabel="Log it"
              submit={async (text) => {
                const made = await createDecision(orgId, {
                  question: text,
                  links: [{ kind: "event", id: eventId }],
                });
                if (!made.ok) return made;
                return decide(orgId, made.id, `Decided at ${meetingTitle}`);
              }}
              done="Decision logged"
            />
          ),
        }
      : null,
  ];
  return <AmbientRow items={items} why align="start" />;
}

/** On the Events list: two days out with few sign-ups, Share RSVP link and Remind members. */
export function EventsListAmbient({
  orgId,
  eventId,
  title,
  rsvpUrl,
  items,
}: {
  orgId: string;
  eventId: string;
  title: string;
  rsvpUrl: string | null;
  items: readonly { kind: EventAmbientKind; reason: string }[];
}) {
  return (
    <span className="relative z-10">
      <MeetingHeaderAmbient
        orgId={orgId}
        orgSlug=""
        eventId={eventId}
        title={title}
        items={items.filter((a) => a.kind === "share-rsvp" || a.kind === "remind-members")}
        joinUrl={null}
        noteId={null}
        rsvpUrl={rsvpUrl}
      />
    </span>
  );
}
