import { describe, expect, it } from "vitest";

import { rowNext } from "./people-view";
import { pickTaskStep, taskStepText, type LinkedTaskRow } from "./task-steps";

const task = (over: Partial<LinkedTaskRow>): LinkedTaskRow => ({
  id: "t",
  title: "Send the deck",
  status: "NOT_STARTED",
  dueDate: null,
  completedAt: null,
  deletedAt: null,
  createdAt: new Date("2026-10-01T00:00:00Z"),
  ...over,
});

const now = new Date("2026-11-03T15:00:00Z");

describe("a linked task as the next step", () => {
  it("picks the open task due soonest, else the newest undated one", () => {
    expect(
      pickTaskStep([
        task({ id: "later", dueDate: new Date("2026-11-20T00:00:00Z") }),
        task({ id: "soon", dueDate: new Date("2026-11-05T00:00:00Z") }),
        task({ id: "undated" }),
      ]),
    ).toEqual({ taskId: "soon", title: "Send the deck", dueKey: "2026-11-05" });
    expect(
      pickTaskStep([
        task({ id: "old" }),
        task({ id: "new", createdAt: new Date("2026-10-20T00:00:00Z") }),
      ])?.taskId,
    ).toBe("new");
  });

  it("drops done and trashed tasks", () => {
    expect(
      pickTaskStep([
        task({ status: "COMPLETED", completedAt: now }),
        task({ deletedAt: now }),
      ]),
    ).toBeNull();
  });

  it("says when, in words", () => {
    const step = { taskId: "t", title: "Send the deck", dueKey: "2026-11-03" };
    expect(taskStepText(step, "2026-11-03")).toBe("Send the deck, today");
    expect(taskStepText(step, "2026-11-04")).toBe("Send the deck, a day late");
    expect(taskStepText(step, "2026-11-06")).toBe("Send the deck, 3 days late");
    expect(taskStepText({ ...step, dueKey: "2026-11-12" }, "2026-11-03")).toBe("Send the deck, Nov 12");
    expect(taskStepText({ ...step, dueKey: null }, "2026-11-03")).toBe("Send the deck");
  });

  it("is People's next step: no Add a next step, no Check in", () => {
    const talked = new Date("2026-08-01T00:00:00Z");
    // Without the task: quiet for months, so Check in.
    expect(rowNext({ nextFollowUpAt: null, lastContactedAt: talked }, now).action?.kind).toBe("checkin");
    const step = { taskId: "t", title: "Send the deck", dueKey: "2026-11-12" };
    expect(rowNext({ nextFollowUpAt: null, lastContactedAt: talked, task: step }, now)).toEqual({
      action: null,
      text: "Send the deck, Nov 12",
    });
    // Talked to lately and no step: Add a next step; with the task, the task.
    const recent = new Date("2026-11-01T00:00:00Z");
    expect(rowNext({ nextFollowUpAt: null, lastContactedAt: recent }, now).action?.kind).toBe("add");
    expect(rowNext({ nextFollowUpAt: null, lastContactedAt: recent, task: step }, now).text).toBe(
      "Send the deck, Nov 12",
    );
  });

  it("gives way to what's more pressing, and to a sooner follow-up", () => {
    const step = { taskId: "t", title: "Send the deck", dueKey: "2026-11-20" };
    expect(
      rowNext({ nextFollowUpAt: null, lastContactedAt: null, wroteAt: now, task: step }, now).action?.kind,
    ).toBe("reply");
    expect(
      rowNext(
        { nextFollowUpAt: new Date("2026-11-02T00:00:00Z"), lastContactedAt: null, task: step },
        now,
      ).action?.kind,
    ).toBe("followup");
    expect(
      rowNext(
        { nextFollowUpAt: new Date("2026-11-10T00:00:00Z"), lastContactedAt: null, task: step },
        now,
      ).text,
    ).toBe("Follow up, Nov 10");
  });
});
