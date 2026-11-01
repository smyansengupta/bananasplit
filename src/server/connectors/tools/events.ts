import "server-only";

import { z } from "zod";

import type { EventKind, Prisma, RSVPStatus } from "@/generated/prisma/client";
import { NotFoundError } from "@/lib/auth/errors";
import { allDaySpan } from "@/lib/calendar/dates";
import { formatEventWhen } from "@/lib/calendar/format";
import { addDaysToKey, zonedInstant } from "@/lib/tasks/dates";
import { getEventById, getViewerRsvps } from "@/app/app/[orgSlug]/calendar/queries";
import type { OrgContext } from "@/server/db/context";

import { decodeCursor, listFingerprint, pageOf } from "./cursor";
import { itemId, refOf, type ItemRef } from "./ids";
import {
  ConnectorInputError,
  cursorArg,
  itemArg,
  limitArg,
  nextCursor,
  personOf,
  personRef,
  READ_ONLY,
  readResult,
  spaceArg,
  spaceRef,
  urlField,
  type ConnectorSession,
  type FetchedItem,
  type ToolRegistrar,
} from "./shared";
import { inSpace, type ToolSpace } from "./space";
import { zonedIso } from "./text";

/**
 * list_events and get_event (docs/features/ai-connectors.md): the space's
 * calendar as the member sees it, times in the member's own zone (all-day
 * events as the club's days), with RSVP counts and the member's own answer.
 */

export const CALENDAR = { feature: "rsvp", section: "calendar" } as const;

const RSVP_OUT: Record<RSVPStatus, "going" | "maybe" | "not_going" | "no_answer"> = {
  YES: "going",
  MAYBE: "maybe",
  NO: "not_going",
  PENDING: "no_answer",
};

const KIND_OUT: Record<EventKind, string> = {
  WORKSHOP: "workshop",
  SOCIAL: "social",
  HACKATHON: "hackathon",
  INFO_SESSION: "info_session",
  BOARD_MEETING: "board_meeting",
  OTHER: "other",
};

const rsvpField = z.enum(["going", "maybe", "not_going", "no_answer"]);

export const eventSummary = z.object({
  id: z.string().describe("The event's id, for get_event and fetch."),
  title: z.string(),
  starts: z
    .string()
    .describe("ISO 8601 in the member's zone; the first day (yyyy-mm-dd) for an all-day event."),
  ends: z
    .string()
    .describe("ISO 8601 in the member's zone; the last day (yyyy-mm-dd) for an all-day event."),
  allDay: z.boolean(),
  when: z.string().describe('The time as the app writes it ("Tomorrow, 6:00 PM – 7:30 PM").'),
  location: z.string().nullable(),
  kind: z.string().describe("workshop, social, hackathon, info_session, board_meeting or other."),
  yourRsvp: rsvpField.nullable().describe("The member's own answer, when they're invited."),
  rsvps: z
    .object({
      going: z.number().int(),
      maybe: z.number().int(),
      notGoing: z.number().int(),
      noAnswer: z.number().int(),
    })
    .describe("How the invited members have answered."),
  url: urlField,
});

const listOutput = z.object({
  space: spaceRef,
  timeZone: z.string().describe("The zone the times are in (the member's)."),
  events: z.array(eventSummary),
  nextCursor,
});

const eventDetail = eventSummary.extend({
  space: spaceRef,
  timeZone: z.string(),
  description: z.string().nullable(),
  host: z.string().nullable().describe("Who is hosting, by name."),
  meetingLink: z.string().nullable().describe("The call's link, for an online meeting."),
  attendees: z
    .array(z.object({ person: personRef, rsvp: rsvpField }))
    .describe("Invited members and their answers (the first 100)."),
  attendeeCount: z.number().int(),
  notes: z
    .array(z.object({ id: z.string(), title: z.string() }))
    .describe("Notes linked to the event that the member can read."),
});

export type EventSummary = z.infer<typeof eventSummary>;
export type EventDetail = z.infer<typeof eventDetail>;

interface EventRow {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  location: string | null;
  kind: EventKind;
}

type Counts = EventSummary["rsvps"];

const NO_ANSWERS: Counts = { going: 0, maybe: 0, notGoing: 0, noAnswer: 0 };

function countKey(rsvp: RSVPStatus): keyof Counts {
  const out = RSVP_OUT[rsvp];
  return out === "not_going" ? "notGoing" : out === "no_answer" ? "noAnswer" : out;
}

