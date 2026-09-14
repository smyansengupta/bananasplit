import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    membership: { findUnique: vi.fn() },
    availabilityPoll: { findFirst: vi.fn(), delete: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { Role } = await import("@/generated/prisma/enums");
const { deletePoll, finalizePoll } = await import("./actions");

const owner = { id: "owner_1", email: "owner@example.edu", name: "Owner" };

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue(owner);
  prismaMock.membership.findUnique.mockResolvedValue({ role: Role.OWNER });
});

describe("polls actions — cross-org access returns not-found (spec 6.2 audit)", () => {
  it("deletePoll: a poll id from another org is treated as not found", async () => {
    // The mocked findFirst already encodes the org-scoped query (it would
    // return null in production when the poll belongs to a different org);
    // this asserts the action surfaces that as a clean error, not a crash
    // or a successful delete.
    prismaMock.availabilityPoll.findFirst.mockResolvedValue(null);

    const result = await deletePoll("org_1", "poll_from_other_org");

    expect(result.error).toMatch(/not found/i);
    expect(prismaMock.availabilityPoll.delete).not.toHaveBeenCalled();
  });

  it("finalizePoll: a poll id from another org is treated as not found", async () => {
    prismaMock.availabilityPoll.findFirst.mockResolvedValue(null);

    const result = await finalizePoll("org_1", "poll_from_other_org", "slot_1");

    expect(result.error).toMatch(/not found/i);
  });

  it("finalizePoll: the query that looks it up is always scoped to this org", async () => {
    prismaMock.availabilityPoll.findFirst.mockImplementation(
      async ({ where }: { where: { organizationId?: string } }) => {
        if (!where.organizationId) {
          throw new Error("cross-org lookup: query is missing an organizationId filter");
        }
        return null;
      },
    );

    await finalizePoll("org_1", "poll_1", "slot_1");

    expect(prismaMock.availabilityPoll.findFirst).toHaveBeenCalled();
  });
});
