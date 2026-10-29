import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/server/db/context", async () =>
  (await import("@/test/fake-context")).fakeContextModule(),
);

const { fake, resetFake } = await import("@/test/fake-context");
const { Role } = await import("@/generated/prisma/enums");
const { createTag } = await import("./actions");

function makeDb(
  opts: { membersCanCreate?: boolean; existing?: { id: string; name: string } } = {},
) {
  return {
    $queryRaw: vi.fn(async () => [{ id: "audit_1" }]),
    $executeRaw: vi.fn(async (_sql: TemplateStringsArray) => 0),
    orgSettings: {
      findUnique: vi.fn(async () => ({ memberCanCreateTags: opts.membersCanCreate ?? true })),
      upsert: vi.fn(async () => ({})),
    },
    orgTheme: { findUnique: vi.fn(async () => null) },
    label: {
      findFirst: vi.fn(async ({ where }: { where: { name: { equals: string } } }) =>
        opts.existing && opts.existing.name.toLowerCase() === where.name.equals.toLowerCase()
          ? { ...opts.existing, color: "#123456" }
          : null,
      ),
      findMany: vi.fn(async () => [
        { id: "a", name: "Design", color: "#111111" },
        { id: "b", name: "designs", color: "#222222" },
      ]),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "tag_1",
        ...data,
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    taskLabel: {
      findMany: vi.fn(async () => [{ taskId: "t1" }, { taskId: "t2" }]),
      createMany: vi.fn(async () => ({ count: 2 })),
      deleteMany: vi.fn(async () => ({ count: 2 })),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFake({ db: makeDb() });
});

describe("createTag (inline, from any tag field)", () => {
  it("lets a member make a tag while the club allows it, recording who made it", async () => {
    fake.role = Role.MEMBER;
    const result = await createTag("org_1", { name: "  #catering " });
    expect(result).toMatchObject({ created: true, tag: { name: "catering" } });
    expect(fake.db.label.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org_1",
          name: "catering",
          createdById: "actor",
          color: expect.stringMatching(/^#[0-9a-f]{6}$/),
        }),
      }),
    );
    // Members' inline tags are not audited (createdById records them).
    expect(fake.db.$queryRaw).not.toHaveBeenCalled();
  });

  it("refuses a member when the club keeps tags to admins", async () => {
    fake.role = Role.MEMBER;
    fake.db = makeDb({ membersCanCreate: false });
    expect(await createTag("org_1", { name: "catering" })).toEqual({
      error: "Only an owner or admin can make new tags in this organization.",
    });
    expect(fake.db.label.create).not.toHaveBeenCalled();
  });

  it("lets an admin make one with the switch off, and audits it", async () => {
    fake.role = Role.ADMIN;
    fake.db = makeDb({ membersCanCreate: false });
    expect(await createTag("org_1", { name: "Urgent", color: "#EF4444" })).toMatchObject({
      created: true,
    });
    expect(fake.db.label.create.mock.calls[0][0].data.color).toBe("#ef4444");
    expect(fake.db.$queryRaw).toHaveBeenCalled();
  });

  it("reuses a tag with the same name in any case instead of making a second", async () => {
    fake.role = Role.MEMBER;
    fake.db = makeDb({ membersCanCreate: false, existing: { id: "lbl_9", name: "Catering" } });
    expect(await createTag("org_1", { name: "CATERING" })).toEqual({
      created: false,
      tag: { id: "lbl_9", name: "Catering", color: "#123456" },
    });
    expect(fake.db.label.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ name: { equals: "CATERING", mode: "insensitive" } }),
      }),
    );
    expect(fake.db.label.create).not.toHaveBeenCalled();
  });

  it("reuses the tag someone else made a moment ago (the unique index's 23505)", async () => {
    fake.role = Role.MEMBER;
    const db = makeDb();
    let made = false;
    db.label.findFirst.mockImplementation(async () =>
      made ? { id: "lbl_race", name: "Catering", color: "#123456" } : null,
    );
    db.label.create.mockImplementation(async () => {
      made = true;
      throw Object.assign(new Error("unique"), { code: "23505" });
    });
    fake.db = db;
    expect(await createTag("org_1", { name: "catering" })).toEqual({
      created: false,
      tag: { id: "lbl_race", name: "Catering", color: "#123456" },
    });
    const sql = db.$executeRaw.mock.calls.map((c) => c[0].join(""));
    expect(sql).toEqual(["SAVEPOINT tag_create", "ROLLBACK TO SAVEPOINT tag_create"]);
  });

  it("rethrows any other failure", async () => {
    fake.role = Role.ADMIN;
    const db = makeDb();
    db.label.create.mockImplementation(async () => {
      throw Object.assign(new Error("boom"), { code: "23514" });
    });
    fake.db = db;
    await expect(createTag("org_1", { name: "catering" })).rejects.toThrow();
  });

  it("refuses an empty or over-long name", async () => {
    expect(await createTag("org_1", { name: " # " })).toEqual({ error: "Name the tag." });
    expect(fake.db.label.create).not.toHaveBeenCalled();
  });
});
