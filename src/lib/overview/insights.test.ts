import { describe, expect, it } from "vitest";

import {
  agendaItems,
  crowdedEventWeek,
  dayLoad,
  expectedHeadcount,
  myTasksFinding,
  pulseFinding,
  weekFinding,
} from "./insights";

const task = (id: string, dueKey: string) => ({ id, title: `Task ${id}`, dueKey });

describe("Home's findings", () => {
  it("warns when three of your deadlines land in a big event's week, naming the biggest", () => {
    // Mon Nov 2 to Sun Nov 8, 2026.
    const tasks = [task("a", "2026-11-03"), task("b", "2026-11-05"), task("c", "2026-11-08")];
    const events = [
      { id: "small", title: "Study hall", dayKey: "2026-11-04", size: 4 },
      { id: "big", title: "Fall Social", dayKey: "2026-11-06", size: 58 },
    ];
    const crowded = crowdedEventWeek(tasks, events);
    expect(crowded?.event.id).toBe("big");
    expect(crowded?.tasks.map((t) => t.id)).toEqual(["c", "b", "a"]);
    expect(myTasksFinding(crowded)).toEqual({
      tone: "warn",
      lead: "3 of your tasks are due the week of Fall Social:",
      text: "Task c, Task b and Task a.",
    });
    // Two deadlines that week, or none with an event: nothing to say.
    expect(crowdedEventWeek(tasks.slice(0, 2), events)).toBeNull();
    expect(crowdedEventWeek(tasks, [])).toBeNull();
  });

  it("finds a clash before a crowded day, and counts free evenings", () => {
    const clash = dayLoad(
      "2026-11-03",
      [
        { id: "a", title: "Workshop", allDay: false, start: 18 * 60, end: 20 * 60 },
        { id: "b", title: "Exec sync", allDay: false, start: 19 * 60, end: 20 * 60 },
      ],
      0,
    );
    expect(clash.clash?.map((e) => e.id)).toEqual(["a", "b"]);
    expect(clash.freeEvening).toBe(false);
    const crowded = dayLoad(
      "2026-11-06",
      [{ id: "s", title: "Fall Social", allDay: false, start: 19 * 60, end: 22 * 60 }],
      2,
    );
    expect(crowded.crowded).toBe(true);
    expect(dayLoad("2026-11-05", [], 1)).toMatchObject({
      clash: null,
      crowded: false,
      freeEvening: true,
    });
    expect(
      weekFinding([
        {
          weekday: "Friday",
          load: crowded,
          events: [{ title: "Fall Social" }],
          deadlines: [{ title: "speaker" }],
        },
        { weekday: "Tuesday", load: clash, events: [], deadlines: [] },
      ]),
    ).toEqual({
      tone: "warn",
      lead: "Tuesday has a clash:",
      text: "Workshop and Exec sync overlap.",
    });
    expect(
      weekFinding([
        {
          weekday: "Friday",
          load: crowded,
          events: [{ title: "Fall Social" }],
          deadlines: [{ title: "speaker" }],
        },
      ])?.text,
    ).toBe("Fall Social and the speaker deadline all land on the same day.");
  });

  it("expects RSVPs times the past check-in rate, and nothing without one", () => {
    expect(expectedHeadcount(41, 0.81)).toBe(33);
    expect(expectedHeadcount(41, null)).toBeNull();
    expect(expectedHeadcount(0, 0.81)).toBeNull();
  });

  it("calls a record week, or a run under the average, and names the epic that moved", () => {
    const weeks = (...done: number[]) => done.map((d) => ({ done: d }));
    expect(pulseFinding(weeks(3, 4, 9), { name: "Fall Showcase", done: 5 })).toEqual({
      tone: "good",
      lead: "9 tasks done last week,",
      text: "the most in 3 weeks. Fall Showcase took 5 of them.",
    });
    expect(pulseFinding(weeks(9, 2, 1), null)?.lead).toBe(
      "Under the average for 2 weeks in a row:",
    );
    expect(pulseFinding(weeks(1, 2), null)).toBeNull();
  });

  it("counts a meeting's agenda items from its description", () => {
    expect(agendaItems("- Budget\n\n2. Fall Social\n* Room booking ")).toEqual([
      "Budget",
      "Fall Social",
      "Room booking",
    ]);
    expect(agendaItems(null)).toEqual([]);
  });
});