async function rsvpCounts(
  ctx: OrgContext,
  spaceId: string,
  eventIds: string[],
): Promise<Map<string, Counts>> {
  const out = new Map<string, Counts>();
  if (eventIds.length === 0) return out;
  const rows = await ctx.db.eventAttendee.groupBy({
    by: ["eventId", "rsvp"],
    where: { organizationId: spaceId, eventId: { in: eventIds } },
    _count: { _all: true },
  });
  for (const row of rows) {
    const counts = out.get(row.eventId) ?? { ...NO_ANSWERS };
    counts[countKey(row.rsvp)] += row._count._all;
    out.set(row.eventId, counts);
  }
  return out;
}

function summaryOf(
  space: ToolSpace,
  e: EventRow,
  mine: RSVPStatus | undefined,
  counts: Counts | undefined,
  now: Date,
): EventSummary {
  const span = e.allDay ? allDaySpan(e.startsAt, e.endsAt, space.orgZone) : null;
  return {
    id: itemId("event", space.id, e.id),
    title: e.title,
    starts: span ? span.start : zonedIso(e.startsAt, space.zone),
    ends: span ? span.lastDay : zonedIso(e.endsAt, space.zone),
    allDay: e.allDay,
    when: formatEventWhen(e, { viewer: space.zone, org: space.orgZone }, now),
    location: e.location,
    kind: KIND_OUT[e.kind],
    yourRsvp: mine ? RSVP_OUT[mine] : null,
    rsvps: counts ?? { ...NO_ANSWERS },
    url: space.url(`/calendar/${e.id}`),
  };
}

// ---------------------------------------------------------------- list_events

const momentArg = z
  .string()
  .max(40)
  .regex(/^\d{4}-\d{2}-\d{2}([T ][0-9:.]+(Z|[+-]\d{2}:?\d{2})?)?$/, "Use yyyy-mm-dd or ISO 8601");

const listInput = z.object({
  space: spaceArg,
  from: momentArg
    .optional()
    .describe(
      "Events still going on at or after this: a day (yyyy-mm-dd, from its start) or an ISO 8601 time, both in the member's zone unless the time gives an offset. Now, unless given.",
    ),
  to: momentArg
    .optional()
    .describe(
      "Events starting before this: a day (yyyy-mm-dd, through its end) or an ISO 8601 time, in the member's zone unless the time gives an offset.",
    ),
  limit: limitArg,
  cursor: cursorArg,
});

/** A local time with no zone: read in the member's. */
const LOCAL_TIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;

/**
 * A from/to argument as an instant: a day starts (or, for `to`, ends) in
 * the member's zone, and so does a time written without one.
 */
function moment(value: string, zone: string, end: boolean): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return zonedInstant(end ? addDaysToKey(value, 1) : value, 0, zone);
  }
  const local = LOCAL_TIME.exec(value);
  const date = local
    ? zonedInstant(local[1]!, Number(local[2]), zone, Number(local[3]))
    : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ConnectorInputError("A time isn't valid. Use yyyy-mm-dd or ISO 8601.");
  }
  return date;
}

export async function listEvents(
  session: ConnectorSession,
  raw: z.input<typeof listInput>,
  now: Date = new Date(),
): Promise<z.infer<typeof listOutput>> {
  const args = listInput.parse(raw);
  const list = listFingerprint("list_events", { ...args, limit: undefined, cursor: undefined });
  const position = decodeCursor(args.cursor, list);
  return inSpace(session, args.space, CALENDAR, async (ctx, space) => {
    const from = args.from ? moment(args.from, space.zone, false) : now;
    const to = args.to ? moment(args.to, space.zone, true) : null;
    const where: Prisma.EventWhereInput = {
      organizationId: space.id,
      deletedAt: null,
      mergedIntoId: null,
      endsAt: { gt: from },
      ...(to ? { startsAt: { lt: to } } : {}),
    };
    // One after another: a transaction has one connection.
    const rows = await ctx.db.event.findMany({
      where,
      select: {
        id: true,
        title: true,
        startsAt: true,
        endsAt: true,
        allDay: true,
        location: true,
        kind: true,
      },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      skip: position.offset,
      take: args.limit + 1,
    });
    const page = pageOf(rows, args.limit, list, position);
    const ids = page.items.map((e) => e.id);
    const mine = await getViewerRsvps(ctx.db, space.id, ctx.userId, ids);
    const counts = await rsvpCounts(ctx, space.id, ids);
    return {
      space: { id: space.id, name: space.name },
      timeZone: space.zone,
      events: page.items.map((e) => summaryOf(space, e, mine.get(e.id), counts.get(e.id), now)),
      nextCursor: page.nextCursor,
    };
  });
}

// ---------------------------------------------------------------- get_event

