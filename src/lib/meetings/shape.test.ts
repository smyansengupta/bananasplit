import { describe, expect, it } from "vitest";

import { SHAPES, SHAPE_META, newMeetingAsk, shapeFields, shapeFromParam } from "./shape";

/**
 * The three shapes a new meeting starts as (docs/features/meetings.md): what
 * each is called, and which halves of the form it asks about. The form sends
 * only what the chosen shape asks for, so these tables are what keeps a
 * meeting from carrying a place it was never given, or a call.
 */

describe("SHAPES", () => {
  it("are online, in person and event, in the order the form lists them", () => {
    expect(SHAPES).toEqual(["online", "in-person", "event"]);
  });
});

describe("SHAPE_META", () => {
  it("names each shape and says what it is for", () => {
    expect(SHAPE_META).toEqual({
      online: { label: "Online", hint: "A Google Meet, Zoom or Teams call" },
      "in-person": { label: "In person", hint: "A room or an address" },
      event: { label: "Event", hint: "Either of those, with a public sign-up page" },
    });
  });

  it("covers every shape", () => {
    expect(Object.keys(SHAPE_META).sort()).toEqual([...SHAPES].sort());
  });
});

describe("shapeFields", () => {
  it("asks an online meeting for a call and nothing else", () => {
    expect(shapeFields("online")).toEqual({ place: false, call: true, signUp: false });
  });

  it("asks an in-person meeting for a place and nothing else", () => {
    expect(shapeFields("in-person")).toEqual({ place: true, call: false, signUp: false });
  });

  it("asks an event for a place, a call and a sign-up page", () => {
    expect(shapeFields("event")).toEqual({ place: true, call: true, signUp: true });
  });
});

describe("shapeFromParam", () => {
  it("reads the three shapes", () => {
    expect(shapeFromParam("online")).toBe("online");
    expect(shapeFromParam("in-person")).toBe("in-person");
    expect(shapeFromParam("event")).toBe("event");
  });

  it("reads the RSVPs page's old ?new=rsvp as an event", () => {
    expect(shapeFromParam("rsvp")).toBe("event");
  });

  it("reads anything else as no shape", () => {
    expect(shapeFromParam("1")).toBeNull();
    expect(shapeFromParam("")).toBeNull();
    expect(shapeFromParam("Online")).toBeNull();
    expect(shapeFromParam("in_person")).toBeNull();
    expect(shapeFromParam(null)).toBeNull();
    expect(shapeFromParam(undefined)).toBeNull();
  });
});

describe("newMeetingAsk", () => {
  it("reads ?new=1 as a new meeting with no shape picked", () => {
    expect(newMeetingAsk("1")).toEqual({ shape: null });
  });

  it("reads a shape, and the old ?new=rsvp as an event", () => {
    expect(newMeetingAsk("online")).toEqual({ shape: "online" });
    expect(newMeetingAsk("in-person")).toEqual({ shape: "in-person" });
    expect(newMeetingAsk("event")).toEqual({ shape: "event" });
    expect(newMeetingAsk("rsvp")).toEqual({ shape: "event" });
  });

  it("reads anything else as no ask at all", () => {
    expect(newMeetingAsk("")).toBeNull();
    expect(newMeetingAsk("yes")).toBeNull();
    expect(newMeetingAsk("Online")).toBeNull();
    expect(newMeetingAsk(null)).toBeNull();
    expect(newMeetingAsk(undefined)).toBeNull();
  });
});
