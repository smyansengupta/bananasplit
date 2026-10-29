import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Joining with a code, then "Your role in <club>": joining lands on the
 * role step (not straight in the club), and the role saves as this club's
 * title on the new membership, then goes into the club.
 */

const mocks = vi.hoisted(() => ({
  joinWithCode: vi.fn(),
  getJoinedClub: vi.fn(),
  setOwnClubTitle: vi.fn(),
  setActiveOrgCookie: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { url });
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: "u1", email: "ada@example.edu", name: "Ada" }),
}));
vi.mock("@/lib/active-org-cookie", () => ({ setActiveOrgCookie: mocks.setActiveOrgCookie }));
vi.mock("@/lib/request-ip", () => ({ getClientIp: async () => "203.0.113.7" }));
vi.mock("@/server/onboarding/join-code", () => ({
  checkJoinCode: vi.fn(),
  joinWithCode: mocks.joinWithCode,
}));
vi.mock("@/server/onboarding/club-role", () => ({
  getJoinedClub: mocks.getJoinedClub,
  setOwnClubTitle: mocks.setOwnClubTitle,
}));

const { joinWithInviteCodeAction, saveClubRoleAction } = await import("./actions");

const club = {
  organizationId: "org_1",
  name: "Robotics",
  slug: "robotics",
  logo: null,
  title: null,
  canSetTitle: true,
  blockedHours: 0,
  sharesAvailability: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getJoinedClub.mockResolvedValue(club);
  mocks.setOwnClubTitle.mockResolvedValue(true);
});

describe("joinWithInviteCodeAction", () => {
  it("joins, then asks for the role in that club", async () => {
    mocks.joinWithCode.mockResolvedValue({ ok: true, orgId: "org_1", orgSlug: "robotics" });
    await expect(joinWithInviteCodeAction("RPKAYWSF")).rejects.toMatchObject({
      url: "/onboarding/join/robotics",
    });
    expect(mocks.setActiveOrgCookie).toHaveBeenCalledWith("org_1");
  });

  it("says why a code didn't work", async () => {
    mocks.joinWithCode.mockResolvedValue({ ok: false, message: "That code doesn't match." });
    expect(await joinWithInviteCodeAction("RPKAYWSF")).toEqual({
      error: "That code doesn't match.",
    });
  });
});

describe("saveClubRoleAction", () => {
  it("saves the picked role as this club's title, then opens the club", async () => {
    await expect(saveClubRoleAction("robotics", { title: " Treasurer " })).rejects.toMatchObject({
      url: "/app/robotics",
    });
    expect(mocks.getJoinedClub).toHaveBeenCalledWith("u1", "robotics");
    expect(mocks.setOwnClubTitle).toHaveBeenCalledWith("u1", "org_1", "Treasurer");
  });

  it("writes nothing when the role is unchanged", async () => {
    mocks.getJoinedClub.mockResolvedValue({ ...club, title: "Member" });
    await expect(saveClubRoleAction("robotics", { title: "Member" })).rejects.toMatchObject({
      url: "/app/robotics",
    });
    expect(mocks.setOwnClubTitle).not.toHaveBeenCalled();
  });

  it("refuses a club the caller isn't in, and a too-long role", async () => {
    mocks.getJoinedClub.mockResolvedValue(null);
    expect(await saveClubRoleAction("elsewhere", { title: "VP" })).toEqual({
      error: "You're not a member of this organization.",
    });
    expect((await saveClubRoleAction("robotics", { title: "x".repeat(81) })).error).toMatch(
      /under 80/,
    );
    expect(mocks.setOwnClubTitle).not.toHaveBeenCalled();
  });

  it("leaves the title to admins once the join window has passed", async () => {
    mocks.setOwnClubTitle.mockResolvedValue(false);
    expect(await saveClubRoleAction("robotics", { title: "President" })).toEqual({
      error: "Your role here is set by the organization's admins now.",
    });
  });
});
