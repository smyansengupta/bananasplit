import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Joining with a code lands on your profile in that organization ("You're
 * in <org>"), not straight in it.
 */

const mocks = vi.hoisted(() => ({
  joinWithCode: vi.fn(),
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

const { joinWithInviteCodeAction } = await import("./actions");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("joinWithInviteCodeAction", () => {
  it("joins, then opens your profile in that organization", async () => {
    mocks.joinWithCode.mockResolvedValue({ ok: true, orgId: "org_1", orgSlug: "robotics" });
    await expect(joinWithInviteCodeAction("RPKAYWSF")).rejects.toMatchObject({
      url: "/onboarding/join/robotics/profile",
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
