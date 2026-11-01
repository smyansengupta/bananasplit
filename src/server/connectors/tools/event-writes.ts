import "server-only";

import { z } from "zod";

import type { RSVPStatus } from "@/generated/prisma/client";
import { NotFoundError } from "@/lib/auth/errors";
import { setOwnRsvp } from "@/server/events/rsvp";

import { CALENDAR, eventSummary, findEventSummary } from "./events";
import { refOf } from "./ids";
import { itemArg, readResult, spaceRef, type ConnectorSession, type ToolRegistrar } from "./shared";
import { OVERWRITES, refuseOn, writeInSpace } from "./write";

/**
 * rsvp_to_event (docs/features/ai-connectors.md, Phase 3): the member
 * answers their own invitation, as the calendar's RSVP buttons do
 * (setOwnRsvp, src/server/events/rsvp.ts). An event they can see but
 * aren't invited to is refused; one they can't see is not found.
 */

const RSVP_IN: Record<"going" | "maybe" | "not_going", RSVPStatus> = {
  going: "YES",
  maybe: "MAYBE",
  not_going: "NO",
};

const rsvpInput = z.object({
  id: itemArg("event"),
  rsvp: z.enum(["going", "maybe", "not_going"]).describe("The member's answer."),
});

const rsvpOutput = z.object({ space: spaceRef, event: eventSummary });

export async function rsvpToEventTool(
  session: ConnectorSession,
  raw: z.input<typeof rsvpInput>,
  now: Date = new Date(),
): Promise<z.infer<typeof rsvpOutput>> {
  const args = rsvpInput.parse(raw);
  const ref = refOf(args.id, "event");
  return writeInSpace(session, "rsvp_to_event", ref.spaceId, CALENDAR, async (ctx, space) => {
    if (!(await findEventSummary(ctx, space, ref.id, now))) throw new NotFoundError();
    refuseOn(await setOwnRsvp(ctx, ref.id, RSVP_IN[args.rsvp]));
    const event = await findEventSummary(ctx, space, ref.id, now);
    if (!event) throw new NotFoundError();
    return {
      output: { space: { id: space.id, name: space.name }, event },
      target: { type: "Event", id: ref.id },
    };
  });
}

export const registerEventWrites: ToolRegistrar = (server, session) => {
  server.registerTool(
    "rsvp_to_event",
    {
      title: "RSVP to an event",
      description:
        "Answers the member's own invitation to an event: going, maybe or not going, replacing any earlier answer. Only for events the member is invited to.",
      inputSchema: rsvpInput,
      outputSchema: rsvpOutput,
      annotations: OVERWRITES,
    },
    (args) => readResult("rsvp_to_event", () => rsvpToEventTool(session, args)),
  );
};
