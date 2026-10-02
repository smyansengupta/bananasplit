import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /onboarding is where sign-up and sign-in land an account with no org.
 * It is the flowchart's "Profile complete?" decision: profile setup first,
 * an existing member goes straight to their org, and everyone else chooses
 * between joining (invite code or emailed invite) and creating an org. An
 * unverified address gets the "check your email" notice and no way to join
 * or create until the link is followed.
 */

const mocks = vi.hoisted(() => ({
  profile: vi.fn(),
  pendingInvites: vi.fn(),
  membershipMany: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { url });
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: "u1", email: "verify-test@example.edu", name: "Verify Test" }),
}));
vi.mock("@/server/db/context", () => ({
  withUserTx: (_userId: string, fn: (ctx: unknown) => unknown) =>
    Promise.resolve(fn({ db: { membership: { findMany: mocks.membershipMany } } })),
}));
vi.mock("@/server/onboarding/profile", () => ({ getOnboardingProfile: mocks.profile }));
vi.mock("@/server/settings/invitations", () => ({
  findPendingInvitationsForMe: mocks.pendingInvites,
}));
vi.mock("@/app/verify-email/actions", () => ({ resendVerificationEmailAction: vi.fn() }));
vi.mock("./pending-invite-card", () => ({
  PendingInviteCard: ({ invitation }: { invitation: { orgName: string } }) => (
    <div>Invite to {invitation.orgName}</div>
  ),
}));

const { default: OnboardingPage } = await import("./page");

async function render() {
  return renderToStaticMarkup(await OnboardingPage()).replace(/&#x27;/g, "'");
}

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: "u1",
    name: "Verify Test",
    email: "verify-test@example.edu",
    emailVerified: true,
    onboardedAt: new Date("2026-09-01T00:00:00Z"),
    memberships: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.membershipMany.mockResolvedValue([]);
  mocks.pendingInvites.mockResolvedValue([{ id: "inv1", role: "MEMBER", orgName: "Robotics" }]);
});

describe("OnboardingPage", () => {
  it("sends someone who hasn't finished profile setup to its first step", async () => {
    mocks.profile.mockResolvedValue(profile({ onboardedAt: null }));
    await expect(render()).rejects.toMatchObject({ url: "/onboarding/profile/basics" });
  });

  it("sends a member straight to their organization", async () => {
    mocks.profile.mockResolvedValue(profile({ memberships: [{ name: "CBC", slug: "cbc" }] }));
    await expect(render()).rejects.toMatchObject({ url: "/app/cbc" });
  });

  it("shows an unverified account the check-your-email notice, and nothing to create or join", async () => {
    mocks.profile.mockResolvedValue(profile({ emailVerified: false }));

    const html = await render();

    expect(html).toContain("Check your email");
    expect(html).toContain("verify-test@example.edu");
    expect(html).toContain("Resend verification email");
    expect(html).not.toContain('href="/onboarding/join"');
    expect(html).not.toContain('href="/onboarding/organization"');
    // Invites are not even looked up for an unverified address.
    expect(mocks.pendingInvites).not.toHaveBeenCalled();
  });

  it("offers the invite code, emailed invites and org creation once the address is verified", async () => {
    mocks.profile.mockResolvedValue(profile());

    const html = await render();

    expect(html).not.toContain("Check your email");
    expect(html).toContain("Invite to Robotics");
    expect(html).toContain('href="/onboarding/join"');
    expect(html).toContain("Join with invite code");
    expect(html).toContain('href="/onboarding/organization"');
  });
});
