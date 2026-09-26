import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The onboarding actions are thin: every rule lives in
 * src/server/settings (org-creation.test.ts, invitations.test.ts). These
 * tests pin the wiring: the signed-in user is always the one acting, errors
 * come back as state, success sets the active org and redirects.
 */

const {
  requireUserMock,
  redirectMock,
  createOrganizationMock,
  pendingMock,
  acceptMock,
  cookieMock,
} = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { url });
  }),
  createOrganizationMock: vi.fn(),
  pendingMock: vi.fn(),
  acceptMock: vi.fn(),
  cookieMock: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));
vi.mock("@/lib/active-org-cookie", () => ({ setActiveOrgCookie: cookieMock }));
vi.mock("@/server/settings/org-creation", () => ({
  createOrganization: createOrganizationMock,
  isSlugAvailable: vi.fn(async () => true),
}));
vi.mock("@/server/settings/invitations", () => ({
  findPendingInvitationsForMe: pendingMock,
  acceptInvitation: acceptMock,
}));

const { createOrganizationAction, joinPendingInvitationAction } = await import("./actions");

const user = { id: "user_1", email: "jackson@example.edu", name: "Jackson" };

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue(user);
});

describe("createOrganizationAction", () => {
  it("passes the form to the service as the signed-in user and returns its error", async () => {
    createOrganizationMock.mockResolvedValue({ ok: false, error: "That URL is already taken." });
    const result = await createOrganizationAction(
      {},
      form({ name: "New Club", slug: "new-club", code: "" }),
    );
    expect(result.error).toBe("That URL is already taken.");
    expect(createOrganizationMock).toHaveBeenCalledWith(user, {
      name: "New Club",
      slug: "new-club",
      timezone: "UTC",
      code: undefined,
    });
    expect(cookieMock).not.toHaveBeenCalled();
  });

  it("sets the active org and redirects on success", async () => {
    createOrganizationMock.mockResolvedValue({ ok: true, orgId: "org_new", slug: "new-club" });
    await expect(
      createOrganizationAction(
        {},
        form({ name: "New Club", slug: "new-club", timezone: "America/New_York" }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT \/app\/new-club/);
    expect(cookieMock).toHaveBeenCalledWith("org_new");
  });
});

describe("joinPendingInvitationAction", () => {
  it("only joins an invitation addressed to the caller's verified email", async () => {
    pendingMock.mockResolvedValue([]);
    expect(await joinPendingInvitationAction("inv_other")).toEqual({
      error: "This invite no longer exists.",
    });
    expect(acceptMock).not.toHaveBeenCalled();
  });

  it("accepts and redirects", async () => {
    pendingMock.mockResolvedValue([
      {
        id: "inv_1",
        organizationId: "org_1",
        role: "MEMBER",
        expiresAt: new Date(Date.now() + 1e6),
        orgName: "Org",
      },
    ]);
    acceptMock.mockResolvedValue({ ok: true, orgId: "org_1", orgSlug: "org-one" });
    await expect(joinPendingInvitationAction("inv_1")).rejects.toThrow(
      /NEXT_REDIRECT \/app\/org-one/,
    );
    expect(acceptMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "inv_1", organizationId: "org_1" }),
      user,
    );
  });
});
