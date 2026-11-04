"use server";

import { z } from "zod";

import { NotificationType } from "@/generated/prisma/enums";
import { NotFoundError } from "@/lib/auth/errors";
import { requirePermission } from "@/lib/auth/permissions";
import { draftAgenda, matchOwner, todosWithoutTasks } from "@/lib/ambient/meetings";
import { addDaysToKey, localDateKey } from "@/lib/tasks/dates";
import { writeOrgAuditLog } from "@/server/audit";
import { withOrgAction, type OrgContext } from "@/server/db/context";
import * as events from "@/server/events/service";
import {
  carryOverTasks,
  linkedTaskIds,
  meetingNoteItems,
  type MeetingRef,
} from "@/server/meetings/ambient";
import { notifyUsers } from "@/server/notifications";
import * as tasks from "@/server/tasks/service";

import { actionError } from "../calendar/action-result";

/**
 * A meeting's ambient buttons (Buttons2: Calendar and Meetings), each one
 * job in one withOrgAction transaction, as the member. Every one changes
 * the meeting or speaks for it, so each is for whoever can edit it
 * (events.write), and each leaves an audit entry. Each reads the meeting
 * again rather than trusting what the page saw. Results are { error } or
 * {} (with a count where the toast says one).
 */

export interface AmbientResult {
  error?: string;
  count?: number;
}

const GONE = "That meeting no longer exists.";
const idSchema = z.string().min(1).max(100);

class Gone extends Error {}

async function loadMeeting(ctx: OrgContext, eventId: string) {
  const event = await ctx.db.event.findFirst({
    where: {
      id: idSchema.parse(eventId),
      organizationId: ctx.organizationId,
      deletedAt: null,
      mergedIntoId: null,
    },
    select: {
      id: true,
      title: true,
      description: true,
      startsAt: true,
      endsAt: true,
      seriesId: true,
      rsvpEnabled: true,
      rsvpSlug: true,
      googleSyncState: true,
      organization: { select: { slug: true, timezone: true } },
    },
  });
  if (!event) throw new Gone();
  return event;
}

type Meeting = Awaited<ReturnType<typeof loadMeeting>>;

function ref(e: Meeting): MeetingRef {
  return { id: e.id, title: e.title, startsAt: e.startsAt, seriesId: e.seriesId };
}

function hosted<Args extends unknown[]>(
  handler: (ctx: OrgContext, event: Meeting, ...args: Args) => Promise<AmbientResult>,
) {
  const tx = withOrgAction(async (ctx: OrgContext, eventId: string, ...args: Args) => {
    requirePermission(ctx, "events.write");
    try {
      return await handler(ctx, await loadMeeting(ctx, eventId), ...args);
    } catch (error) {
      if (error instanceof Gone) return { error: GONE };
      if (error instanceof tasks.TaskError) return { error: error.message };
      throw error;
    }
  });
  return async (orgId: string, eventId: string, ...args: Args): Promise<AmbientResult> => {
    try {
      return await tx(orgId, eventId, ...args);
    } catch (error) {
      if (error instanceof NotFoundError) return { error: GONE };
      return actionError(error);
    }
  };
}

function audit(ctx: OrgContext, event: Meeting, action: string, diff: Record<string, unknown>) {
  return writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action,
    targetType: "Event",
    targetId: event.id,
    diff,
  });
}

/** Links tasks to the meeting (event to task), skipping any linked either way already. */
async function linkTasks(ctx: OrgContext, eventId: string, taskIds: readonly string[]) {
  const have = new Set(await linkedTaskIds(ctx.db, ctx.organizationId, eventId));
  const fresh = taskIds.filter((id) => !have.has(id));
  if (fresh.length === 0) return;
  await ctx.db.itemLink.createMany({
    data: fresh.map((id) => ({
      organizationId: ctx.organizationId,
      fromKind: "event",
      fromId: eventId,
      toKind: "task",
      toId: id,
      createdById: ctx.userId,
    })),
    skipDuplicates: true,
  });
}

/** Adds lines to the agenda that it doesn't have yet; returns how many. */
async function appendToAgenda(
  ctx: OrgContext,
  event: Meeting,
  items: readonly { id: string; title: string }[],
): Promise<number> {
  const before = event.description ?? "";
  const fresh = items.filter((t) => !before.includes(`/tasks/${t.id}`));
  if (fresh.length === 0) return 0;
  const lines = draftAgenda(
    fresh.map((t) => ({ title: t.title, href: `/app/${event.organization.slug}/tasks/${t.id}` })),
  );
  const description = before.trim() ? `${before.trimEnd()}\n${lines}` : lines;
  await events.updateEvent(ctx, event.id, { description: description.slice(0, 10_000) });
  return fresh.length;
}

