import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { todayStrip } from "@/lib/overview/today-strip";

import { TodayStrip } from "./today-strip";

/** Home's Today strip: its four numbers, the line under each and where each opens. */

const zones = { viewer: "America/Los_Angeles", org: "America/New_York" };
const base = {
  base: "/app/cbc",
  todayKey: "2026-11-02",
  zones,
};

describe("the Today strip", () => {
  it("counts what's late, waiting, due and coming, each opening its list", () => {
    const cells = todayStrip({
      ...base,
      overdue: { count: 1, first: { title: "Advisor check-in", dueKey: "2026-10-31" } },
      waiting: { count: 4, parts: { invites: 1, tasks: 0, requests: 2, reviews: 1 } },
      dueThisWeek: { count: 3, titles: ["Confirm speaker", "Room request", "Print flyers"] },
      events: {
        count: 6,
        days: 14,
        // Mon, Nov 2 at 7:00 PM in Los Angeles.
        next: {
          title: "Weekly exec sync",
          startsAt: new Date("2026-11-03T03:00:00Z"),
          allDay: false,
        },
      },
    });
    expect(cells.map((c) => [c.label, c.value, c.sub, c.href])).toEqual([
      ["Overdue", 1, "Advisor check-in, 2 days late", "/app/cbc/tasks?scope=mine&overdue=1"],
      ["Waiting on you", 4, "2 approvals, 1 form to review, 1 invite to answer", "/app/cbc/inbox"],
      ["Due this week", 3, "Confirm speaker, Room request", "/app/cbc/tasks?scope=mine"],
      ["Events, next 14 days", 6, "Next: Weekly exec sync, Today 7:00 PM", "/app/cbc/calendar"],
    ]);

    const html = renderToStaticMarkup(<TodayStrip cells={cells} />);
    expect(html).toContain('aria-label="Today"');
    expect(html).toContain('href="/app/cbc/tasks?scope=mine&amp;overdue=1"');
    expect(html).toContain('href="/app/cbc/inbox"');
    expect(html).toContain('href="/app/cbc/calendar"');
    // Only Overdue is tinted, and only while something is late.
    // Late work gets a danger chip with how late; the rest stay quiet.
    expect(cells[0]?.chip).toEqual({ text: "2 days late", tone: "destructive" });
    // A phone gets two by two.
    // The app's stat strip: a 2×2 grid on a phone.
    expect(html).toContain("grid-cols-2");
  });

  it("says so plainly when there's nothing, and doesn't guess an Inbox it couldn't read", () => {
    const cells = todayStrip({
      ...base,
      overdue: { count: 0, first: null },
      waiting: null,
      dueThisWeek: { count: 0, titles: [] },
      events: { count: 0, days: 14, next: null },
    });
    expect(cells.map((c) => c.sub)).toEqual([
      "Nothing late",
      "What needs you, in your Inbox",
      "Nothing due in the next 7 days",
      "Nothing on the calendar",
    ]);
    expect(cells[0]).toMatchObject({
      chip: { text: "All clear", tone: "success" },
      href: "/app/cbc/tasks?scope=mine",
    });
    const html = renderToStaticMarkup(<TodayStrip cells={cells} />);
    expect(html).not.toContain("late</span>");
    expect(html).toContain("–");
  });
});
