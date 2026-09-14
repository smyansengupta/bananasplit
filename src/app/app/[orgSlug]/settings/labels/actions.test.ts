import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    membership: { findUnique: vi.fn() },
    label: { create: vi.fn(), updateMany: vi.fn(), delete: vi.fn() },
    taskLabel: { deleteMany: vi.fn() },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { Role } = await import("@/generated/prisma/enums");
const { createLabel, updateLabel, deleteLabel } = await import("./actions");

const member = { id: "user_1", email: "member@example.edu", name: "Member" };

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue(member);
});

describe("label actions — only owners/admins can manage labels (spec 6.2 audit)", () => {
  it("rejects createLabel from a plain member", async () => {
    prismaMock.membership.findUnique.mockResolvedValue({ role: Role.MEMBER });

    await expect(createLabel("org_1", { name: "Urgent", color: "#ef4444" })).rejects.toThrow(
      /only owners and admins/i,
    );
    expect(prismaMock.label.create).not.toHaveBeenCalled();
  });

  it("rejects updateLabel and deleteLabel from a treasurer (finance role, not admin)", async () => {
    prismaMock.membership.findUnique.mockResolvedValue({ role: Role.TREASURER });

    await expect(updateLabel("org_1", "label_1", { name: "x", color: "#3b82f6" })).rejects.toThrow();
    await expect(deleteLabel("org_1", "label_1")).rejects.toThrow();
    expect(prismaMock.label.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.label.delete).not.toHaveBeenCalled();
  });

  it("allows an admin to create a label", async () => {
    prismaMock.membership.findUnique.mockResolvedValue({ role: Role.ADMIN });

    const result = await createLabel("org_1", { name: "Urgent", color: "#ef4444" });

    expect(result.error).toBeUndefined();
    expect(prismaMock.label.create).toHaveBeenCalledOnce();
  });
});
