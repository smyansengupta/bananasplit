import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/context", async () =>
  (await import("@/test/fake-context")).fakeContextModule(),
);
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

const { fake, resetFake } = await import("@/test/fake-context");
const { ForbiddenError } = await import("@/lib/auth/errors");
const { updateBallotVisibility, updateDatabaseVisibility, updatePrivacy } =
  await import("./actions");

const current = {
  ballotIndividualVisibility: "OWNER_ONLY",
  ballotResultsVisibleToMembers: true,
  ballotMinCellSize: 3,
  showMemberEmailsToMembers: false,
  publicEventsEnabled: false,
  contactEmailVisibility: "ADMINS",
};

beforeEach(() => {
  vi.clearAllMocks();
  resetFake({
    role: "ADMIN",
    db: {
      orgSettings: { findUniqueOrThrow: vi.fn(async () => current), update: vi.fn() },
      databaseDefinition: {
        findFirst: vi.fn(async () => ({ name: "Signups", memberVisibility: "ADMINS" })),
        update: vi.fn(),
      },
      $queryRaw: vi.fn(async () => [{ id: "audit" }]),
    },
  });
});

const input = {
  ballotResultsVisibleToMembers: true,
  ballotMinCellSize: 5,
  showMemberEmailsToMembers: true,
  publicEventsEnabled: true,
  contactEmailVisibility: "ADMINS" as const,
};

describe("Privacy settings", () => {
  it("ADMINs save the privacy settings, writing only what changed, audited", async () => {
    expect(await updatePrivacy("org_1", input)).toEqual({});
    expect(fake.db.orgSettings.update).toHaveBeenCalledWith({
      where: { organizationId: "org_1" },
      data: {
        ballotMinCellSize: 5,
        showMemberEmailsToMembers: true,
        publicEventsEnabled: true,
        updatedById: "actor",
      },
    });
    const audit = fake.db.$queryRaw.mock.calls[0];
    expect(audit[2]).toBe("privacy.updated");
  });

  it("validates the minimum cell size", async () => {
    expect((await updatePrivacy("org_1", { ...input, ballotMinCellSize: 0 })).error).toMatch(
      /At least 1/,
    );
    expect(fake.db.orgSettings.update).not.toHaveBeenCalled();
  });

  it("members and treasurers cannot change privacy", async () => {
    fake.role = "MEMBER";
    await expect(updatePrivacy("org_1", input)).rejects.toBeInstanceOf(ForbiddenError);
    fake.role = "TREASURER";
    await expect(updateDatabaseVisibility("org_1", "db_1", "MEMBERS")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("only an OWNER changes who sees individual votes", async () => {
    await expect(updateBallotVisibility("org_1", "OWNER_AND_ADMINS")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    fake.role = "OWNER";
    expect(await updateBallotVisibility("org_1", "NOBODY")).toEqual({});
    expect(fake.db.orgSettings.update).toHaveBeenCalledWith({
      where: { organizationId: "org_1" },
      data: { ballotIndividualVisibility: "NOBODY", updatedById: "actor" },
    });
    expect((await updateBallotVisibility("org_1", "EVERYONE")).error).toBeTruthy();
  });

  it("sets a database's member visibility within the org", async () => {
    expect(await updateDatabaseVisibility("org_1", "db_1", "HIDDEN")).toEqual({});
    expect(fake.db.databaseDefinition.findFirst).toHaveBeenCalledWith({
      where: { id: "db_1", organizationId: "org_1" },
      select: { name: true, memberVisibility: true },
    });
    expect(fake.db.databaseDefinition.update).toHaveBeenCalledWith({
      where: { id: "db_1" },
      data: { memberVisibility: "HIDDEN" },
    });
  });
});
