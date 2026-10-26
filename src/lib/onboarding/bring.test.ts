import { describe, expect, it } from "vitest";

import { bringSections, bringSelection, moveLabel, type BringableIn } from "./bring";

const base: BringableIn = {
  space: { timezone: "America/Chicago" },
  rsvpEvents: [
    {
      id: "e1",
      title: "Picnic",
      startsAt: new Date("2026-10-18T00:00:00Z"),
      allDay: false,
      rsvp: true,
      going: 12,
      past: false,
    },
  ],
  events: [],
  polls: [
    { id: "p1", title: "When?", kind: "availability", responses: 1, finalizedEventId: "e9" },
    { id: "q1", title: "Tacos?", kind: "question", responses: 3, finalizedEventId: null },
  ],
  taskGroups: [
    { project: null, tasks: [{ id: "t1", title: "Book", dueDate: null, subtasks: 2 }] },
    {
      project: "Errands",
      tasks: [{ id: "t2", title: "Shop", dueDate: new Date("2026-10-20T15:00:00Z"), subtasks: 0 }],
    },
  ],
  folders: [],
  notes: [],
  files: [],
};

const withFiles: BringableIn = {
  ...base,
  folders: [
    { id: "f1", name: "Trips", notes: 2, files: 1 },
    { id: "f2", name: "Empty one", notes: 0, files: 0 },
  ],
  notes: [
    {
      id: "n1",
      title: "Packing list",
      updatedAt: new Date("2026-10-18T00:00:00Z"),
      folder: "Trips",
      subpages: 1,
      files: 2,
    },
    {
      id: "n2",
      title: "",
      updatedAt: new Date("2026-10-19T18:00:00Z"),
      folder: null,
      subpages: 0,
      files: 0,
    },
  ],
  files: [{ id: "u1", name: "Lease.pdf", sizeBytes: 2.5 * 1024 * 1024, folder: null }],
};

describe("bringSections", () => {
  it("leaves out empty sections and describes each item in the space's time zone", () => {
    const sections = bringSections(base);
    expect(sections.map((s) => s.key)).toEqual(["rsvp", "polls", "tasks"]);
    expect(sections[0].groups[0].items[0]).toEqual({
      id: "e1",
      kind: "event",
      title: "Picnic",
      // 00:00 UTC is 7 PM the evening before in Chicago.
      meta: "Sat, Oct 17, 7:00 PM · 12 going",
    });
    expect(sections[1].groups[0].items.map((i) => i.meta)).toEqual([
      "Availability poll · 1 response · its event comes too",
      "Question poll · 3 votes",
    ]);
    expect(sections[2].groups.map((g) => [g.label, g.items.map((i) => i.meta)])).toEqual([
      [null, ["2 subtasks come too"]],
      ["Errands", ["Due Oct 20"]],
    ]);
  });
});

describe("bringSections with Files", () => {
  it("lists folders, notes and files last, with what comes along", () => {
    const sections = bringSections(withFiles);
    expect(sections.map((s) => s.key)).toEqual([
      "rsvp",
      "polls",
      "tasks",
      "folders",
      "notes",
      "files",
    ]);
    const meta = (key: string) =>
      sections.find((s) => s.key === key)!.groups[0].items.map((i) => [i.title, i.meta]);
    expect(meta("folders")).toEqual([
      ["Trips", "2 notes and 1 file come too"],
      ["Empty one", "Empty"],
    ]);
    expect(meta("notes")).toEqual([
      // Edited dates in the space's time zone (the evening before in Chicago).
      ["Packing list", "Edited Oct 17 · In Trips · 1 sub-page and 2 files come too"],
      ["Untitled note", "Edited Oct 19"],
    ]);
    expect(meta("files")).toEqual([["Lease.pdf", "2.5 MB"]]);
  });
});

describe("bringSelection", () => {
  it("splits the ticked ids by kind", () => {
    const items = bringSections(base).flatMap((s) => s.groups.flatMap((g) => g.items));
    expect(bringSelection(items, new Set(["e1", "q1", "t2", "nope"]))).toEqual({
      eventIds: ["e1"],
      pollIds: [],
      questionPollIds: ["q1"],
      taskIds: ["t2"],
      noteIds: [],
      folderIds: [],
      fileIds: [],
    });
    const all = bringSections(withFiles).flatMap((s) => s.groups.flatMap((g) => g.items));
    expect(bringSelection(all, new Set(["f1", "n2", "u1"]))).toMatchObject({
      noteIds: ["n2"],
      folderIds: ["f1"],
      fileIds: ["u1"],
    });
  });
});

describe("moveLabel", () => {
  it("counts items", () => {
    expect(moveLabel(1, "Chess Club")).toBe("Move 1 item into Chess Club");
    expect(moveLabel(3, "Chess Club")).toBe("Move 3 items into Chess Club");
  });
});
