import { describe, expect, it } from "vitest";

import {
  decisionsToLog,
  draftAgenda,
  matchOwner,
  meetingAmbient,
  noteItems,
  splitTodo,
  todoLabel,
  todosWithoutTasks,
  undecidedMaybes,
  underWay,
  type MeetingAmbientInput,
} from "./meetings";

const now = new Date("2026-11-04T15:00:00Z");
const m = (n: number) => new Date(now.getTime() + n * 60_000);

function meeting(over: Partial<MeetingAmbientInput> = {}): MeetingAmbientInput {
  return {
    startsAt: m(60 * 24),
    endsAt: m(60 * 25),
    timeZone: "UTC",
    canEdit: true,
    agenda: null,
    openItems: 3,
    joinUrl: null,
    ...over,
  };
}

const kinds = (x: MeetingAmbientInput) => meetingAmbient(x, now).map((a) => a.kind);

describe("meetingAmbient", () => {
  it("drafts tomorrow's agenda from open items", () => {
    expect(meetingAmbient(meeting(), now)[0]).toEqual({
      kind: "draft-agenda",
      reason: "Tomorrow, no agenda yet, 3 open items",
    });
    expect(kinds(meeting({ agenda: "Intro" }))).toEqual([]);
    expect(kinds(meeting({ openItems: 0 }))).toEqual([]);
    expect(kinds(meeting({ canEdit: false }))).toEqual([]);
    expect(kinds(meeting({ startsAt: m(60 * 50), endsAt: m(60 * 51) }))).toEqual([]);
  });

  it("joins and takes notes within 15 minutes of the start", () => {
    const soon = { startsAt: m(10), endsAt: m(70), joinUrl: "https://meet" };
    expect(meetingAmbient(meeting(soon), now).slice(0, 2)).toEqual([
      { kind: "join", reason: "Starts in 10 minutes" },
      { kind: "take-notes", reason: "Starts in 10 minutes" },
    ]);
    expect(kinds(meeting({ ...soon, joinUrl: null }))).toEqual(["take-notes"]);
    expect(kinds(meeting({ startsAt: m(20), endsAt: m(80) }))).toEqual([]);
    expect(underWay({ startsAt: m(-5), endsAt: m(30) }, now)).toBe(true);
    expect(underWay({ startsAt: m(5), endsAt: m(30) }, now)).toBe(false);
  });
});

const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const item = (text: string) => ({ type: "listItem", content: [p(text)] });
const todo = (text: string, checked = false) => ({
  type: "taskItem",
  attrs: { checked },
  content: [p(text)],
});
const h3 = (text: string) => ({ type: "heading", content: [{ type: "text", text }] });

describe("noteItems", () => {
  const doc = {
    type: "doc",
    content: [
      h3("Notes"),
      {
        type: "bulletList",
        content: [item("Talked about the venue"), item("Decided: we use Room 4")],
      },
      h3("Decisions"),
      { type: "bulletList", content: [item("Pizza on Fridays"), item("")] },
      h3("Action items"),
      {
        type: "taskList",
        content: [
          todo("Lucas: confirm the speaker by Fri"),
          todo("Owner: task, by date"),
          todo("Done already", true),
        ],
      },
      { type: "bulletList", content: [item("Kristine: split the transition plan")] },
      p("Agreed - dues stay the same"),
    ],
  };

  it("finds open to-dos and decisions", () => {
    const { todos, decisions } = noteItems(doc);
    expect(todos).toEqual([
      { title: "Confirm the speaker by Fri", ownerName: "Lucas" },
      { title: "Split the transition plan", ownerName: "Kristine" },
    ]);
    expect(decisions).toEqual(["we use Room 4", "Pizza on Fridays", "dues stay the same"]);
  });

  it("reads nothing from nothing", () => {
    expect(noteItems(null)).toEqual({ todos: [], decisions: [] });
  });
});

describe("to-dos and decisions", () => {
  it("splits an owner off the front", () => {
    expect(splitTodo("Alex Kim: reimburse pizza")).toEqual({
      title: "Reimburse pizza",
      ownerName: "Alex Kim",
    });
    expect(splitTodo("book the room")).toEqual({ title: "book the room", ownerName: null });
  });

  it("leaves out to-dos already a task, and decisions already logged", () => {
    const todos = [
      { title: "Reimburse pizza", ownerName: null },
      { title: "Book the room!", ownerName: null },
    ];
    expect(todosWithoutTasks(todos, ["book the room"])).toEqual([todos[0]]);
    expect(
      decisionsToLog(
        ["Pizza on Fridays", "Room 4"],
        [{ question: "x", outcome: "pizza on fridays" }],
      ),
    ).toEqual(["Room 4"]);
    expect(todoLabel(3)).toBe("Turn 3 to-dos into tasks");
    expect(todoLabel(1)).toBe("Turn 1 to-do into a task");
  });

  it("matches an owner by whole or first name, only when it's one person", () => {
    const members = [
      { id: "1", name: "Lucas Moss" },
      { id: "2", name: "Alex Kim" },
      { id: "3", name: "Alex Ray" },
    ];
    expect(matchOwner("Lucas", members)).toBe("1");
    expect(matchOwner("Alex", members)).toBeNull();
    expect(matchOwner("Alex Ray", members)).toBe("3");
    expect(matchOwner(null, members)).toBeNull();
  });

  it("counts maybes on a meeting still to come", () => {
    const people = [{ rsvp: "MAYBE" }, { rsvp: "YES" }, { rsvp: "MAYBE" }];
    expect(undecidedMaybes(people, { startsAt: m(60), canEdit: true }, now)).toBe(2);
    expect(undecidedMaybes(people, { startsAt: m(-60), canEdit: true }, now)).toBe(0);
    expect(undecidedMaybes(people, { startsAt: m(60), canEdit: true, remindedAt: now }, now)).toBe(
      0,
    );
    expect(undecidedMaybes(people, { startsAt: m(60), canEdit: false }, now)).toBe(0);
  });

  it("drafts an agenda of linked lines", () => {
    expect(draftAgenda([{ title: "Book (room)", href: "/app/x/tasks/1" }])).toBe(
      "- [Book room](/app/x/tasks/1)",
    );
  });
});
