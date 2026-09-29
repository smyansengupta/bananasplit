import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The signed-out invite page offers "Continue with Google" only when the
 * Google client is configured (src/lib/auth/google-sign-in.ts). Either way,
 * signing in with email and password comes back to the invite.
 */

const mocks = vi.hoisted(() => ({
  findInvitationByRawToken: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@/server/settings/invitations", () => ({
  findInvitationByRawToken: mocks.findInvitationByRawToken,
}));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/auth/config", () => ({ signIn: vi.fn() }));
vi.mock("@/lib/auth/email-verification", () => ({ getUserIdentity: vi.fn() }));
vi.mock("@/app/verify-email/actions", () => ({ resendVerificationEmailAction: vi.fn() }));
vi.mock("./actions", () => ({ acceptInvitationAction: vi.fn() }));

const { default: InvitePage } = await import("./page");

const TOKEN = "tok_abc123";
const props = {
  params: Promise.resolve({ token: TOKEN }),
} as unknown as PageProps<"/invite/[token]">;
const SIGN_IN_HREF = `/sign-in?callbackUrl=${encodeURIComponent(`/invite/${TOKEN}`)}`;

async function render() {
  return renderToStaticMarkup(await InvitePage(props));
}

beforeEach(() => {
  mocks.findInvitationByRawToken.mockResolvedValue({
    id: "inv_1",
    organizationId: "org_cbc",
    email: "new@example.edu",
    role: "MEMBER",
    expiresAt: new Date(Date.now() + 86_400_000),
    acceptedAt: null,
    invitedById: "u_admin",
    orgName: "Claude Builders Club",
    orgSlug: "cbc",
  });
  mocks.getSession.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/invite/[token], signed out", () => {
  it("offers Google, with the sign-in link returning to the invite", async () => {
    vi.stubEnv("AUTH_GOOGLE_ID", "client-id");
    vi.stubEnv("AUTH_GOOGLE_SECRET", "client-secret");
    const html = await render();
    expect(html).toContain("Continue with Google");
    expect(html).toContain(`href="${SIGN_IN_HREF}"`);
    expect(html).toContain("with your email, verify it, then open this link again.");
    expect(html).not.toContain("New here?");
  });

  it("offers a Sign in button and account creation without the Google client", async () => {
    vi.stubEnv("AUTH_GOOGLE_ID", "");
    vi.stubEnv("AUTH_GOOGLE_SECRET", "");
    const html = await render();
    expect(html).not.toContain("Continue with Google");
    expect(html).toContain(`href="${SIGN_IN_HREF}"`);
    expect(html).toContain(">Sign in</a>");
    expect(html).toContain("New here?");
    expect(html).toContain("with this email, verify it, then open this link again.");
  });
});