const ATTENDEES = 100;

/** How an event's invited members answered, and this member's own answer. */
function answersOf(ctx: OrgContext, attendees: { userId: string; rsvp: RSVPStatus }[]) {
  const counts = { ...NO_ANSWERS };
  for (const a of attendees) counts[countKey(a.rsvp)] += 1;
  return { counts, mine: attendees.find((a) => a.userId === ctx.userId)?.rsvp };
}

/** One event as list_events shows it; null when it isn't there. */
export async function findEventSummary(
  ctx: OrgContext,
  space: ToolSpace,
  eventId: string,
  now: Date,
): Promise<EventSummary | null> {
  const event = await getEventById(ctx.db, space.id, eventId, ctx.userId);
  if (!event) return null;
  const { counts, mine } = answersOf(ctx, event.attendees);
  return summaryOf(space, event, mine, counts, now);
}

async function loadEvent(
  ctx: OrgContext,
  space: ToolSpace,
  eventId: string,
  now: Date,
): Promise<EventDetail> {
  const event = await getEventById(ctx.db, space.id, eventId, ctx.userId);
  if (!event) throw new NotFoundError();
  const { counts, mine } = answersOf(ctx, event.attendees);
  return {
    ...summaryOf(space, event, mine, counts, now),
    space: { id: space.id, name: space.name },
    timeZone: space.zone,
    description: event.description,
    host: event.hostName?.trim() || event.host?.name?.trim() || null,
    meetingLink: event.conferenceUrl,
    attendees: event.attendees.slice(0, ATTENDEES).map((a) => ({
      person: personOf(space.id, a.user)!,
      rsvp: RSVP_OUT[a.rsvp],
    })),
    attendeeCount: event.attendees.length,
    // As the notes rules allow, and not while the club hides Files from members.
    notes: space.opens("notes")
      ? event.notes.map((n) => ({
          id: itemId("note", space.id, n.id),
          title: n.title.trim() || "Untitled note",
        }))
      : [],
  };
}

const getInput = z.object({ id: itemArg("event") });

export async function getEvent(
  session: ConnectorSession,
  raw: z.input<typeof getInput>,
  now: Date = new Date(),
): Promise<EventDetail> {
  const ref = refOf(getInput.parse(raw).id, "event");
  return inSpace(session, ref.spaceId, CALENDAR, (ctx, space) =>
    loadEvent(ctx, space, ref.id, now),
  );
}

/** An event for fetch: when, where, who is hosting, the description and the answers. */
export async function fetchEvent(session: ConnectorSession, ref: ItemRef): Promise<FetchedItem> {
  const now = new Date();
  const event = await inSpace(session, ref.spaceId, CALENDAR, (ctx, space) =>
    loadEvent(ctx, space, ref.id, now),
  );
  const { going, maybe, notGoing, noAnswer } = event.rsvps;
  const facts = [
    `When: ${event.when} (${event.timeZone})`,
    event.location && `Where: ${event.location}`,
    event.host && `Host: ${event.host}`,
    event.meetingLink && `Call: ${event.meetingLink}`,
    event.attendeeCount > 0 &&
      `Answers: ${going} going, ${maybe} maybe, ${notGoing} not going, ${noAnswer} not answered`,
    event.yourRsvp && `Your answer: ${event.yourRsvp.replace("_", " ")}`,
  ].filter(Boolean);
  return {
    id: event.id,
    title: event.title,
    text: [`# ${event.title}`, facts.join("\n"), event.description].filter(Boolean).join("\n\n"),
    url: event.url,
    metadata: {
      kind: "event",
      spaceId: event.space.id,
      space: event.space.name,
      starts: event.starts,
      ends: event.ends,
      allDay: event.allDay,
    },
  };
}

// ---------------------------------------------------------------- registration

export const registerEventTools: ToolRegistrar = (server, session) => {
  server.registerTool(
    "list_events",
    {
      title: "List events",
      description:
        "Lists events on one space's calendar in time order, from now unless a range is given, with times in the member's time zone, how many have answered going or maybe, and the member's own answer.",
      inputSchema: listInput,
      outputSchema: listOutput,
      annotations: READ_ONLY,
    },
    (args) => readResult("list_events", () => listEvents(session, args)),
  );
  server.registerTool(
    "get_event",
    {
      title: "Get an event",
      description:
        "Gets one event: when and where, the host, the description, who is invited and how they answered, and the notes linked to it.",
      inputSchema: getInput,
      outputSchema: eventDetail,
      annotations: READ_ONLY,
    },
    (args) => readResult("get_event", () => getEvent(session, args)),
  );
};
