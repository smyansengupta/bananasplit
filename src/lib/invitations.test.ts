import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, getUserIdentityMock } = vi.hoisted(() => ({
  getUserIdentityMock: vi.fn(),
  prismaMock: {
    membership: { upsert: vi.fn((args: unknown) => ({ op: "upsert", args })) },
    invitation: { update: vi.fn((args: unknown) => ({ op: "update", args })) },
    organization: { findUniqueOrThrow: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/notifications", () => ({ notifyUser: vi.fn() }));
vi.mock("@/lib/auth/email-verification", () => ({ getUserIdentity: getUserIdentityMock }));

const { acceptInvitation } = await import("./invitations");

const invitation = {
  id: "inv_1",
  organizationId: "org_1",
  email: "invitee@example.edu",
  role: "MEMBER" as const,
  token: "hash",
  expiresAt: new Date(Date.now() + 86_400_000),
  invitedById: "admin_1",
  acceptedAt: null,
  createdAt: new Date(),
};
const sessionUser = { id: "user_1", email: "invitee@example.edu", name: "Invitee" };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.organization.findUniqueOrThrow.mockResolvedValue({
    id: "org_1",
    slug: "org-one",
    name: "Org One",
  });
});

describe("acceptInvitation — invite takeover (0A Fix 4)", () => {
  it("refuses an account whose email is not verified, even when it matches", async () => {
    getUserIdentityMock.mockResolvedValue({
      id: "user_1",
      email: "invitee@example.edu",
      emailVerified: null,
    });

    const result = await acceptInvitation(invitation, sessionUser);

    expect(result).toEqual({ ok: false, reason: "unverified" });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("compares the invited address with the STORED email, normalized", async () => {
    getUserIdentityMock.mockResolvedValue({
      id: "user_1",
      email: "invitee@example.edu",
      emailVerified: new Date(),
    });

    const result = await acceptInvitation(
      { ...invitation, email: " Invitee@Example.EDU" },
      // A stale or forged session email is never what decides.
      { ...sessionUser, email: "someone-else@example.edu" },
    );

    expect(result).toEqual({ ok: true, orgId: "org_1", orgSlug: "org-one" });
    expect(prismaMock.membership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { userId: "user_1", organizationId: "org_1", role: "MEMBER" },
      }),
    );
  });

  it("refuses a verified account with a different address", async () => {
    getUserIdentityMock.mockResolvedValue({
      id: "user_1",
      email: "other@example.edu",
      emailVerified: new Date(),
    });

    const result = await acceptInvitation(invitation, sessionUser);

    expect(result).toMatchObject({ ok: false, reason: "email_mismatch" });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("still refuses used and expired invites first", async () => {
    expect(await acceptInvitation({ ...invitation, acceptedAt: new Date() }, sessionUser)).toEqual({
      ok: false,
      reason: "already_used",
    });
    expect(
      await acceptInvitation({ ...invitation, expiresAt: new Date(Date.now() - 1) }, sessionUser),
    ).toEqual({ ok: false, reason: "expired" });
  });
});
