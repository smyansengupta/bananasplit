import { describe, expect, it } from "vitest";

import {
  assigneeFromText,
  cleanTaskDraft,
  impliedDue,
  impliedPriority,
  matchMember,
  membersBlock,
  plainTaskDraft,
  TaskDraftOutput,
  titleFromText,
  type NoteTaskContext,
  type TaskMember,
} from "./note-task";

const members: TaskMember[] = [
  {
    id: "u_kris",
    name: "Kristine Lee",
    title: "Head of Product",
    areas: ["App design", "Exports"],
  },
  { id: "u_ada", name: "Ada Okafor", title: "Partnerships lead", areas: [] },
  { id: "u_adam", name: "Adam Price" },
  { id: "u_jo", name: "José Núñez" },
];

// 2026-11-03 is a Tuesday.
const TODAY = "2026-11-03";

function ctx(text: string, over: Partial<NoteTaskContext> = {}): NoteTaskContext {
  return {
    text,
    record: { kind: "person", name: "Marcus Webb", company: "Northwind", ownerId: "u_ada" },
    members,
    viewerId: "u_adam",
    today: TODAY,
    ...over,
  };
}

describe("matchMember", () => {
  it("matches a full name, a unique first name or a unique prefix, ignoring case and accents", () => {
    expect(matchMember("kristine lee", members)?.id).toBe("u_kris");
    expect(matchMember("Kristine", members)?.id).toBe("u_kris");
    expect(matchMember("@kris", members)?.id).toBe("u_kris");
    expect(matchMember("Jose", members)?.id).toBe("u_jo");
  });

  it("refuses names that fit nobody or more than one", () => {
    expect(matchMember("Marcus", members)).toBeNull();
    expect(matchMember("Ad", members)).toBeNull();
    expect(matchMember("Ada", members)?.id).toBe("u_ada");
    expect(matchMember(null, members)).toBeNull();
    expect(matchMember("", members)).toBeNull();
  });
});

describe("assigneeFromText", () => {
  it("finds the member a note hands the task to, and takes those words out", () => {
    const r = assigneeFromText("Marcus doesn't like the new export, for Kristine", members);
    expect(r.member?.id).toBe("u_kris");
    expect(r.rest).toBe("Marcus doesn't like the new export");
  });

  it("reads @names, full names and 'assign to'", () => {
    expect(assigneeFromText("@ada send him the deck", members).member?.id).toBe("u_ada");
    expect(assigneeFromText("Fix the CSV for Kristine Lee by Friday", members)).toEqual({
      member: members[0],
      rest: "Fix the CSV by Friday",
    });
    expect(assigneeFromText("assign to Adam: call him back", members).member?.id).toBe("u_adam");
  });

  it("skips names that aren't members (the contact, 'for now') and keeps looking", () => {
    expect(assigneeFromText("Ordered lunch for Marcus", members)).toEqual({
      member: null,
      rest: "Ordered lunch for Marcus",
    });
    expect(assigneeFromText("Fine for now", members).member).toBeNull();
    expect(assigneeFromText("Book a demo for Marcus for Ada", members).member?.id).toBe("u_ada");
  });
});

describe("impliedDue", () => {
  it("reads the plain ways a note names a day", () => {
    expect(impliedDue("call him today", TODAY)).toBe(TODAY);
    expect(impliedDue("send it tomorrow", TODAY)).toBe("2026-11-04");
    expect(impliedDue("by Friday please", TODAY)).toBe("2026-11-06");
    expect(impliedDue("on Tuesday", TODAY)).toBe("2026-11-10");
    expect(impliedDue("next Monday", TODAY)).toBe("2026-11-16");
    expect(impliedDue("in 3 days", TODAY)).toBe("2026-11-06");
    expect(impliedDue("in two weeks", TODAY)).toBe("2026-11-17");
    expect(impliedDue("sometime next week", TODAY)).toBe("2026-11-10");
    expect(impliedDue("before the end of the month", TODAY)).toBe("2026-11-30");
    expect(impliedDue("renewal is 2026-12-01", TODAY)).toBe("2026-12-01");
  });

  it("says nothing when the note doesn't, or names a day gone by", () => {
    expect(impliedDue("Marcus doesn't like the new export", TODAY)).toBeNull();
    expect(impliedDue("we met on 2026-10-01", TODAY)).toBeNull();
  });
});

