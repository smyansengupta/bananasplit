import { describe, expect, it } from "vitest";

import {
  agendaMeetingFor,
  agendaWithTask,
  daysLate,
  epicReadyToClose,
  lateSelection,
  nextMondayKey,
  taskAmbient,
  type TaskAmbientInput,
} from "./tasks";

const now = new Date("2026-11-04T15:00:00Z"); // a Wednesday
const todayKey = "2026-11-04";
const me = "u_me";

function task(over: Partial<TaskAmbientInput> = {}): TaskAmbientInput {
  return {
    type: "TASK",
    status: "IN_PROGRESS",
    dueDate: null,
    ownerId: me,
    owner: { name: "Me Myself" },
    createdById: me,
    createdBy: { name: "Me Myself" },
    blockedAt: null,
    blockedReason: null,
    subtasks: [],
    updatedAt: now,
    createdAt: now,
    ...over,
  };
}

const kinds = (t: TaskAmbientInput, page = false, editable = true) =>
  taskAmbient(t, { viewerId: me, todayKey, now, editable, page }).map((a) => a.kind);

describe("taskAmbient", () => {
  it("offers nothing on a done task", () => {
    expect(kinds(task({ status: "COMPLETED", dueDate: "2026-11-01", ownerId: null }))).toEqual([]);
  });

  it("pushes your own late task and says how late", () => {
    const [a] = taskAmbient(task({ dueDate: new Date("2026-11-02T00:00:00Z") }), {
      viewerId: me,
      todayKey,
      now,
      editable: true,
    });
    expect(a).toEqual({ kind: "push", reason: "Yours, 2 days late" });
  });

  it("nudges whoever owns someone else's late task", () => {
    const [a] = taskAmbient(
      task({ dueDate: "2026-10-31", ownerId: "u_lucas", owner: { name: "Lucas Moss" } }),
      { viewerId: me, todayKey, now, editable: false },
    );
    expect(a).toEqual({ kind: "nudge", reason: "Lucas, 4 days late", personId: "u_lucas" });
  });

  it("asks to unblock after two days, the owner or else whoever made it", () => {
    const blocked = { status: "BLOCKED", blockedAt: "2026-11-01T12:00:00Z", blockedReason: "logo" };
    const theirs = taskAmbient(task({ ...blocked, ownerId: "u_x", owner: { name: "Xi" } }), {
      viewerId: me,
      todayKey,
      now,
      editable: true,
    });
    expect(theirs[0]).toEqual({ kind: "unblock", reason: "Blocked 3 days: logo", personId: "u_x" });
    expect(kinds(task({ ...blocked, createdById: "u_y" }))).toContain("unblock");
    // Yours and made by you: nobody to ask.
    expect(kinds(task(blocked))).not.toContain("unblock");
    expect(
      kinds(task({ ...blocked, blockedAt: "2026-11-03T12:00:00Z", createdById: "u_y" })),
    ).not.toContain("unblock");
  });

  it("offers Take it to anyone and Assign to those who can edit an unowned task", () => {
    expect(kinds(task({ ownerId: null }))).toEqual(["take", "assign"]);
    expect(kinds(task({ ownerId: null }), false, false)).toEqual(["take"]);
    expect(kinds(task({ ownerId: null, type: "EPIC" }))).toEqual([]);
  });

  it("marks done when every subtask is, and closes an epic", () => {
    const subtasks = [
      { status: "COMPLETED" },
      { status: "COMPLETED", subtasks: [{ status: "COMPLETED" }] },
    ];
    expect(
      taskAmbient(task({ subtasks }), { viewerId: me, todayKey, now, editable: true })[0],
    ).toEqual({
      kind: "mark-done",
      reason: "3 of 3 subtasks done",
    });
    expect(kinds(task({ type: "EPIC", subtasks }))).toEqual(["close-epic"]);
    expect(kinds(task({ subtasks: [{ status: "COMPLETED" }, { status: "NOT_STARTED" }] }))).toEqual(
      [],
    );
    expect(kinds(task({ subtasks }), false, false)).toEqual([]);
  });

  it("follows up on the task page only, when it's due soon or quiet", () => {
    const handed = { ownerId: "u_l", owner: { name: "Lucas" } };
    expect(kinds(task({ ...handed, dueDate: "2026-11-05" }), true)).toEqual(["follow-up"]);
    expect(kinds(task({ ...handed, dueDate: "2026-11-05" }), false)).toEqual([]);
    expect(kinds(task({ ...handed, dueDate: "2026-11-20" }), true)).toEqual([]);
    expect(kinds(task({ ...handed, updatedAt: "2026-10-28T00:00:00Z" }), true)).toEqual([
      "follow-up",
    ]);
  });

  it("asks if a task untouched for 14 days is still needed", () => {
    expect(kinds(task({ updatedAt: "2026-10-20T00:00:00Z" }))).toEqual(["still-needed"]);
    expect(kinds(task({ updatedAt: "2026-10-25T00:00:00Z" }))).toEqual([]);
  });
});

