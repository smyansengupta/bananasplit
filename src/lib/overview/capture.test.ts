import { describe, expect, it } from "vitest";

import { matchEvent, parseCapture, type CaptureEvent } from "./capture";

// Sunday, Nov 1 2026.
const TODAY = "2026-11-01";

const EVENTS: CaptureEvent[] = [
  { id: "fs", title: "Fall Social", dateKey: "2026-11-07" },
  { id: "w8", title: "Workshop 8", dateKey: "2026-11-04" },
  { id: "w", title: "Workshop", dateKey: "2026-11-02" },
  { id: "x", title: "Go", dateKey: "2026-11-03" },
];

const parse = (text: string) => parseCapture(text, TODAY, EVENTS);

describe("parseCapture", () => {
  it("reads the mockup's line: a date mid-sentence and the event it names", () => {
    const c = parse("Order pizza for Fall Social by Wed, about $180");
    expect(c.title).toBe("Order pizza for Fall Social, about $180");
    expect(c.dueKey).toBe("2026-11-04");
    expect(c.dueText).toBe("by Wed");
    expect(c.event?.id).toBe("fs");
  });

  it("is a plain task with no date or event", () => {
    expect(parse("Email the treasurer")).toEqual({
      title: "Email the treasurer",
      dueKey: null,
      dueText: null,
      event: null,
    });
  });

  it("reads today, tonight and tomorrow", () => {
    expect(parse("Book the room today").dueKey).toBe(TODAY);
    expect(parse("Print flyers tonight").dueKey).toBe(TODAY);
    expect(parse("Print flyers tomorrow").dueKey).toBe("2026-11-02");
    expect(parse("Print flyers tomorrow").title).toBe("Print flyers");
  });

  it("reads weekday names, with or without a lead word", () => {
    expect(parse("Send recap fri").dueKey).toBe("2026-11-06");
    expect(parse("Send recap on Friday").dueKey).toBe("2026-11-06");
    expect(parse("Send recap on Friday").title).toBe("Send recap");
    // "next" as the task form reads it: the next one after today.
    expect(parse("Send recap next thu").dueKey).toBe("2026-11-05");
  });

  it("reads month and day both ways round", () => {
    expect(parse("Renew domain Nov 12").dueKey).toBe("2026-11-12");
    expect(parse("Renew domain by 12 Nov").dueKey).toBe("2026-11-12");
    expect(parse("Renew domain November 12th").dueKey).toBe("2026-11-12");
    expect(parse("Renew domain 11/12").dueKey).toBe("2026-11-12");
  });

  it("rolls a passed day into next year", () => {
    expect(parse("File taxes Oct 3").dueKey).toBe("2027-10-03");
  });

  it("reads 'in 3 days' and 'next week'", () => {
    expect(parse("Follow up in 3 days").dueKey).toBe("2026-11-04");
    expect(parse("Follow up next week").dueKey).toBe("2026-11-02");
  });

  it("leaves names and common words alone without a lead word", () => {
    expect(parse("Call Tom about the venue").dueKey).toBeNull();
    expect(parse("Ask what we can do now").dueKey).toBeNull();
    expect(parse("Check who sat at the front").dueKey).toBeNull();
    expect(parse("May we use the hall").dueKey).toBeNull();
    expect(parse("Book the hall by sat").dueKey).toBe("2026-11-07");
  });

  it("keeps the text when the date is all there is", () => {
    const c = parse("tomorrow");
    expect(c.title).toBe("tomorrow");
    expect(c.dueKey).toBeNull();
  });

  it("takes only the first date", () => {
    const c = parse("Plan Monday's meeting by Friday");
    expect(c.dueKey).toBe("2026-11-06");
    expect(c.title).toBe("Plan Monday's meeting");
    expect(parse("Draft agenda wed, send it fri").dueKey).toBe("2026-11-04");
  });
});

describe("matchEvent", () => {
  it("prefers the longest title", () => {
    expect(matchEvent("Slides for Workshop 8", EVENTS)?.id).toBe("w8");
    expect(matchEvent("Slides for the workshop", EVENTS)?.id).toBe("w");
  });

  it("matches whole words only, and skips very short titles", () => {
    expect(matchEvent("Workshops are great", EVENTS)).toBeNull();
    expect(matchEvent("Go get snacks", EVENTS)).toBeNull();
  });

  it("takes the soonest of two events with the same title", () => {
    const twice = [
      { id: "late", title: "Exec sync", dateKey: "2026-11-09" },
      { id: "soon", title: "Exec sync", dateKey: "2026-11-02" },
    ];
    expect(matchEvent("Agenda for exec sync", twice)?.id).toBe("soon");
  });
});
