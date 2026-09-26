import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/context", async () =>
  (await import("@/test/fake-context")).fakeContextModule(),
);
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

const { fake, resetFake } = await import("@/test/fake-context");
const { ForbiddenError } = await import("@/lib/auth/errors");
const { renameOrgSlug, updateOrgName, updateOrgTimezone } = await import("./actions");

let slugFree = true;
let retiredOwner: string | null = null;

function makeDb() {
  return {
    organization: {
      findUniqueOrThrow: vi.fn(async () => ({
        name: "Old Name",
        slug: "old-slug",
        timezone: "UTC",
      })),
      update: vi.fn(),
    },
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("slug_available")) return [{ ok: slugFree }];
      if (sql.includes("resolve_org_slug")) return retiredOwner ? [{ id: retiredOwner }] : [];
      return [{ id: "audit" }];
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFake({ role: "ADMIN", db: makeDb() });
  slugFree = true;
  retiredOwner = null;
});

describe("General settings", () => {
  it("ADMINs rename the org and set the timezone; members cannot", async () => {
    expect(await updateOrgName("org_1", "  New Name ")).toEqual({});
    expect(fake.db.organization.update).toHaveBeenCalledWith({
      where: { id: "org_1" },
      data: { name: "New Name" },
    });
    expect(await updateOrgTimezone("org_1", "America/New_York")).toEqual({});
    expect((await updateOrgTimezone("org_1", "Mars/Olympus")).error).toMatch(/valid timezone/);
    expect((await updateOrgName("org_1", "x")).error).toMatch(/at least 2/);

    fake.role = "MEMBER";
    await expect(updateOrgName("org_1", "Nope")).rejects.toBeInstanceOf(ForbiddenError);
    fake.role = "TREASURER";
    await expect(updateOrgTimezone("org_1", "UTC")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("only an OWNER changes the URL", async () => {
    await expect(renameOrgSlug("org_1", "new-slug")).rejects.toBeInstanceOf(ForbiddenError);
    expect(fake.db.organization.update).not.toHaveBeenCalled();
  });

  it("refuses reserved words, invalid and taken slugs", async () => {
    fake.role = "OWNER";
    expect((await renameOrgSlug("org_1", "settings")).error).toMatch(/reserved/);
    expect((await renameOrgSlug("org_1", "Bad Slug!")).error).toMatch(/lowercase/);
    slugFree = false;
    expect((await renameOrgSlug("org_1", "someone-else")).error).toMatch(/taken/);
    expect(fake.db.organization.update).not.toHaveBeenCalled();
  });

  it("renames, and lets an org take back its own retired slug", async () => {
    fake.role = "OWNER";
    expect(await renameOrgSlug("org_1", "new-slug")).toEqual({ slug: "new-slug" });
    expect(fake.db.organization.update).toHaveBeenCalledWith({
      where: { id: "org_1" },
      data: { slug: "new-slug" },
    });
    slugFree = false;
    retiredOwner = "org_1";
    expect(await renameOrgSlug("org_1", "older-slug")).toEqual({ slug: "older-slug" });
    retiredOwner = "org_2";
    expect((await renameOrgSlug("org_1", "their-slug")).error).toMatch(/taken/);
  });
});
