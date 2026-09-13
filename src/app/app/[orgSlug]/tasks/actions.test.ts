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
    task: { findFirst: vi.fn(), create: vi.fn(), count: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { Role } = await import("@/generated/prisma/enums");
const { createTask } = await import("./actions");

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
