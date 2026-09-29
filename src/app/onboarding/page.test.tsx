import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Onboarding is where sign-in lands an account with no organization
 * (/app redirects here). For an unverified address it is the "check your
 * email" page: the notice with the address and the resend button, and no
 * way to create or join an org until the link is followed.
 */

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  pendingInvites: vi.fn(),
  membershipFirst: vi.fn(),
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
    Promise.resolve(
      fn({
        db: { membership: { findFirst: mocks.membershipFirst, findMany: mocks.membershipMany } },
      }),
    ),
}));
vi.mock("@/lib/auth/email-verification", () => ({ getUserIdentity: mocks.identity }));
vi.mock("@/server/settings/invitations", () => ({
  findPendingInvitationsForMe: mocks.pendingInvites,
}));
vi.mock("@/app/verify-email/actions", () => ({ resendVerificationEmailAction: vi.fn() }));
vi.mock("./create-org-form", () => ({ CreateOrgForm: () => <form data-testid="create-org" /> }));
vi.mock("./pending-invite-card", () => ({
  PendingInviteCard: ({ invitation }: { invitation: { orgName: string } }) => (
    <div>Invite to {invitation.orgName}</div>
  ),
}));

const { default: OnboardingPage } = await import("./page");

async function render() {
  return renderToStaticMarkup(await OnboardingPage()).replace(/&#x27;/g, "'");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.membershipFirst.mockResolvedValue(null);
  mocks.membershipMany.mockResolvedValue([]);
  mocks.pendingInvites.mockResolvedValue([{ id: "inv1", role: "MEMBER", orgName: "Robotics" }]);
});

describe("OnboardingPage", () => {
  it("shows an unverified account the check-your-email notice, and nothing to create or join", async () => {
    mocks.identity.mockResolvedValue({
      id: "u1",
      email: "verify-test@example.edu",
      emailVerified: null,
    });

    const html = await render();

    expect(html).toContain("Check your email");
    expect(html).toContain("Your email address isn't verified yet.");
    expect(html).toContain("verify-test@example.edu");
    expect(html).toContain("Resend verification email");
    expect(html).not.toContain('data-testid="create-org"');
    // Invites are not even looked up for an unverified address.
    expect(mocks.pendingInvites).not.toHaveBeenCalled();
    expect(html).not.toContain("Invite to Robotics");
  });

  it("offers org creation and pending invites once the address is verified", async () => {
    mocks.identity.mockResolvedValue({
      id: "u1",
      email: "verify-test@example.edu",
      emailVerified: new Date(),
    });

    const html = await render();

    expect(html).not.toContain("Check your email");
    expect(html).toContain('data-testid="create-org"');
    expect(html).toContain("Invite to Robotics");
  });

  it("sends a member straight to their organization", async () => {
    mocks.membershipFirst.mockResolvedValue({ organization: { slug: "robotics" } });

    await expect(OnboardingPage()).rejects.toMatchObject({ url: "/app/robotics" });
  });
});
