import { describe, expect, it } from "vitest";

import {
  allowedTypes,
  checkTypeChange,
  fitsUnder,
  HIERARCHY_ERRORS as E,
  hierarchyMessage,
  planNesting,
  rollUp,
} from "./hierarchy";

const top = (type: "EPIC" | "STORY" | "TASK") => ({ type, parentType: null });
const newChild = (type: "EPIC" | "STORY" | "TASK" = "TASK", explicit = false) => ({
  type,
  explicit,
  childTypes: [],
});

describe("fitsUnder (the database's rule)", () => {
  it("matches app.task_hierarchy_guard", () => {
    expect(fitsUnder("EPIC", null)).toBe(true);
    expect(fitsUnder("EPIC", "EPIC")).toBe(false);
    expect(fitsUnder("STORY", "EPIC")).toBe(true);
    expect(fitsUnder("STORY", "STORY")).toBe(false);
    expect(fitsUnder("STORY", "TASK")).toBe(false);
    expect(fitsUnder("TASK", "STORY")).toBe(true);
    expect(fitsUnder("TASK", "EPIC")).toBe(true);
    expect(fitsUnder("TASK", "TASK")).toBe(false);
  });
});

describe("planNesting", () => {
  it("breaking a plain task down makes it a story (organizations without epics, as before)", () => {
    expect(planNesting(top("TASK"), newChild())).toEqual({
      ok: true,
      childType: "TASK",
      promoteParent: true,
    });
  });

  it("an epic takes stories and tasks", () => {
    expect(planNesting(top("EPIC"), newChild("STORY", true))).toMatchObject({
      ok: true,
      childType: "STORY",
      promoteParent: false,
    });
    expect(planNesting(top("EPIC"), newChild())).toMatchObject({ childType: "TASK" });
  });

  it("a story takes tasks, two levels under an epic", () => {
    expect(planNesting({ type: "STORY", parentType: "EPIC" }, newChild())).toMatchObject({
      ok: true,
      childType: "TASK",
    });
    expect(planNesting(top("STORY"), newChild("STORY", true))).toEqual({
      ok: false,
      error: E.onlyTasksInStory,
    });
  });

  it("a task under an epic can be broken down (it becomes a story)", () => {
    expect(planNesting({ type: "TASK", parentType: "EPIC" }, newChild())).toEqual({
      ok: true,
      childType: "TASK",
      promoteParent: true,
    });
  });

  it("refuses a third level", () => {
    expect(planNesting({ type: "TASK", parentType: "STORY" }, newChild())).toEqual({
      ok: false,
      error: E.taskInStory,
    });
  });

  it("never puts an epic inside anything", () => {
    expect(planNesting(top("EPIC"), newChild("EPIC", true))).toEqual({
      ok: false,
      error: E.epicInside,
    });
    expect(
      planNesting(top("EPIC"), { type: "EPIC", explicit: false, childTypes: ["STORY"] }),
    ).toEqual({ ok: false, error: E.epicInside });
    // An empty epic moved under another epic just becomes a story.
    expect(planNesting(top("EPIC"), newChild("EPIC"))).toMatchObject({ childType: "STORY" });
  });

  it("moves a story with its tasks into an epic, but not into a story", () => {
    const story = { type: "STORY" as const, explicit: false, childTypes: ["TASK" as const] };
    expect(planNesting(top("EPIC"), story)).toMatchObject({ ok: true, childType: "STORY" });
    expect(planNesting(top("STORY"), story)).toEqual({ ok: false, error: E.storyWithTasks });
    // A childless story moved into a story quietly becomes a task.
    expect(planNesting(top("STORY"), newChild("STORY"))).toMatchObject({ childType: "TASK" });
  });
});

describe("checkTypeChange and allowedTypes", () => {
  it("keeps an epic at the top", () => {
    expect(checkTypeChange("EPIC", { parentType: "EPIC", childTypes: [] })).toBe(E.epicInside);
    expect(checkTypeChange("EPIC", { parentType: null, childTypes: ["STORY", "TASK"] })).toBeNull();
  });

  it("keeps a story at the top or in an epic, over tasks only", () => {
    expect(checkTypeChange("STORY", { parentType: "STORY", childTypes: [] })).toBe(E.storyNeedsTop);
    expect(checkTypeChange("STORY", { parentType: null, childTypes: ["STORY"] })).toBe(
      E.storiesNeedEpic,
    );
  });

  it("won't make a plain task of something with subtasks", () => {
    expect(checkTypeChange("TASK", { parentType: null, childTypes: ["TASK"] })).toBe(E.hasSubtasks);
  });

  it("lists what a task may become where it stands", () => {
    expect(allowedTypes({ parentType: null, childTypes: [] })).toEqual(["TASK", "STORY", "EPIC"]);
    expect(allowedTypes({ parentType: "EPIC", childTypes: [] })).toEqual(["TASK", "STORY"]);
    expect(allowedTypes({ parentType: "STORY", childTypes: [] })).toEqual(["TASK"]);
    expect(allowedTypes({ parentType: null, childTypes: ["STORY"] })).toEqual(["EPIC"]);
  });
});

describe("rollUp", () => {
  it("counts both levels", () => {
    expect(
      rollUp([
        { status: "COMPLETED" },
        { status: "IN_PROGRESS", subtasks: [{ status: "COMPLETED" }, { status: "NOT_STARTED" }] },
      ]),
    ).toEqual({ done: 2, total: 4 });
    expect(rollUp([])).toEqual({ done: 0, total: 0 });
  });
});

describe("hierarchyMessage", () => {
  it("reads the trigger's refusals", () => {
    expect(hierarchyMessage("Task: story can't sit under task")).toBe(E.storyNeedsTop);
    expect(hierarchyMessage("Task: epic can't sit under epic")).toBe(E.epicInside);
    expect(hierarchyMessage("Task: task can't sit under task")).toBe(E.taskInStory);
    expect(hierarchyMessage("Task: its subtasks can't sit under a task")).toBe(E.storiesNeedEpic);
    expect(hierarchyMessage("duplicate key")).toBeNull();
  });
});
