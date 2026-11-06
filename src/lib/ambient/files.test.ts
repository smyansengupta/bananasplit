import { describe, expect, it } from "vitest";

import {
  fileToShare,
  pinnedNoteChanged,
  summaryToSend,
  todosToTurn,
  uncheckedTodos,
} from "./files";

const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const todo = (text: string, checked: boolean, nested?: object) => ({
  type: "taskItem",
  attrs: { checked },
  content: [p(text), ...(nested ? [nested] : [])],
});

describe("a note's to-dos", () => {
  const doc = {
    type: "doc",
    content: [
      p("Spring handoff plan"),
      {
        type: "taskList",
        content: [
          todo("Draft role handoffs", false, {
            type: "taskList",
            content: [todo("Ask the treasurer", false)],
          }),
          todo("Pick the info session date", true),
          todo("  Update   the handbook ", false),
          todo("", false),
        ],
      },
    ],
  };
  it("reads the unchecked ones, nested ones on their own line", () => {
    expect(uncheckedTodos(doc)).toEqual([
      "Draft role handoffs",
      "Ask the treasurer",
      "Update the handbook",
    ]);
  });
  it("reads nothing from something that isn't a document", () => {
    expect(uncheckedTodos(null)).toEqual([]);
    expect(uncheckedTodos("text")).toEqual([]);
  });
  it("leaves out the ones that are tasks already, and repeats", () => {
    const turn = todosToTurn(["Book the room", "Order food", "book the room"], ["Order food"]);
    expect(turn).toEqual({ todos: ["Book the room"], reason: "1 unchecked to-do" });
    expect(todosToTurn(["Order food"], ["order food"])).toBeNull();
  });
});

describe("Send the summary", () => {
  const base = {
    canShare: true,
    meetingEndsAt: new Date("2026-11-01T19:00:00Z"),
    now: new Date("2026-11-02T10:00:00Z"),
    text: "We picked the date and split the work for the info session.",
    went: ["u1", "u2", "u3", "me", "author"],
    sharedWith: ["u3"],
    authorId: "author",
    viewerId: "me",
  };
  it("sends to who went and hasn't had it", () => {
    expect(summaryToSend(base)?.userIds).toEqual(["u1", "u2"]);
  });
  it("waits for the meeting to end, and for notes", () => {
    expect(summaryToSend({ ...base, now: new Date("2026-11-01T18:00:00Z") })).toBeNull();
    expect(summaryToSend({ ...base, text: "TBD" })).toBeNull();
    expect(summaryToSend({ ...base, meetingEndsAt: null })).toBeNull();
  });
  it("is for whoever may share it, and goes once everyone has it", () => {
    expect(summaryToSend({ ...base, canShare: false })).toBeNull();
    expect(summaryToSend({ ...base, sharedWith: ["u1", "u2", "u3"] })).toBeNull();
  });
});

describe("Share with everyone", () => {
  const base = {
    visibility: "PRIVATE",
    uploadedById: "me",
    viewerId: "me",
    personal: false,
    links: 0,
    folderName: null,
  };
  it("shows on your private file that's linked or in a folder", () => {
    expect(fileToShare({ ...base, links: 2 })?.reason).toBe(
      "Only you can open it, and it's linked from 2 things",
    );
    expect(fileToShare({ ...base, folderName: "Exec board" })?.reason).toBe(
      "Only you can open it, and it's in Exec board",
    );
  });
  it("is quiet otherwise", () => {
    expect(fileToShare(base)).toBeNull();
    expect(fileToShare({ ...base, links: 1, visibility: "ORGANIZATION" })).toBeNull();
    expect(fileToShare({ ...base, links: 1, uploadedById: "them" })).toBeNull();
    expect(fileToShare({ ...base, links: 1, personal: true })).toBeNull();
  });
});

describe("See what changed", () => {
  const base = {
    pinned: true,
    lastVisitAt: new Date("2026-11-01T10:00:00Z"),
    updatedAt: new Date("2026-11-02T09:00:00Z"),
    updatedById: "sam",
    updatedByName: "Sam Lee",
    viewerId: "me",
    versions: [
      { id: "v3", createdAt: "2026-11-02T08:00:00Z" },
      { id: "v2", createdAt: "2026-11-01T09:30:00Z" },
      { id: "v1", createdAt: "2026-10-30T09:00:00Z" },
    ],
  };
  it("compares with the version from before your last look", () => {
    expect(pinnedNoteChanged(base)).toEqual({
      versionId: "v2",
      reason: "Sam changed it since you looked",
    });
  });
  it("is quiet when unpinned, unchanged, your own change, or nothing to compare", () => {
    expect(pinnedNoteChanged({ ...base, pinned: false })).toBeNull();
    expect(pinnedNoteChanged({ ...base, updatedAt: new Date("2026-11-01T09:00:00Z") })).toBeNull();
    expect(pinnedNoteChanged({ ...base, updatedById: "me" })).toBeNull();
    expect(pinnedNoteChanged({ ...base, lastVisitAt: null })).toBeNull();
    expect(pinnedNoteChanged({ ...base, versions: [base.versions[0]] })).toBeNull();
  });
});
