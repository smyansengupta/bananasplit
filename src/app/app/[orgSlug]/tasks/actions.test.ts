import { beforeEach, describe, expect, it, vi } from "vitest";

// createTask/updateTask go through withOrgContext, which calls requireUser
// (from session.ts) cross-module — replace that binding rather than the real
// session.ts, which pulls in next-auth and fails to resolve under Vitest.
const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    membership: { count: vi.fn(), findUnique: vi.fn() },
    label: { count: vi.fn() },
    project: { findFirst: vi.fn() },
    task: { findFirst: vi.fn(), create: vi.fn(), count: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { Role } = await import("@/generated/prisma/enums");
const { createTask, reorderTask } = await import("./actions");

const testUser = { id: "user_1", email: "member@example.edu", name: "Test User" };

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue(testUser);
  prismaMock.membership.findUnique.mockResolvedValue({ role: Role.MEMBER });
});

describe("createTask — subtask nesting (spec 2.6)", () => {
  it("rejects nesting a subtask under a task that is itself a subtask", async () => {
    prismaMock.task.findFirst.mockResolvedValue({ parentTaskId: "grandparent_1" });

    const result = await createTask("org_1", { title: "New subtask", parentTaskId: "parent_1" });

    expect(result.error).toMatch(/cannot nest a subtask under another subtask/i);
    expect(prismaMock.task.create).not.toHaveBeenCalled();
  });

  it("rejects when the intended parent doesn't exist in this org", async () => {
    prismaMock.task.findFirst.mockResolvedValue(null);

    const result = await createTask("org_1", { title: "New subtask", parentTaskId: "missing" });

    expect(result.error).toMatch(/doesn't exist/i);
    expect(prismaMock.task.create).not.toHaveBeenCalled();
  });

  it("allows nesting under a genuinely top-level task", async () => {
    prismaMock.task.findFirst.mockResolvedValue({ parentTaskId: null });
    prismaMock.task.create.mockResolvedValue({ id: "new_task_1" });

    const result = await createTask("org_1", { title: "New subtask", parentTaskId: "parent_1" });

    expect(result.error).toBeUndefined();
    expect(result.taskId).toBe("new_task_1");
    expect(prismaMock.task.create).toHaveBeenCalledOnce();
  });
});

describe("reorderTask — beforeId/afterId must belong to this org (spec 6.2 audit)", () => {
  it("never reads a beforeId/afterId task without scoping the lookup to this org", async () => {
    prismaMock.task.findFirst.mockImplementation(
      async ({ where }: { where: { id: string; organizationId?: string } }) => {
        if (!where.organizationId) {
          throw new Error("cross-org lookup: query is missing an organizationId filter");
        }
        if (where.id === "task_1") return { id: "task_1", rank: "a0" };
        if (where.id === "before_task") return { rank: "a0" };
        if (where.id === "after_task") return { rank: "a5" };
        return null;
      },
    );
    prismaMock.task.update.mockResolvedValue({});

    await reorderTask("org_1", {
      taskId: "task_1",
      status: "IN_PROGRESS",
      beforeId: "before_task",
      afterId: "after_task",
    });

    expect(prismaMock.task.findFirst).toHaveBeenCalled();
    expect(prismaMock.task.update).toHaveBeenCalledOnce();
  });
});