/**
 * "Draft from open items": tomorrow's meeting has no agenda, so it gets one,
 * a linked line for each open task on it and each of last time's still open.
 */
export const draftAgendaFromOpenItems = hosted(async (ctx, event) => {
  if (event.description?.trim()) return { error: "This meeting has an agenda already." };
  const ids = await linkedTaskIds(ctx.db, ctx.organizationId, event.id);
  const own = ids.length
    ? await ctx.db.task.findMany({
        where: {
          organizationId: ctx.organizationId,
          id: { in: ids },
          deletedAt: null,
          status: { not: "COMPLETED" },
        },
        select: { id: true, title: true },
        orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      })
    : [];
  const carried = await carryOverTasks(ctx.db, ctx.organizationId, ref(event), ids);
  const items = [...own, ...carried];
  if (items.length === 0) return { error: "Nothing is open to put on it." };
  const count = await appendToAgenda(ctx, event, items);
  await audit(ctx, event, "event.agenda_drafted", { items: count });
  return { count };
});

/**
 * "Carry them over": last time's action items still open join this
 * meeting, as its tasks and on its agenda.
 */
export const carryOverActionItems = hosted(async (ctx, event) => {
  const ids = await linkedTaskIds(ctx.db, ctx.organizationId, event.id);
  const carried = await carryOverTasks(ctx.db, ctx.organizationId, ref(event), ids);
  if (carried.length === 0) return { error: "Last time's action items are all done." };
  await linkTasks(
    ctx,
    event.id,
    carried.map((t) => t.id),
  );
  await appendToAgenda(ctx, event, carried);
  await audit(ctx, event, "event.action_items_carried", { tasks: carried.length });
  return { count: carried.length };
});

/**
 * "Turn 3 to-dos into tasks": each open to-do in the meeting's notes that
 * isn't a task yet becomes one, linked to the meeting, owned by the member
 * it names ("Lucas: ...") when exactly one member has that name. Made
 * through the task service, with its checks and notifications; one it
 * won't hand to that person is made without an owner instead.
 */
export const turnTodosIntoTasks = hosted(async (ctx, event) => {
  const notes = await meetingNoteItems(ctx.db, ctx.organizationId, event.id);
  const ids = await linkedTaskIds(ctx.db, ctx.organizationId, event.id);
  const existing = ids.length
    ? await ctx.db.task.findMany({
        where: { organizationId: ctx.organizationId, id: { in: ids }, deletedAt: null },
        select: { title: true },
      })
    : [];
  const todos = todosWithoutTasks(
    notes.todos,
    existing.map((t) => t.title),
  ).slice(0, 25);
  if (todos.length === 0) return { error: "Every to-do is a task already." };
  const members = await ctx.db.membership.findMany({
    where: { organizationId: ctx.organizationId },
    select: { user: { select: { id: true, name: true } } },
  });
  const people = members.map((m) => m.user);
  const env = await tasks.loadTaskEnv(ctx);
  // Where every task needs a due date, a week out: the notes don't give one.
  const due = env.org.taskRequireDueDate
    ? { dueDate: addDaysToKey(localDateKey(new Date(), env.org.timezone), 7) }
    : {};
  const made: string[] = [];
  for (const todo of todos) {
    const title = todo.title.slice(0, 200);
    const ownerId = matchOwner(todo.ownerName, people);
    let result = await tasks.createTask(env, { title, ownerId, ...due });
    // Above them on the chart (it would ask first) or refused: make it unowned.
    if (ownerId && (result.confirm || result.error)) {
      result = await tasks.createTask(env, { title, ownerId: null, ...due });
    }
    if (result.error) return { error: result.error };
    if (result.taskId) made.push(result.taskId);
  }
  await linkTasks(ctx, event.id, made);
  await audit(ctx, event, "event.todos_to_tasks", { tasks: made.length });
  return { count: made.length };
});

/** One reminder per meeting per day, whoever clicks it. */
function dayStamp(event: Meeting): string {
  return localDateKey(new Date(), event.organization.timezone);
}