describe("impliedPriority and titleFromText", () => {
  it("raises upset or at-risk notes and lowers ones that can wait", () => {
    expect(impliedPriority("He's furious, thinking of cancelling")).toBe("HIGH");
    expect(impliedPriority("Nice to have, no rush")).toBe("LOW");
    expect(impliedPriority("Wants a dark mode")).toBe("MEDIUM");
  });

  it("titles a note by its first sentence, capped", () => {
    expect(titleFromText("marcus doesn't like the export. He said so twice.")).toBe(
      "Marcus doesn't like the export",
    );
    expect(titleFromText("x".repeat(200)).length).toBe(90);
    expect(titleFromText("   ")).toBe("Follow up");
  });
});

describe("plainTaskDraft (no AI key)", () => {
  it("quotes the note, names the person, and hands it to whoever the note names", () => {
    const d = plainTaskDraft(
      ctx("Marcus doesn't like the new export, for Kristine. Needs a fix by Friday"),
      "n1",
      true,
    );
    expect(d).toMatchObject({
      ownerId: "u_kris",
      ownerWhy: "Named in the note",
      dueDate: "2026-11-06",
      priority: "MEDIUM",
      ai: false,
      noKey: true,
      noteId: "n1",
    });
    expect(d.title).toBe("Marcus doesn't like the new export");
    expect(d.description).toContain("Marcus Webb (Northwind)");
    expect(d.description).toContain('"Marcus doesn\'t like the new export. Needs a fix by Friday"');
  });

  it("falls back to the record's owner, then whoever wrote it", () => {
    expect(plainTaskDraft(ctx("Wants a dark mode"), null, true)).toMatchObject({
      ownerId: "u_ada",
      ownerWhy: "Owns Marcus",
    });
    const noOwner = ctx("Wants a dark mode", {
      record: { kind: "company", name: "Northwind", company: null, ownerId: "u_gone" },
    });
    expect(plainTaskDraft(noOwner, null, true)).toMatchObject({
      ownerId: "u_adam",
      ownerWhy: "You wrote it",
    });
  });
});

describe("cleanTaskDraft (the model's answer)", () => {
  const answer = {
    title: "Look into the new export's speed for Marcus.",
    description: 'Marcus at Northwind finds the new export slow: "takes minutes".',
    assignee: "Kristine Lee",
    assigneeWhy: "Owns exports",
    dueDate: "2026-11-10",
    priority: "HIGH" as const,
    notes: [],
  };

  it("parses as the schema and maps the assignee to a member", () => {
    expect(TaskDraftOutput.parse(answer)).toEqual(answer);
    const d = cleanTaskDraft(answer, ctx("The export takes minutes, he hates it"), {
      noteId: "n1",
      model: "claude-haiku",
    });
    expect(d).toMatchObject({
      title: "Look into the new export's speed for Marcus",
      ownerId: "u_kris",
      ownerWhy: "Owns exports",
      dueDate: "2026-11-10",
      priority: "HIGH",
      ai: true,
      model: "claude-haiku",
      noKey: false,
    });
  });

  it("lets a name in the note win over the model's pick", () => {
    const d = cleanTaskDraft(answer, ctx("Export is slow, for Ada"), { noteId: null, model: null });
    expect(d.ownerId).toBe("u_ada");
    expect(d.ownerWhy).toBe("Named in the note");
  });

  it("keeps the record named and the note quoted, and drops past or made-up days and unknown members", () => {
    const d = cleanTaskDraft(
      {
        ...answer,
        description: "Speed up the export.",
        assignee: "Somebody Else",
        dueDate: "2026-10-01",
      },
      ctx("Export is slow"),
      { noteId: null, model: null },
    );
    expect(d.description).toContain("Marcus Webb (Northwind)");
    expect(d.description).toContain('"Export is slow"');
    expect(d.dueDate).toBeNull();
    expect(d.ownerId).toBe("u_ada");
    expect(
      cleanTaskDraft({ ...answer, dueDate: "2026-02-30" }, ctx("x"), { noteId: null, model: null })
        .dueDate,
    ).toBeNull();
  });

  it("falls back to the plain title when the model gives none", () => {
    expect(
      cleanTaskDraft({ ...answer, title: "  " }, ctx("Wants dark mode."), {
        noteId: null,
        model: null,
      }).title,
    ).toBe("Wants dark mode");
  });
});

describe("membersBlock", () => {
  it("lists each member with their title and what they own", () => {
    expect(membersBlock(members.slice(0, 3))).toBe(
      "- Kristine Lee: Head of Product, responsible for App design; Exports\n- Ada Okafor: Partnerships lead\n- Adam Price",
    );
  });
});
