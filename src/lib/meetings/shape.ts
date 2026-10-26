import type { MeetingFormat } from "@/generated/prisma/enums";

/**
 * What the Meetings list calls each way a meeting happens
 * (docs/features/meetings.md). The enum is the stored fact; this is how it reads.
 */
export const FORMAT_LABEL: Record<MeetingFormat, string> = {
  ONLINE: "Online",
  IN_PERSON: "In person",
  HYBRID: "Hybrid",
};

/**
 * The three things a new meeting can be, picked first in the form
 * (docs/features/meetings.md). A shape is a choice about which questions the
 * form asks, not a stored fact: what is stored is the place, the call and the
 * sign-up page the answers add up to, and the Meetings list reads that back as
 * a format.
 */
export type MeetingShape = "online" | "in-person" | "event";

/** In the order the form lists them. */
export const SHAPES: readonly MeetingShape[] = ["online", "in-person", "event"];

export const SHAPE_META: Record<MeetingShape, { label: string; hint: string }> = {
  online: { label: "Online", hint: "A Google Meet, Zoom or Teams call" },
  "in-person": { label: "In person", hint: "A room or an address" },
  event: { label: "Event", hint: "Either of those, with a public sign-up page" },
};

/**
 * Which questions a shape asks. The form sends an answer only for the ones its
 * shape asks, so a place typed and then switched away from, or a call chosen
 * and then switched away from, is never saved.
 */
export function shapeFields(shape: MeetingShape): {
  /** Location, and how to find it. */
  place: boolean;
  /** The video call. */
  call: boolean;
  /** A public sign-up page, turned on when the meeting is saved. */
  signUp: boolean;
} {
  switch (shape) {
    case "online":
      return { place: false, call: true, signUp: false };
    case "in-person":
      return { place: true, call: false, signUp: false };
    case "event":
      return { place: true, call: true, signUp: true };
  }
}

/**
 * A shape from a `?new=` value, which is how a link asks the form to open as
 * one. "rsvp" is what the RSVPs page has always sent, and means an event.
 * Anything else is no shape, so the form falls back to its own default.
 */
export function shapeFromParam(value: string | null | undefined): MeetingShape | null {
  if (value === "rsvp") return "event";
  return SHAPES.find((shape) => shape === value) ?? null;
}

/**
 * What a `?new=` value asks for: nothing (null), a new meeting with nothing
 * preset (`1`, the create menu's), or a new meeting on a shape (`online`,
 * `in-person`, `event`, and the old `rsvp`). The Calendar and Meetings both
 * read it, so a link that opens the form means the same in either.
 */
export function newMeetingAsk(
  value: string | null | undefined,
): { shape: MeetingShape | null } | null {
  if (value === "1") return { shape: null };
  const shape = shapeFromParam(value);
  return shape ? { shape } : null;
}
