import { describe, expect, it } from "vitest";

import { TaskVisibility } from "@/generated/prisma/enums";

import type { TaskActor } from "./access";
import {
  canChangeVisibility,
  canSeeTask,
  isPrivate,
  mentionableIds,
  namedAudienceIds,
  type TaskVisibilitySubject,
} from "./visibility";

const member = (userId: string, extra: Partial<TaskActor> = {}): TaskActor => ({
  userId,
  isAdmin: false,
  subtree: [],
  ...extra,
});

const priv: TaskVisibilitySubject = {
  visibility: TaskVisibility.PRIVATE,
  ownerId: "owner",
  createdById: "creator",
  assigneeIds: ["collab"],
};
const open: TaskVisibilitySubject = { ...priv, visibility: TaskVisibility.ORG };

describe("canSeeTask", () => {
  it("lets every member see an ORG task", () => {
    expect(canSeeTask(member("stranger"), open)).toBe(true);
    expect(isPrivate(open)).toBe(false);
  });

  it.each([
    ["the owner", member("owner")],
    ["a collaborator", member("collab")],
    ["the creator", member("creator")],
    ["an OWNER/ADMIN", member("stranger", { isAdmin: true })],
  ])("lets %s see a private task", (_label, actor) => {
    expect(canSeeTask(actor, priv)).toBe(true);
  });

  it("hides a private task from everybody else", () => {
    expect(canSeeTask(member("stranger"), priv)).toBe(false);
  });

  it("does not count a chart manager as an audience: seeing is not managing", () => {
    expect(canSeeTask(member("boss", { subtree: ["owner"] }), priv)).toBe(false);
  });
});

describe("namedAudienceIds", () => {
  it("lists owner, collaborators and creator once each, admins excluded", () => {
    expect(namedAudienceIds(priv).sort()).toEqual(["collab", "creator", "owner"]);
  });

  it("collapses the same person holding two roles", () => {
    expect(namedAudienceIds({ ...priv, ownerId: "creator", assigneeIds: [] })).toEqual(["creator"]);
  });

  it("copes with no owner", () => {
    expect(namedAudienceIds({ ...priv, ownerId: null }).sort()).toEqual(["collab", "creator"]);
  });
});

describe("canChangeVisibility", () => {
  it.each([
    ["the owner", member("owner")],
    ["the creator", member("creator")],
    ["an admin", member("stranger", { isAdmin: true })],
  ])("lets %s flip the flag", (_label, actor) => {
    expect(canChangeVisibility(actor, priv)).toBe(true);
  });

  it("refuses a mere collaborator: joining a private task must not let you publish it", () => {
    expect(canChangeVisibility(member("collab"), priv)).toBe(false);
  });
});

describe("mentionableIds", () => {
  const members = [
    { id: "owner" },
    { id: "collab" },
    { id: "creator" },
    { id: "admin" },
    { id: "stranger" },
  ];

  it("allows anyone in the org on an open task", () => {
    expect(mentionableIds(open, members, ["admin"])).toEqual([
      "owner",
      "collab",
      "creator",
      "admin",
      "stranger",
    ]);
  });

  it("narrows to the audience on a private task, so a mention cannot leak the title", () => {
    expect(mentionableIds(priv, members, ["admin"]).sort()).toEqual([
      "admin",
      "collab",
      "creator",
      "owner",
    ]);
  });
});
