// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  buildSince,
  nextVisitStamps,
  sinceInsight,
  sinceLabel,
  type SinceFacts,
} from "./since-text";

/**
 * Since you were here: when a visit counts as a new one, how changes are
 * grouped and worded, and when the top line may name what most of them
 * were about.
 */

const NOW = new Date("2026-11-01T15:00:00Z");
const minutes = (n: number) => new Date(NOW.getTime() - n * 60_000);
const face = (id: string, name: string) => ({ id, name, image: null, avatar: null });
const oliver = face("o", "Oliver Wu");
const kristine = face("k", "Kristine Ma");

function facts(over: Partial<SinceFacts> = {}): SinceFacts {
  return {
    base: "/app/cbc",
    todayKey: "2026-11-01",
    assigned: [],
    mentions: [],
    finished: [],
    comments: [],
    notes: [],
    joined: { people: [], goingTo: null },
    money: [],
    ...over,
  };
}

const fallSocial = { key: "event:fs", title: "Fall Social" };

describe("nextVisitStamps", () => {
  it("makes a visit over half an hour old the previous one", () => {
    expect(
      nextVisitStamps({ homeVisitAt: minutes(31), homePrevVisitAt: minutes(600) }, NOW),
    ).toEqual({
      homeVisitAt: NOW,
      homePrevVisitAt: minutes(31),
    });
  });
  it("keeps the previous visit across a reload", () => {
    expect(
      nextVisitStamps({ homeVisitAt: minutes(10), homePrevVisitAt: minutes(600) }, NOW),
    ).toEqual({
      homeVisitAt: NOW,
      homePrevVisitAt: minutes(600),
    });
  });
  it("has no previous visit the first time", () => {
    expect(nextVisitStamps(null, NOW)).toEqual({ homeVisitAt: NOW, homePrevVisitAt: null });
  });
});

describe("buildSince", () => {
  it("is empty with nothing new", () => {
    expect(buildSince(facts())).toEqual({ rows: [], total: 0, insight: null });
  });

  it("puts work handed to you first, tagged New and for you", () => {
    const out = buildSince(
      facts({
        assigned: [
          {
            taskId: "t1",
            title: "Send the room request",
            subjects: [fallSocial],
            event: { id: "fs", title: "Fall Social" },
            actor: oliver,
            dueKey: "2026-11-02",
            role: "owner",
          },
        ],
      }),
    );
    expect(out.rows[0]).toMatchObject({
      group: "assigned",
      title: "Send the room request",
      sub: "Oliver gave it to you, due Tomorrow",
      isNew: true,
      forMe: true,
    });
  });

  it("groups finished tasks by person and epic", () => {
    const done = (id: string, title: string) => ({
      taskId: id,
      title,
      subjects: [{ key: "task:e", title: "Venue and logistics" }],
      event: null,
      actor: oliver,
      epic: { id: "e", title: "Venue and logistics" },
    });
    const out = buildSince(
      facts({
        finished: [done("a", "Room booked"), done("b", "AV checked"), done("c", "Flyer posted")],
      }),
    );
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({
      title: "Oliver finished 3 tasks in Venue and logistics",
      sub: "Room booked, AV checked and Flyer posted",
      href: "/app/cbc/tasks/e",
    });
    expect(out.total).toBe(3);
  });

  it("writes people who joined with the event most of them are going to", () => {
    const out = buildSince(
      facts({
        joined: {
          people: [face("a", "Ana"), face("b", "Ben"), face("c", "Cy")],
          goingTo: { id: "w8", title: "Workshop 8", count: 2 },
        },
      }),
    );
    expect(out.rows[0]).toMatchObject({
      title: "3 people joined",
      sub: "2 of them are going to Workshop 8",
      face: null,
      count: 3,
    });
  });

  it("words a decision on your own reimbursement", () => {
    const out = buildSince(
      facts({
        money: [
          {
            id: "x",
            description: "Boba for the Welcome Social",
            amountCents: 8400,
            actor: face("aj", "Anthony J"),
            change: "paid",
            mine: true,
            receipts: 1,
            category: { id: "food", name: "Food", periodId: "p" },
            event: null,
          },
        ],
      }),
    );
    expect(out.rows[0]).toMatchObject({
      title: "Anthony paid back your Boba for the Welcome Social",
      sub: "$84",
      forMe: true,
    });
    expect(out.rows[0].chips[0]).toMatchObject({ kind: "money", label: "Food" });
  });
});

describe("sinceInsight", () => {
  it("names what most changes were about, and the one that needs you", () => {
    const subjects = new Map([
      ["event:fs", { title: "Fall Social", count: 11 }],
      ["task:e", { title: "Venue", count: 3 }],
    ]);
    const runs = sinceInsight(19, subjects, [{ title: "Send the room request", actor: oliver }]);
    expect(runs?.map((r) => r.text).join("")).toBe(
      "19 changes, and 11 of them were about Fall Social. One needs you: Oliver gave you Send the room request.",
    );
  });

  it("doesn't name a subject that isn't a real share", () => {
    const subjects = new Map([["event:fs", { title: "Fall Social", count: 3 }]]);
    expect(
      sinceInsight(19, subjects, [])
        ?.map((r) => r.text)
        .join(""),
    ).toBe("19 changes since your last visit.");
  });

  it("says nothing about one or two changes with nothing for you", () => {
    expect(sinceInsight(2, new Map(), [])).toBeNull();
    expect(sinceInsight(0, new Map(), [])).toBeNull();
  });

  it("counts every change toward its subjects", () => {
    const out = buildSince(
      facts({
        mentions: [
          { taskId: "t", title: "Shifts", subjects: [fallSocial], event: null, actor: kristine },
        ],
        comments: [
          {
            taskId: "t2",
            title: "Pizza",
            subjects: [fallSocial],
            event: null,
            actor: kristine,
            count: 3,
          },
        ],
        notes: [
          {
            noteId: "n",
            title: "Volunteer roles",
            actor: kristine,
            created: true,
            comments: 0,
            mine: false,
            event: null,
          },
        ],
      }),
    );
    expect(out.total).toBe(5);
    expect(out.insight?.map((r) => r.text).join("")).toBe(
      "5 changes, and 4 of them were about Fall Social.",
    );
  });
});

describe("a note that was only commented on", () => {
  it("says commented on, from its first commenter, and counts every comment", () => {
    const note = (comments: number) =>
      buildSince(
        facts({
          notes: [
            {
              noteId: "n",
              title: "Volunteer roles",
              actor: oliver,
              created: false,
              commentedOnly: true,
              comments,
              mine: true,
              event: null,
            },
          ],
        }),
      );
    const one = note(1);
    expect(one.rows[0]).toMatchObject({ title: "Oliver commented on Volunteer roles", sub: null });
    expect(one.total).toBe(1);
    const three = note(3);
    expect(three.rows[0]).toMatchObject({
      title: "Oliver commented on Volunteer roles",
      sub: "3 comments",
    });
    expect(three.total).toBe(3);
  });
});

describe("sinceLabel", () => {
  it("is a weekday and time within the week, else a date", () => {
    expect(sinceLabel(new Date("2026-10-30T01:40:00Z"), NOW, "America/New_York")).toBe(
      "Thursday, 9:40 PM",
    );
    expect(sinceLabel(new Date("2026-10-03T01:40:00Z"), NOW, "America/New_York")).toBe(
      "Oct 2, 9:40 PM",
    );
  });
});
