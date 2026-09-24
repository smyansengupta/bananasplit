import { describe, expect, it } from "vitest";

import {
  canAcknowledgeFlag,
  canEditTask,
  checkAssignmentChange,
  checkFieldEdit,
  type TaskAccessSubject,
  type TaskActor,
} from "./access";

const task: TaskAccessSubject = {
  createdById: "creator",
  ownerId: "owner",
  assigneeIds: ["collab"],
  isIntake: false,
  triageUserId: null,
};

const member = (userId: string, extra: Partial<TaskActor> = {}): TaskActor => ({
  userId,
  isAdmin: false,
  subtree: [],
  ...extra,
});

describe("assertCanEditTask matrix", () => {
  it.each([
    ["the creator", member("creator")],
    ["the owner", member("owner")],
    ["an assignee", member("collab")],
    ["an OWNER/ADMIN", member("admin", { isAdmin: true })],
    ["a chart manager of the owner", member("vp", { subtree: ["owner", "other"] })],
  ])("allows %s", (_label, actor) => {
    expect(canEditTask(actor, task)).toBe(true);
    expect(checkFieldEdit(actor, task, {}).ok).toBe(true);
  });

  it("refuses an unrelated member, and a manager of someone else", () => {
    expect(canEditTask(member("stranger"), task)).toBe(false);
    expect(canEditTask(member("vp", { subtree: ["collab"] }), task)).toBe(false);
    expect(checkFieldEdit(member("stranger"), task, {})).toMatchObject({ ok: false });
  });
});

describe("the self-assign carve-out", () => {
  const stranger = member("stranger");

  it("lets any member add and remove themselves as an assignee", () => {
    expect(checkAssignmentChange(stranger, task, { addAssigneeIds: ["stranger"] })).toEqual({
      ok: true,
      selfAssignOnly: true,
    });
    expect(
      checkAssignmentChange(stranger, { ...task, assigneeIds: ["stranger"] }, { removeAssigneeIds: ["stranger"] }),
    ).toMatchObject({ ok: true });
  });

  it("lets a member claim an unowned task", () => {
    expect(
      checkAssignmentChange(stranger, { ...task, ownerId: null }, { ownerId: "stranger" }),
    ).toMatchObject({ ok: true, selfAssignOnly: true });
  });

  it("refuses adding or removing someone else", () => {
    expect(checkAssignmentChange(stranger, task, { addAssigneeIds: ["friend"] }).ok).toBe(false);
    expect(checkAssignmentChange(stranger, task, { removeAssigneeIds: ["collab"] }).ok).toBe(false);
  });

  it("refuses taking an owned task or removing its owner", () => {
    expect(checkAssignmentChange(stranger, task, { ownerId: "stranger" }).ok).toBe(false);
    expect(checkAssignmentChange(stranger, task, { ownerId: null }).ok).toBe(false);
    expect(
      checkAssignmentChange(stranger, { ...task, ownerId: null }, { ownerId: "friend" }).ok,
    ).toBe(false);
  });

  it("refuses title, status and due-date edits", () => {
    expect(checkFieldEdit(stranger, task, {}).ok).toBe(false);
  });
});

describe("intake triage", () => {
  const intake: TaskAccessSubject = {
    createdById: "kristine",
    ownerId: null,
    assigneeIds: [],
    isIntake: true,
    triageUserId: "lucas",
  };

  it("only the triage user or OWNER/ADMIN can claim or set the owner", () => {
    expect(checkAssignmentChange(member("kristine"), intake, { ownerId: "designer" }).ok).toBe(false);
    expect(checkAssignmentChange(member("designer"), intake, { ownerId: "designer" }).ok).toBe(false);
    expect(checkAssignmentChange(member("lucas"), intake, { ownerId: "designer" }).ok).toBe(true);
    expect(checkAssignmentChange(member("jackson", { isAdmin: true }), intake, { ownerId: "designer" }).ok).toBe(
      true,
    );
  });

  it("only the triage user or OWNER/ADMIN can set the priority", () => {
    expect(checkFieldEdit(member("kristine"), intake, { priority: true }).ok).toBe(false);
    expect(checkFieldEdit(member("kristine"), intake, {}).ok).toBe(true);
    expect(checkFieldEdit(member("lucas"), intake, { priority: true }).ok).toBe(true);
    expect(canEditTask(member("lucas"), intake)).toBe(true); // the triage user manages the queue
    expect(checkFieldEdit(member("admin", { isAdmin: true }), intake, { priority: true }).ok).toBe(true);
  });

  it("still lets anyone join a request as a collaborator", () => {
    expect(checkAssignmentChange(member("smyan"), intake, { addAssigneeIds: ["smyan"] }).ok).toBe(true);
  });
});

describe("flag acknowledgement", () => {
  it("is for the flagged person or an admin", () => {
    expect(canAcknowledgeFlag(member("oliver"), "oliver")).toBe(true);
    expect(canAcknowledgeFlag(member("admin", { isAdmin: true }), "oliver")).toBe(true);
    expect(canAcknowledgeFlag(member("alex"), "oliver")).toBe(false);
  });
});
