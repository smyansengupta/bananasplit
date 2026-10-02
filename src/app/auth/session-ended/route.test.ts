// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ session: vi.fn(), profile: vi.fn(), signOut: vi.fn(), redirect: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getSession: m.session }));
vi.mock("@/server/onboarding/profile", () => ({ getOnboardingProfile: m.profile }));
vi.mock("@/lib/auth/config", () => ({ signOut: m.signOut }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    m.redirect(to);
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));

import { GET } from "./route";

beforeEach(() => vi.clearAllMocks());

describe("GET /auth/session-ended", () => {
  it("signs out a session whose user no longer exists, with a reason for sign-in", async () => {
    m.session.mockResolvedValue({ user: { id: "gone", email: "gone@example.edu", name: null } });
    m.profile.mockResolvedValue(null);
    await GET();
    expect(m.signOut).toHaveBeenCalledWith({ redirectTo: "/sign-in?error=SessionEnded" });
  });

  it("leaves a real user signed in and sends them home", async () => {
    m.session.mockResolvedValue({ user: { id: "u1", email: "u1@example.edu", name: "U" } });
    m.profile.mockResolvedValue({ onboardedAt: new Date(), memberships: [] });
    await expect(GET()).rejects.toThrow("NEXT_REDIRECT /app");
    expect(m.signOut).not.toHaveBeenCalled();
  });
});
