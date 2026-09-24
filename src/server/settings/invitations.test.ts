import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Invite acceptance off the legacy role (0A Fix 4 rules unchanged): the
 * STORED, verified email must match the invited address; the join runs on
 * the service path for the joining user and re-checks the locked row.
 */

vi.mock("@/server/db/context", async () =>
  (await import("@/test/fake-context")).fakeContextModule(),
);
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));
const { getUserIdentityMock } = vi.hoisted(() => ({ getUserIdentityMock: vi.fn() }));
vi.mock("@/lib/auth/email-verification", () => ({ getUserIdentity: getUserIdentityMock }));

const { fake, resetFake } = await import("@/test/fake-context");
const { acceptInvitation, findInvitationByRawToken } = await import("./invitations");
const { hashInvitationToken } = await import("@/lib/invitations");

const future = new Date(Date.now() + 86_400_000);
const invitation = {
  id: "inv_1",
  organizationId: "org_1",
  email: "invitee@example.edu",
  expiresAt: future,
  acceptedAt: null,
};
const sessionUser = { id: "user_1", email: "invitee@example.edu", name: "Invitee" };

let lockedRow: Record<string, unknown> | null;

function makeSystemDb() {
  return {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("FOR UPDATE")) return lockedRow ? [lockedRow] : [];
      if (sql.includes("invitation_by_token_hash"))
        return [
          {
            ...invitation,
            role: "MEMBER",
            orgName: "Org One",
            orgSlug: "org-one",
            invitedById: "admin_1",
          },
        ];
      return [{ id: "x" }];
    }),
    organization: {
      findUnique: vi.fn(async () => ({ name: "Org One", slug: "org-one", deletedAt: null })),
    },
    membership: {
      findUnique: vi.fn(async (args: { where: { userId_organizationId: { userId: string } } }) =>
        args.where.userId_organizationId.userId === "admin_1" ? { id: "m_admin" } : null,
      ),
      create: vi.fn(),
    },
    invitation: { update: vi.fn() },
    notification: { createMany: vi.fn() },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFake({ systemDb: makeSystemDb() });
  lockedRow = {
    id: "inv_1",
    email: "invitee@example.edu",
    role: "MEMBER",
    expiresAt: future,
    acceptedAt: null,
    invitedById: "admin_1",
  };
});

describe("acceptInvitation (0A Fix 4, service path)", () => {
  it("refuses an account whose email is not verified, even when it matches", async () => {
    getUserIdentityMock.mockResolvedValue({
      id: "user_1",
      email: "invitee@example.edu",
      emailVerified: null,
    });
    expect(await acceptInvitation(invitation, sessionUser)).toEqual({
      ok: false,
      reason: "unverified",
    });
    expect(fake.systemCalls).toHaveLength(0);
  });

  it("compares the invited address with the STORED email, normalized, and joins on the service path as the user", async () => {
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
    expect(fake.systemCalls).toContainEqual(["org_1", { userId: "user_1" }]);
    expect(fake.systemDb.membership.create).toHaveBeenCalledWith({
      data: { userId: "user_1", organizationId: "org_1", role: "MEMBER" },
    });
    expect(fake.systemDb.invitation.update).toHaveBeenCalledWith({
      where: { id: "inv_1" },
      data: { acceptedAt: expect.any(Date) },
    });
    // The inviter (still a member) is notified.
    expect(fake.systemDb.notification.createMany).toHaveBeenCalledOnce();
  });

  it("refuses a verified account with a different address", async () => {
    getUserIdentityMock.mockResolvedValue({
      id: "user_1",
      email: "other@example.edu",
      emailVerified: new Date(),
    });
    expect(await acceptInvitation(invitation, sessionUser)).toMatchObject({
      ok: false,
      reason: "email_mismatch",
    });
    expect(fake.systemDb.membership.create).not.toHaveBeenCalled();
  });

  it("re-checks the locked row: a concurrent accept wins, nothing is written twice", async () => {
    getUserIdentityMock.mockResolvedValue({
      id: "user_1",
      email: "invitee@example.edu",
      emailVerified: new Date(),
    });
    lockedRow = { ...lockedRow!, acceptedAt: new Date() };
    expect(await acceptInvitation(invitation, sessionUser)).toEqual({
      ok: false,
      reason: "already_used",
    });
    expect(fake.systemDb.membership.create).not.toHaveBeenCalled();
  });

  it("refuses an org scheduled for deletion", async () => {
    getUserIdentityMock.mockResolvedValue({
      id: "user_1",
      email: "invitee@example.edu",
      emailVerified: new Date(),
    });
    fake.systemDb.organization.findUnique.mockResolvedValue({
      name: "Org",
      slug: "org",
      deletedAt: new Date(),
    });
    expect(await acceptInvitation(invitation, sessionUser)).toEqual({
      ok: false,
      reason: "org_inactive",
    });
    expect(fake.systemDb.membership.create).not.toHaveBeenCalled();
  });

  it("still refuses used and expired invites first", async () => {
    expect(await acceptInvitation({ ...invitation, acceptedAt: new Date() }, sessionUser)).toEqual({
      ok: false,
      reason: "already_used",
    });
    expect(
      await acceptInvitation({ ...invitation, expiresAt: new Date(Date.now() - 1) }, sessionUser),
    ).toEqual({
      ok: false,
      reason: "expired",
    });
  });
});

describe("findInvitationByRawToken", () => {
  it("looks the token up by its sha256 through the definer function, with no org context", async () => {
    const found = await findInvitationByRawToken("raw-token");
    expect(found?.orgSlug).toBe("org-one");
    expect(fake.systemCalls[0]?.[0]).toBeNull();
    const call = fake.systemDb.$queryRaw.mock.calls[0];
    expect(call[1]).toBe(hashInvitationToken("raw-token"));
  });

  it("ignores empty and absurdly long tokens", async () => {
    expect(await findInvitationByRawToken("")).toBeNull();
    expect(await findInvitationByRawToken("x".repeat(500))).toBeNull();
    expect(fake.systemCalls).toHaveLength(0);
  });
});
