import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/server/db/context", async () =>
  (await import("@/test/fake-context")).fakeContextModule(),
);

const { fake, resetFake } = await import("@/test/fake-context");
const { Role } = await import("@/generated/prisma/enums");
const { archiveProject, createProject, setProjectIntake, unarchiveProject } =
  await import("./projects-actions");

function makeDb() {
  return {
    project: {
      create: vi.fn(async () => ({ id: "proj_1" })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    membership: { findFirst: vi.fn(async () => ({ id: "mem_1" })) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFake({ db: makeDb() });
});

/**
 * Projects are org-wide structure, and one of them is the admin-configured
 * intake queue. createProjectTx and setArchivedTx used to make no permission
 * check at all, so any MEMBER could add a project or archive the intake
 * project (reproduced live). RLS only scopes these writes to the caller's
 * org; it has no role predicate, so the gate lives in the action.
 */
describe("project actions require tasks.manageAll", () => {
  it.each([Role.MEMBER, Role.TREASURER])("refuses a %s", async (role) => {
    fake.role = role;
    expect(await createProject("org_1", { name: "Side quest" })).toEqual({
      error: "Only an owner or admin can manage projects.",
    });
    expect(await archiveProject("org_1", "proj_intake")).toEqual({
      error: "Only an owner or admin can manage projects.",
    });
    expect(await unarchiveProject("org_1", "proj_intake")).toEqual({
      error: "Only an owner or admin can manage projects.",
    });
    expect(fake.db.project.create).not.toHaveBeenCalled();
    expect(fake.db.project.updateMany).not.toHaveBeenCalled();
  });

  it("refuses someone with no membership role at all", async () => {
    fake.role = null;
    expect((await archiveProject("org_1", "proj_intake")).error).toMatch(/owner or admin/);
    expect(fake.db.project.updateMany).not.toHaveBeenCalled();
  });

  it.each([Role.OWNER, Role.ADMIN])("lets a %s create a project in their own org", async (role) => {
    fake.role = role;
    expect(await createProject("org_1", { name: "Workshops" })).toEqual({ projectId: "proj_1" });
    expect(fake.db.project.create).toHaveBeenCalledWith({
      data: { organizationId: "org_1", name: "Workshops" },
      select: { id: true },
    });
  });

  it("lets an admin archive and unarchive, scoped to their org", async () => {
    fake.role = Role.ADMIN;
    expect(await archiveProject("org_1", "proj_intake")).toEqual({});
    expect(fake.db.project.updateMany).toHaveBeenCalledWith({
      where: { id: "proj_intake", organizationId: "org_1" },
      data: { archivedAt: expect.any(Date) },
    });

    expect(await unarchiveProject("org_1", "proj_intake")).toEqual({});
    expect(fake.db.project.updateMany).toHaveBeenLastCalledWith({
      where: { id: "proj_intake", organizationId: "org_1" },
      data: { archivedAt: null },
    });
  });

  it("still validates the name and the project id after the permission check", async () => {
    fake.role = Role.OWNER;
    expect((await createProject("org_1", { name: "  " })).error).toMatch(/Name is required/);
    expect(await archiveProject("org_1", "../other-org")).toEqual({ error: "Project not found." });
    expect(fake.db.project.create).not.toHaveBeenCalled();
    expect(fake.db.project.updateMany).not.toHaveBeenCalled();
  });

  it("keeps the existing gate on intake configuration", async () => {
    fake.role = Role.MEMBER;
    const input = {
      projectId: "proj_intake",
      isIntake: true,
      triageUserId: null,
      defaultDueInDays: 5,
    };
    expect((await setProjectIntake("org_1", input)).error).toMatch(/owner or admin/i);
    fake.role = Role.ADMIN;
    expect(await setProjectIntake("org_1", input)).toEqual({});
  });
});
