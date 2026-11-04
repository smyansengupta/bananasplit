import { describe, expect, it } from "vitest";

import {
  decisionAction,
  decisionLine,
  decisionsFinding,
  eventIdOfHref,
  withAgendaLine,
  type DecisionRow,
} from "./decisions";

// Sunday, Nov 1 2026.
const TODAY = "2026-11-01";
const CTX = { todayKey: TODAY, timeZone: "UTC", viewerId: "me" };
const lucas = { id: "u1", name: "Lucas Salzgeber", image: null, avatar: null };

function row(over: Partial<DecisionRow> = {}): DecisionRow {
  return {
    id: "d1",
    question: "T-shirt vendor",
    detail: null,
    owner: null,
    createdById: null,
    createdAt: "2026-10-20T12:00:00.000Z",
    dueAt: null,
    links: [],
    poll: null,
    agenda: null,
    ...over,
  };
}

const poll = {
  id: "p1",
  title: "Date poll",
  href: "/app/cbc/forms/p1",
  voted: 7,
  eligible: 12,
  mine: false,
  open: true,
  closesAt: "2026-11-02T20:00:00.000Z",
  options: [
    { label: "Dec 5", votes: 4, pct: 57 },
    { label: "Nov 21", votes: 3, pct: 43 },
  ],
};

const meeting = (id: string) => ({
  kind: "meeting" as const,
  label: `Exec sync ${id}`,
  href: `/app/cbc/meetings/${id}`,
});

describe("decisionLine", () => {
  it("counts votes and says when the poll closes", () => {
    const d = row({ poll, owner: lucas });
    expect(decisionLine(d, CTX)).toBe("7 of 12 voted. Closes tomorrow.");
    expect(decisionAction(d)).toBe("vote");
  });

  it("doesn't ask you to vote twice, or on a closed poll", () => {
    expect(decisionAction(row({ poll: { ...poll, mine: true }, owner: lucas }))).toBeNull();
    const closed = row({
      poll: { ...poll, open: false },
      owner: lucas,
      dueAt: "2026-11-04T12:00:00.000Z",
    });
    expect(decisionAction(closed)).toBeNull();
    expect(decisionLine(closed, CTX)).toBe("7 of 12 voted. Voting closed. Decide by Wed.");
  });

  it("says when it came up more than once and nobody has it", () => {
    const d = row({ links: [meeting("a"), meeting("b")] });
    expect(decisionLine(d, CTX)).toBe("Raised twice. Nobody owns it.");
    expect(decisionAction(d)).toBe("take");
    expect(decisionLine(row({ links: [meeting("a"), meeting("b"), meeting("c")] }), CTX)).toBe(
      "Raised 3 times. Nobody owns it.",
    );
  });

  it("doesn't count one meeting linked twice", () => {
    expect(decisionLine(row({ links: [meeting("a"), meeting("a")] }), CTX)).toBe("Nobody owns it.");
  });

  it("offers the next meeting's agenda once someone owns it", () => {
    const d = row({
      owner: lucas,
      agenda: {
        eventId: "m2",
        title: "Exec sync",
        href: "/app/cbc/meetings/m2",
        dayKey: "2026-11-02",
        agenda: "",
        onAgenda: false,
      },
    });
    expect(decisionAction(d)).toBe("agenda");
    expect(decisionLine(d, CTX)).toBe("Lucas owns it. Put it on tomorrow's agenda?");
    const later = { ...d, agenda: { ...d.agenda!, dayKey: "2026-11-05" } };
    expect(decisionLine(later, CTX)).toBe("Lucas owns it. Put it on Thursday's agenda?");
  });

  it("says it's on the agenda once it is, and asks nothing", () => {
    const d = row({
      owner: { ...lucas, id: "me" },
      agenda: {
        eventId: "m2",
        title: "Exec sync",
        href: "/app/cbc/meetings/m2",
        dayKey: "2026-11-02",
        agenda: "- T-shirt vendor",
        onAgenda: true,
      },
    });
    expect(decisionAction(d)).toBeNull();
    expect(decisionLine(d, CTX)).toBe("Yours. On tomorrow's agenda.");
  });

  it("says when it's past its date", () => {
    expect(decisionLine(row({ owner: lucas, dueAt: "2026-10-30T12:00:00.000Z" }), CTX)).toBe(
      "Lucas owns it. Was due Fri, Oct 30.",
    );
  });
});

describe("decisionsFinding", () => {
  it("names the overdue ones first", () => {
    const rows = [row({ question: "Venue", dueAt: "2026-10-30T12:00:00.000Z" }), row()];
    expect(decisionsFinding(rows, CTX)).toEqual({ kind: "overdue", titles: ["Venue"] });
  });

  it("counts two or more with nobody on them", () => {
    expect(decisionsFinding([row(), row({ id: "d2" })], CTX)).toEqual({
      kind: "unowned",
      count: 2,
    });
    expect(decisionsFinding([row()], CTX)).toBeNull();
  });
});

describe("helpers", () => {
  it("reads a meeting's id from its link", () => {
    expect(eventIdOfHref("/app/cbc/meetings/abc123")).toBe("abc123");
    expect(eventIdOfHref("/app/cbc/calendar/abc123?x=1")).toBe("abc123");
    expect(eventIdOfHref("/app/cbc/notes/abc123")).toBeNull();
  });

  it("adds the question as the agenda's last line", () => {
    expect(withAgendaLine("", "Vendor?")).toBe("- Vendor?");
    expect(withAgendaLine("- Budget\n\n", "Vendor?")).toBe("- Budget\n- Vendor?");
  });
});