describe("epicReadyToClose", () => {
  it("is an open epic with all its work done", () => {
    expect(epicReadyToClose({ status: "IN_PROGRESS", done: 4, total: 4 })).toBe(true);
    expect(epicReadyToClose({ status: "COMPLETED", done: 4, total: 4 })).toBe(false);
    expect(epicReadyToClose({ status: "IN_PROGRESS", done: 3, total: 4 })).toBe(false);
    expect(epicReadyToClose({ status: "NOT_STARTED", done: 0, total: 0 })).toBe(false);
  });
});

describe("dates", () => {
  it("counts days late and finds next Monday", () => {
    expect(daysLate("2026-11-04", todayKey)).toBe(0);
    expect(daysLate("2026-11-06", todayKey)).toBe(0);
    expect(daysLate(null, todayKey)).toBe(0);
    expect(nextMondayKey("2026-11-04")).toBe("2026-11-09");
    expect(nextMondayKey("2026-11-09")).toBe("2026-11-16");
    expect(nextMondayKey("2026-11-08")).toBe("2026-11-09");
  });
});

describe("lateSelection", () => {
  it("keeps the selected late tasks you can edit", () => {
    const rows = [
      { id: "a", type: "TASK", status: "NOT_STARTED", dueDate: "2026-11-01" },
      { id: "b", type: "TASK", status: "NOT_STARTED", dueDate: "2026-11-09" },
      { id: "c", type: "TASK", status: "COMPLETED", dueDate: "2026-11-01" },
      { id: "d", type: "TASK", status: "BLOCKED", dueDate: "2026-11-02" },
      { id: "e", type: "TASK", status: "BLOCKED", dueDate: "2026-11-02" },
    ];
    const picked = lateSelection(rows, new Set(["a", "b", "c", "d"]), todayKey, () => true);
    expect(picked.map((r) => r.id)).toEqual(["a", "d"]);
  });
});

describe("agenda", () => {
  it("finds this week's linked meeting without the task on its agenda", () => {
    const meetings = [
      { id: "m1", title: "Old", startsAt: "2026-11-01T00:00:00Z", description: null },
      { id: "m2", title: "Later", startsAt: "2026-11-20T00:00:00Z", description: null },
      { id: "m3", title: "Has it", startsAt: "2026-11-05T00:00:00Z", description: "x /tasks/t1)" },
      { id: "m4", title: "Sync", startsAt: "2026-11-06T00:00:00Z", description: null },
    ];
    expect(agendaMeetingFor("t1", meetings, now)?.id).toBe("m4");
    expect(agendaMeetingFor("t1", meetings.slice(0, 3), now)).toBeNull();
  });

  it("adds the task as a linked line", () => {
    expect(agendaWithTask("Intro\n", { id: "t1", title: "Book [room]" }, "cbc")).toBe(
      "Intro\n- [Book room](/app/cbc/tasks/t1)",
    );
    expect(agendaWithTask(null, { id: "t1", title: "A" }, "cbc")).toBe("- [A](/app/cbc/tasks/t1)");
  });
});
