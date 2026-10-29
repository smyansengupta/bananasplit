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
  profileMock,
  markCompleteMock,
  ensureSpaceMock,
  updateProfileMock,
} = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { url });
  }),
  createOrganizationMock: vi.fn(),
  pendingMock: vi.fn(),
  acceptMock: vi.fn(),
  cookieMock: vi.fn(),
  profileMock: vi.fn(),
  markCompleteMock: vi.fn(),
  ensureSpaceMock: vi.fn(),
  updateProfileMock: vi.fn(),
}));
vi.mock("@/server/onboarding/profile", () => ({
  getOnboardingProfile: profileMock,
  markProfileSetupComplete: markCompleteMock,
}));
vi.mock("@/server/personal/space", () => ({ ensurePersonalSpace: ensureSpaceMock }));
vi.mock("@/server/profiles/service", () => ({ updateOwnProfile: updateProfileMock }));
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

const { createOrganizationAction, joinPendingInvitationAction, readyAccountAction } =
  await import("./actions");

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

  it("accepts, then asks for the role in that club", async () => {
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
      /NEXT_REDIRECT \/onboarding\/join\/org-one/,
    );
    expect(acceptMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "inv_1", organizationId: "org_1" }),
      user,
    );
  });
});

describe("readyAccountAction", () => {
  it("saves the device's zone before making the Personal space, then goes to the start", async () => {
    profileMock.mockResolvedValue({ id: "user_1", timezone: null });
    const order: string[] = [];
    updateProfileMock.mockImplementation(async () => void order.push("zone"));
    ensureSpaceMock.mockImplementation(async () => void order.push("space"));
    await expect(
      readyAccountAction(form({ timezone: "America/Los_Angeles" })),
    ).rejects.toMatchObject({ url: "/onboarding/start" });
    expect(updateProfileMock).toHaveBeenCalledWith("user_1", { timezone: "America/Los_Angeles" });
    expect(markCompleteMock).toHaveBeenCalledWith("user_1");
    expect(order).toEqual(["zone", "space"]);
  });

  it("keeps a zone already set, ignores a bad one, and only follows a safe callback", async () => {
    profileMock.mockResolvedValue({ id: "user_1", timezone: "Europe/Paris" });
    await expect(
      readyAccountAction(form({ timezone: "America/Los_Angeles", after: "/onboarding/join" })),
    ).rejects.toMatchObject({ url: "/onboarding/join" });
    profileMock.mockResolvedValue({ id: "user_1", timezone: null });
    await expect(
      readyAccountAction(form({ timezone: "Mars/Olympus", after: "https://evil.example" })),
    ).rejects.toMatchObject({ url: "/onboarding/start" });
    expect(updateProfileMock).not.toHaveBeenCalled();
  });
});
