import { describe, expect, it } from "vitest";

import { TaskStatus } from "@/generated/prisma/enums";

import { BlockedReasonRequiredError, statusTransitionData, type StatusFields } from "./status";

const now = new Date("2026-10-01T15:00:00Z");
const earlier = new Date("2026-09-28T10:00:00Z");

const open: StatusFields = {
  status: TaskStatus.IN_PROGRESS,
  completedAt: null,
  blockedAt: null,
  blockedReason: null,
};

describe("statusTransitionData", () => {
  it("stamps completedAt when a task completes", () => {
    expect(statusTransitionData(open, TaskStatus.COMPLETED, { now })).toEqual({
      status: TaskStatus.COMPLETED,
      completedAt: now,
      blockedAt: null,
      blockedReason: null,
    });
  });

  it("keeps the original completedAt when it was already completed", () => {
    const done = { ...open, status: TaskStatus.COMPLETED, completedAt: earlier };
    expect(statusTransitionData(done, TaskStatus.COMPLETED, { now }).completedAt).toBe(earlier);
  });

  it("clears completedAt when a completed task reopens", () => {
    const done = { ...open, status: TaskStatus.COMPLETED, completedAt: earlier };
    expect(statusTransitionData(done, TaskStatus.NOT_STARTED, { now }).completedAt).toBeNull();
  });

  it("requires a reason to block, and stamps blockedAt", () => {
    expect(() => statusTransitionData(open, TaskStatus.BLOCKED, { now })).toThrow(
      BlockedReasonRequiredError,
    );
    expect(() => statusTransitionData(open, TaskStatus.BLOCKED, { blockedReason: "  ", now })).toThrow();
    expect(statusTransitionData(open, TaskStatus.BLOCKED, { blockedReason: " Room office closed ", now })).toEqual({
      status: TaskStatus.BLOCKED,
      completedAt: null,
      blockedAt: now,
      blockedReason: "Room office closed",
    });
  });

  it("keeps blockedAt and the reason while it stays blocked", () => {
    const blocked = { ...open, status: TaskStatus.BLOCKED, blockedAt: earlier, blockedReason: "Waiting" };
    expect(statusTransitionData(blocked, TaskStatus.BLOCKED, { now })).toMatchObject({
      blockedAt: earlier,
      blockedReason: "Waiting",
    });
    expect(
      statusTransitionData(blocked, TaskStatus.BLOCKED, { blockedReason: "New reason", now }).blockedReason,
    ).toBe("New reason");
  });

  it("clears the block when it moves on", () => {
    const blocked = { ...open, status: TaskStatus.BLOCKED, blockedAt: earlier, blockedReason: "Waiting" };
    expect(statusTransitionData(blocked, TaskStatus.IN_PROGRESS, { now })).toEqual({
      status: TaskStatus.IN_PROGRESS,
      completedAt: null,
      blockedAt: null,
      blockedReason: null,
    });
  });
});
