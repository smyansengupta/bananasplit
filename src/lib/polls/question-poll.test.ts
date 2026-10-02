import { describe, expect, it } from "vitest";

import {
  applyMyVote,
  buildQuestionPollView,
  cleanText,
  closesAtProblem,
  findDuplicateOption,
  isPollOpen,
  optionKey,
  optionsProblem,
  tally,
  type QuestionPollSource,
  type QuestionPollViewer,
} from "./question-poll";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const HOUR = 3_600_000;

describe("options", () => {
  it("compare without case or spacing", () => {
    expect(cleanText("  Pizza \n  party ")).toBe("Pizza party");
    expect(optionKey(" PIZZA   Party")).toBe(optionKey("pizza party"));
    expect(findDuplicateOption(["Pizza", "Tacos", " pizza "])).toBe(2);
    expect(findDuplicateOption(["Pizza", "", "  ", "Tacos"])).toBe(-1);
  });

  it("need two to twenty distinct, non-empty labels of at most 120 characters", () => {
    expect(optionsProblem(["Pizza", "  ", ""])).toBe("Add at least two options.");
    expect(optionsProblem(["Pizza", "Tacos", ""])).toBeNull();
    expect(optionsProblem(["Pizza", "PIZZA"])).toBe("Each option must be different.");
    expect(optionsProblem(["Pizza", "x".repeat(121)])).toMatch(/120 characters/);
    expect(optionsProblem(Array.from({ length: 21 }, (_, i) => `Option ${i}`))).toMatch(/up to 20/);
    expect(optionsProblem(Array.from({ length: 20 }, (_, i) => `Option ${i}`))).toBeNull();
  });
});

describe("closing time", () => {
  it("is optional, in the future and within a year", () => {
    expect(closesAtProblem(null, NOW)).toBeNull();
    expect(closesAtProblem(new Date(NOW.getTime() + 24 * HOUR), NOW)).toBeNull();
    expect(closesAtProblem(new Date(NOW.getTime() - HOUR), NOW)).toMatch(/future/);
    expect(closesAtProblem(new Date(NOW.getTime() + 30_000), NOW)).toMatch(/future/);
    expect(closesAtProblem(new Date(NOW.getTime() + 400 * 24 * HOUR), NOW)).toMatch(
      /within a year/,
    );
    expect(closesAtProblem(new Date("nonsense"), NOW)).toMatch(/valid/);
  });
});

describe("isPollOpen", () => {
  it("is open until closed by hand or until its closing time", () => {
    expect(isPollOpen({ closedAt: null, closesAt: null }, NOW)).toBe(true);
    expect(isPollOpen({ closedAt: null, closesAt: new Date(NOW.getTime() + 1) }, NOW)).toBe(true);
    expect(isPollOpen({ closedAt: null, closesAt: NOW }, NOW)).toBe(false);
    expect(isPollOpen({ closedAt: new Date(NOW.getTime() - HOUR), closesAt: null }, NOW)).toBe(
      false,
    );
  });
});

describe("tally", () => {
  it("gives each option its share of the voters and marks every leader", () => {
    expect(
      tally(
        [
          { id: "a", votes: 2 },
          { id: "b", votes: 2 },
          { id: "c", votes: 1 },
        ],
        3,
      ),
    ).toEqual([
      { id: "a", votes: 2, percent: 67, leading: true },
      { id: "b", votes: 2, percent: 67, leading: true },
      { id: "c", votes: 1, percent: 33, leading: false },
    ]);
  });

  it("leads with nothing before the first vote", () => {
    expect(tally([{ id: "a", votes: 0 }], 0)).toEqual([
      { id: "a", votes: 0, percent: 0, leading: false },
    ]);
  });
});

describe("applyMyVote", () => {
  const votes = { a: 3, b: 1 };

  it("moves a single vote and keeps the voter count", () => {
    expect(applyMyVote(votes, 4, ["a"], ["b"])).toEqual({ votes: { a: 2, b: 2 }, voters: 4 });
  });

  it("counts a first vote and a cleared vote as one voter more or less", () => {
    expect(applyMyVote(votes, 4, [], ["a", "b"])).toEqual({ votes: { a: 4, b: 2 }, voters: 5 });
    expect(applyMyVote(votes, 4, ["a", "b"], [])).toEqual({ votes: { a: 2, b: 0 }, voters: 3 });
  });
});

