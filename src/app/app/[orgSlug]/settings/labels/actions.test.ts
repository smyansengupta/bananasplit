import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/context", async () =>
  (await import("@/test/fake-context")).fakeContextModule(),
);

const { fake, resetFake } = await import("@/test/fake-context");
const { Role } = await import("@/generated/prisma/enums");
const { createLabel, updateLabel, deleteLabel } = await import("./actions");

function makeDb() {
  return {
    $queryRaw: vi.fn(async () => [{ id: "audit_1" }]),
    label: {
      create: vi.fn(async () => ({ id: "label_1" })),
      updateMany: vi.fn(),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    taskLabel: { deleteMany: vi.fn() },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFake({ db: makeDb() });
});

describe("label actions — only owners/admins manage the palette (withOrgAction, app_user)", () => {
  it("rejects createLabel from a plain member", async () => {
    fake.role = Role.MEMBER;
    await expect(createLabel("org_1", { name: "Urgent", color: "#ef4444" })).rejects.toThrow(
      /only owners and admins/i,
    );
    expect(fake.db.label.create).not.toHaveBeenCalled();
  });

  it("rejects updateLabel and deleteLabel from a treasurer (finance role, not admin)", async () => {
    fake.role = Role.TREASURER;
    await expect(
      updateLabel("org_1", "label_1", { name: "x", color: "#3b82f6" }),
    ).rejects.toThrow();
    await expect(deleteLabel("org_1", "label_1")).rejects.toThrow();
    expect(fake.db.label.updateMany).not.toHaveBeenCalled();
    expect(fake.db.label.deleteMany).not.toHaveBeenCalled();
  });

  it("allows an admin to create a label in their org and audits it", async () => {
    fake.role = Role.ADMIN;
    const result = await createLabel("org_1", { name: "Urgent", color: "#ef4444" });
    expect(result.error).toBeUndefined();
    expect(fake.db.label.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { organizationId: "org_1", name: "Urgent", color: "#ef4444" },
      }),
    );
    expect(fake.db.$queryRaw).toHaveBeenCalled();
  });

  it("scopes deletes to the caller's org", async () => {
    fake.role = Role.OWNER;
    await deleteLabel("org_1", "label_1");
    expect(fake.db.taskLabel.deleteMany).toHaveBeenCalledWith({
      where: { labelId: "label_1", organizationId: "org_1" },
    });
    expect(fake.db.label.deleteMany).toHaveBeenCalledWith({
      where: { id: "label_1", organizationId: "org_1" },
    });
  });
});