/** "Remind maybes": an in-app reminder (and its email) to everyone who said maybe. */
export const remindMaybes = hosted(async (ctx, event) => {
  if (event.startsAt <= new Date()) return { error: "This meeting has started." };
  const maybes = await ctx.db.eventAttendee.findMany({
    where: { organizationId: ctx.organizationId, eventId: event.id, rsvp: "MAYBE" },
    select: { userId: true },
  });
  const to = maybes.map((a) => a.userId).filter((id) => id !== ctx.userId);
  if (to.length === 0) return { error: "Nobody is a maybe." };
  await notifyUsers(ctx.db, ctx.organizationId, to, {
    type: NotificationType.EVENT_REMINDER,
    title: `Are you going to "${event.title}"?`,
    body: "You said maybe. Let the host know either way.",
    linkUrl: `/app/${event.organization.slug}/meetings/${event.id}`,
    actorId: ctx.userId,
    dedupeKey: `remind-maybes:${event.id}:${dayStamp(event)}`,
  });
  await audit(ctx, event, "event.maybes_reminded", { people: to.length });
  return { count: to.length };
});

/**
 * "Remind members": two days out with few sign-ups, every member who hasn't
 * answered or signed up hears about it, with the sign-up link.
 */
export const remindMembers = hosted(async (ctx, event) => {
  if (event.startsAt <= new Date()) return { error: "This event has started." };
  const members = await ctx.db.membership.findMany({
    where: { organizationId: ctx.organizationId },
    select: { userId: true },
  });
  const answered = await ctx.db.eventAttendee.findMany({
    where: { organizationId: ctx.organizationId, eventId: event.id, rsvp: { in: ["YES", "NO"] } },
    select: { userId: true },
  });
  const signedUp = await ctx.db.eventRegistration.findMany({
    where: {
      organizationId: ctx.organizationId,
      eventId: event.id,
      userId: { not: null },
      status: { in: ["GOING", "WAITLIST"] },
    },
    select: { userId: true },
  });
  const skip = new Set([ctx.userId, ...answered.map((a) => a.userId)]);
  for (const r of signedUp) if (r.userId) skip.add(r.userId);
  const to = members.map((m) => m.userId).filter((id) => !skip.has(id));
  if (to.length === 0) return { error: "Everyone has answered already." };
  await notifyUsers(ctx.db, ctx.organizationId, to, {
    type: NotificationType.EVENT_REMINDER,
    title: `"${event.title}" is coming up`,
    body: "Spots are open. Sign up if you can make it.",
    linkUrl: `/app/${event.organization.slug}/meetings/${event.id}`,
    actorId: ctx.userId,
    dedupeKey: `remind-members:${event.id}:${dayStamp(event)}`,
  });
  await audit(ctx, event, "event.members_reminded", { people: to.length });
  return { count: to.length };
});

const messageSchema = z
  .string()
  .trim()
  .min(1, "Write a few words first.")
  .max(2000, "Keep it under 2,000 characters.");

/**
 * "Send a thank-you", once it's over: in-app (and by email, as members
 * choose) to the members who came or signed up. Guests without an account
 * aren't reached: the RSVP emails have no thank-you yet.
 */
export const sendThankYou = hosted(async (ctx, event, message: unknown) => {
  const parsed = messageSchema.safeParse(message);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Write a few words." };
  if (event.endsAt > new Date()) return { error: "It isn't over yet." };
  const going = await ctx.db.eventAttendee.findMany({
    where: { organizationId: ctx.organizationId, eventId: event.id, rsvp: "YES" },
    select: { userId: true },
  });
  const guests = await ctx.db.eventRegistration.findMany({
    where: {
      organizationId: ctx.organizationId,
      eventId: event.id,
      userId: { not: null },
      OR: [{ status: "GOING" }, { checkedInAt: { not: null } }],
    },
    select: { userId: true },
  });
  const ids = new Set(going.map((a) => a.userId));
  for (const g of guests) if (g.userId) ids.add(g.userId);
  ids.delete(ctx.userId);
  // Only current members can be notified.
  const members = await ctx.db.membership.findMany({
    where: { organizationId: ctx.organizationId, userId: { in: [...ids] } },
    select: { userId: true },
  });
  const to = members.map((m) => m.userId);
  if (to.length === 0) return { error: "No members to thank: guests aren't emailed a thank-you." };
  await notifyUsers(ctx.db, ctx.organizationId, to, {
    type: NotificationType.EVENT_UPDATED,
    title: `Thanks for coming to "${event.title}"`,
    body: parsed.data,
    linkUrl: `/app/${event.organization.slug}/meetings/${event.id}`,
    actorId: ctx.userId,
    dedupeKey: `thank-you:${event.id}`,
  });
  await audit(ctx, event, "event.thank_you_sent", { people: to.length });
  return { count: to.length };
});