describe("buildQuestionPollView", () => {
  const people = [
    { id: "u_viewer", name: "Viola Viewer", image: null, avatar: null },
    {
      id: "u_ann",
      name: "Ann Lee",
      image: "https://img.example/ann.png",
      avatar: { key: "secret/key", s64: "https://cdn.example/ann-64.webp" },
    },
    { id: "u_bo", name: "  ", image: null, avatar: null },
  ];
  const base: QuestionPollSource = {
    id: "qp_1",
    question: "Pizza or tacos?",
    description: null,
    multiple: false,
    anonymous: false,
    allowMemberOptions: false,
    hideResultsUntilClosed: false,
    closesAt: null,
    closedAt: null,
    createdAt: new Date(NOW.getTime() - HOUR),
    createdById: "u_ann",
    createdBy: { name: "Ann Lee" },
    options: [
      { id: "o_pizza", label: "Pizza" },
      { id: "o_tacos", label: "Tacos" },
    ],
    counts: [
      { optionId: "o_pizza", votes: 2 },
      { optionId: "o_tacos", votes: 1 },
    ],
    voterCount: 3,
    votes: [
      { optionId: "o_pizza", userId: "u_ann" },
      { optionId: "o_pizza", userId: "u_viewer" },
      { optionId: "o_tacos", userId: "u_bo" },
    ],
    people,
  };
  const member: QuestionPollViewer = {
    userId: "u_viewer",
    isAdmin: false,
    profile: { name: "Viola Viewer", image: null, avatar: null },
  };

  it("names who picked what on a named poll, with opaque keys and the viewer as 'me'", () => {
    const view = buildQuestionPollView(base, member, NOW);
    expect(view.myVotes).toEqual(["o_pizza"]);
    expect(view.options.map((o) => o.votes)).toEqual([2, 1]);
    expect(view.options[0].voters?.map((v) => [v.key, v.name])).toEqual([
      ["v1", "Ann Lee"],
      ["me", "Viola Viewer"],
    ]);
    // A blank name reads as "Member"; avatars carry picture URLs only.
    expect(view.options[1].voters?.[0]).toMatchObject({ key: "v2", name: "Member" });
    expect(view.options[0].voters?.[0].avatar).toEqual({ s64: "https://cdn.example/ann-64.webp" });
    const json = JSON.stringify(view);
    expect(json).not.toContain("u_ann");
    expect(json).not.toContain("u_bo");
    expect(json).not.toContain("secret/key");
    expect(view).toMatchObject({
      isOpen: true,
      resultsVisible: true,
      canVote: true,
      canManage: false,
      canAddOption: false,
    });
  });

  it("never names a voter on an anonymous poll, even from rows it was handed", () => {
    const view = buildQuestionPollView({ ...base, anonymous: true }, member, NOW);
    expect(view.options.every((o) => o.voters === null)).toBe(true);
    expect(view.me).toBeNull();
    expect(view.myVotes).toEqual(["o_pizza"]);
    expect(view.options.map((o) => o.votes)).toEqual([2, 1]);
    // Who asked is not a secret; who voted is.
    expect(view.askedBy).toBe("Ann Lee");
    const json = JSON.stringify(view);
    expect(json).not.toContain("ann.png");
    expect(json).not.toContain("cdn.example");
    expect(json).not.toContain("Viola");
    expect(json).not.toContain("u_");
  });

  it("hides the counts from voters until it closes, but not from its creator or an admin", () => {
    const hidden = { ...base, hideResultsUntilClosed: true };
    const voter = buildQuestionPollView(hidden, member, NOW);
    expect(voter.resultsVisible).toBe(false);
    expect(voter.options.every((o) => o.votes === null && o.voters === null)).toBe(true);
    expect(voter.myVotes).toEqual(["o_pizza"]);

    expect(buildQuestionPollView(hidden, { ...member, isAdmin: true }, NOW).resultsVisible).toBe(
      true,
    );
    expect(buildQuestionPollView(hidden, { ...member, userId: "u_ann" }, NOW).resultsVisible).toBe(
      true,
    );
    const closed = buildQuestionPollView({ ...hidden, closedAt: NOW }, member, NOW);
    expect(closed).toMatchObject({
      isOpen: false,
      resultsVisible: true,
      canVote: false,
      canAddOption: false,
    });
    expect(closed.options.map((o) => o.votes)).toEqual([2, 1]);
  });

  it("lets members add options only when the poll allows it, while it is open and under 20", () => {
    expect(
      buildQuestionPollView({ ...base, allowMemberOptions: true }, member, NOW).canAddOption,
    ).toBe(true);
    expect(buildQuestionPollView(base, { ...member, isAdmin: true }, NOW)).toMatchObject({
      canAddOption: true,
      canManage: true,
    });
    const full = {
      ...base,
      allowMemberOptions: true,
      options: Array.from({ length: 20 }, (_, i) => ({ id: `o${i}`, label: `Option ${i}` })),
    };
    expect(buildQuestionPollView(full, member, NOW).canAddOption).toBe(false);
    const past = { ...base, allowMemberOptions: true, closesAt: new Date(NOW.getTime() - 1) };
    expect(buildQuestionPollView(past, member, NOW)).toMatchObject({
      isOpen: false,
      canAddOption: false,
    });
  });
});
