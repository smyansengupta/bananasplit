import { describe, expect, it } from "vitest";

import { andList, buildPieces, type OwnTask } from "./ownership";

// Sunday, Nov 1 2026.
const TODAY = "2026-11-01";
const BASE = "/app/cbc";

const oliver = { id: "u1", name: "Oliver Ward", image: null, avatar: null };
const alex = { id: "u2", name: "Alex Green", image: null, avatar: null };

function task(id: string, over: Partial<OwnTask> = {}): OwnTask {
  return {
    id,
    title: `Task ${id}`,
    status: "NOT_STARTED",
    dueKey: null,
    blockedReason: null,
    owner: null,
    epic: null,
    labels: [],
    ...over,
  };
}

const build = (tasks: OwnTask[]) => buildPieces(tasks, { base: BASE, todayKey: TODAY });

describe("buildPieces", () => {
  it("makes one piece per task when nothing is shared", () => {
    const { groupedBy, pieces } = build([
      task("a", { owner: oliver, status: "COMPLETED" }),
      task("b", { owner: alex }),
    ]);
    expect(groupedBy).toBe("task");
    expect(pieces.map((p) => p.title)).toEqual(["Task b", "Task a"]);
    expect(pieces[0]!.href).toBe("/app/cbc/tasks/b");
    expect(pieces[1]!.state).toEqual({ word: "Done", tone: "done" });
  });

  it("groups by epic when two tasks share one", () => {
    const food = { id: "e1", title: "Food" };
    const { groupedBy, pieces } = build([
      task("a", { epic: food, owner: alex }),
      task("b", { epic: food, owner: alex }),
      task("c", { owner: oliver }),
    ]);
    expect(groupedBy).toBe("epic");
    const piece = pieces.find((p) => p.title === "Food")!;
    expect(piece.taskCount).toBe(2);
    expect(piece.href).toBe("/app/cbc/tasks/e1");
    expect(piece.owners.map((o) => o.id)).toEqual(["u2"]);
    expect(pieces.some((p) => p.title === "Task c")).toBe(true);
  });

  it("groups by tag when no epic is shared", () => {
    const music = { id: "l1", name: "Music" };
    const { groupedBy, pieces } = build([
      task("a", { labels: [music] }),
      task("b", { labels: [music], owner: oliver }),
    ]);
    expect(groupedBy).toBe("label");
    expect(pieces).toHaveLength(1);
    expect(pieces[0]!.href).toBe("/app/cbc/tasks?view=list&label=l1");
    expect(pieces[0]!.unownedTaskIds).toEqual(["a"]);
  });

  it("puts empty seats first and names the loudest state", () => {
    const { pieces } = build([
      task("done", { owner: oliver, status: "COMPLETED" }),
      task("blocked", { owner: alex, status: "BLOCKED", blockedReason: "Waiting on the quote" }),
      task("late", { owner: alex, dueKey: "2026-10-30" }),
      task("soon", { owner: alex, dueKey: "2026-11-02" }),
      task("seat"),
    ]);
    expect(pieces.map((p) => [p.key, p.state.word])).toEqual([
      ["task:seat", "Open"],
      ["task:blocked", "Blocked"],
      ["task:late", "Late"],
      ["task:soon", "Due tomorrow"],
      ["task:done", "Done"],
    ]);
    expect(pieces[1]!.blockedReason).toBe("Waiting on the quote");
  });

  it("says the weekday for a due date later this week", () => {
    const { pieces } = build([task("a", { owner: alex, dueKey: "2026-11-05" })]);
    expect(pieces[0]!.state.word).toBe("Due Thu");
  });

  it("doesn't count a done task without an owner as an empty seat", () => {
    const { pieces } = build([task("a", { status: "COMPLETED" })]);
    expect(pieces[0]!.unownedTaskIds).toEqual([]);
  });
});

describe("andList", () => {
  it("joins with commas and a final and", () => {
    expect(andList([])).toBe("");
    expect(andList(["Music"])).toBe("Music");
    expect(andList(["Music", "Cleanup"])).toBe("Music and Cleanup");
    expect(andList(["Music", "Food", "Cleanup"])).toBe("Music, Food and Cleanup");
  });
});
