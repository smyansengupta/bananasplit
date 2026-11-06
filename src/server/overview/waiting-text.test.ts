// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  buildWaitingOnOthers,
  chaseInsight,
  type OthersAsk,
  type OthersFacts,
} from "@/lib/overview/waiting-on-others-text";
import { budgetInsight, buildWaitingOnYou, type WaitingFacts } from "./waiting-on-you-text";

/**
 * Waiting on you and Waiting on others: what each row says, and the one
 * line each adds (what approving does to the budget; which ask to chase).
 */

const NOW = new Date("2026-11-01T15:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const face = (id: string, name: string) => ({ id, name, image: null, avatar: null });
const alex = face("a", "Alex Green");

function youFacts(over: Partial<WaitingFacts> = {}): WaitingFacts {
  return {
    base: "/app/cbc",
    now: NOW,
    seesMoney: true,
    requests: [],
    reviews: [],
    mentions: [],
    invites: [],
    ...over,
  };
}

const food = {
  id: "food",
  name: "Food",
  periodId: "p",
  periodLabel: "November",
  allocatedCents: 60_000,
  spentCents: 43_600,
};
const pizza = {
  id: "r1",
  description: "Pizza for Workshop 4",
  amountCents: 17_350,
  createdAt: daysAgo(12),
  submitter: alex,
  receipts: 1,
  task: { id: "t", title: "Order pizza", status: "BLOCKED" },
  event: { id: "fs", title: "Fall Social" },
  category: food,
};

describe("Waiting on you", () => {
  it("says who asked, when, the receipt, the budget room and what it unblocks", () => {
    const out = buildWaitingOnYou(youFacts({ requests: [pizza] }));
    expect(out.rows[0]).toMatchObject({
      key: "request:r1",
      title: "Pizza for Workshop 4, $173.50",
      sub: "Alex Green, 12 days ago. Receipt attached. Food has $164 left. Unblocks Order pizza.",
    });
    expect(out.chips.map((c) => c.label)).toEqual(["Food budget", "Order pizza", "Fall Social"]);
  });

  it("writes what approving does", () => {
    const second = { ...pizza, id: "r2", task: null, event: null, submitter: face("s", "Smyan S") };
    const out = budgetInsight(youFacts({ requests: [pizza, second] }));
    expect(out?.runs.map((r) => r.text).join("")).toBe(
      "Approving Alex's request unblocks Order pizza for Fall Social. Both together leave $164 in Food for November.",
    );
    expect(out?.tone).toBe("plain");
  });

  it("warns when the requests take a category over its budget", () => {
    const over = { ...pizza, task: null, category: { ...food, spentCents: 70_000 } };
    const out = budgetInsight(youFacts({ requests: [over] }));
    expect(out?.runs.map((r) => r.text).join("")).toBe(
      "With it, Food is $100 over its budget for November.",
    );
    expect(out?.tone).toBe("warn");
  });

  it("names the request category's own budget period", () => {
    const spring = { ...pizza, task: null, category: { ...food, periodLabel: "Spring 2027" } };
    const out = budgetInsight(youFacts({ requests: [spring] }));
    expect(out?.runs.map((r) => r.text).join("")).toBe(
      "Approving Alex's request leaves $164 in Food for Spring 2027.",
    );
  });

  it("has no budget line for someone who can't see finance", () => {
    expect(buildWaitingOnYou(youFacts({ seesMoney: false, requests: [pizza] })).insight).toBeNull();
  });

  it("lists responses to review and mentions with their keys from the Inbox", () => {
    const out = buildWaitingOnYou(
      youFacts({
        reviews: [{ id: "f", title: "Application", count: 2, event: null }],
        mentions: [
          {
            id: "n1",
            title: "Kristine mentioned you on “Volunteer roles”",
            excerpt: "Can you take the 5:30 setup shift?",
            href: "/app/cbc/tasks/t9",
            actor: face("k", "Kristine"),
            task: { id: "t9", title: "Volunteer roles", status: "IN_PROGRESS" },
            event: null,
          },
        ],
      }),
    );
    expect(out.rows.map((r) => r.key)).toEqual(["review:f", "update:n1"]);
    expect(out.rows[0]).toMatchObject({
      title: "Application: 2 new responses",
      count: 2,
      face: null,
    });
    expect(out.rows[1]).toMatchObject({
      sub: "“Can you take the 5:30 setup shift?”",
      replyTaskId: "t9",
    });
  });
});

function ask(over: Partial<OthersAsk> = {}): OthersAsk {
  return {
    kind: "task",
    id: "t",
    taskId: "t",
    title: "Flyer files",
    person: face("k", "Kristine Ma"),
    askedAt: daysAgo(3),
    dueKey: null,
    movedSince: false,
    epic: null,
    event: null,
    ...over,
  };
}

function othersFacts(asks: OthersAsk[]): OthersFacts {
  return { base: "/app/cbc", todayKey: "2026-11-01", now: NOW, asks };
}

describe("Waiting on others", () => {
  it("says how long it's been and whether they've moved on it", () => {
    const out = buildWaitingOnOthers(
      othersFacts([
        ask({ epic: { id: "e", title: "Volunteer roles" } }),
        ask({
          id: "q4",
          taskId: "q4",
          title: "Q4 budget numbers",
          person: face("aj", "Anthony J"),
          movedSince: true,
          dueKey: "2026-11-02",
        }),
      ]),
    );
    expect(out.rows[0]).toMatchObject({
      title: "Flyer files from Kristine",
      sub: "Assigned 3 days ago in Volunteer roles. No reply yet.",
      state: "waiting",
    });
    expect(out.rows[1]).toMatchObject({
      sub: "Assigned 3 days ago, due Tomorrow. Anthony has updated it since.",
      state: "on-track",
    });
  });

  it("marks a task past its due date overdue, whatever else", () => {
    const out = buildWaitingOnOthers(
      othersFacts([ask({ dueKey: "2026-10-30", movedSince: true })]),
    );
    expect(out.rows[0].state).toBe("overdue");
  });

  it("chases the late one first, then the oldest without a reply", () => {
    const late = ask({
      id: "l",
      taskId: "l",
      title: "Speaker reply",
      dueKey: "2026-10-30",
      event: { id: "w9", title: "Workshop 9" },
    });
    const quiet = ask({ id: "q", taskId: "q", askedAt: daysAgo(6) });
    expect(chaseInsight(othersFacts([quiet, late]))?.text).toBe(
      "Speaker reply is the one to chase: it was due Fri, Oct 30 and Kristine hasn't touched it. Workshop 9 waits on it.",
    );
    expect(chaseInsight(othersFacts([quiet]))?.text).toBe(
      "Flyer files is the one to chase: 6 days without a reply from Kristine.",
    );
  });

  it("chases nothing that's recent or moving", () => {
    expect(
      chaseInsight(
        othersFacts([ask({ askedAt: daysAgo(1) }), ask({ movedSince: true, askedAt: daysAgo(9) })]),
      ),
    ).toBeNull();
  });

  it("words an unanswered mention", () => {
    const out = buildWaitingOnOthers(
      othersFacts([ask({ kind: "mention", id: "m", askedAt: daysAgo(1) })]),
    );
    expect(out.rows[0]).toMatchObject({
      key: "mention:m",
      title: "Reply from Kristine on Flyer files",
      sub: "You mentioned Kristine yesterday. No reply yet.",
    });
  });
});
