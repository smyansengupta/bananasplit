import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The invite link. Signed out, it offers "Continue with Google" only when
 * the Google client is configured (src/lib/auth/google-sign-in.ts); either
 * way signing in, or creating an account, comes back to the invite.
 * Signed in: step 1 of the profile first, then the club preview and Join
 * (a verified address only), then "Your role in <club>".
 */

const mocks = vi.hoisted(() => ({
  findInvitationByRawToken: vi.fn(),
  getSession: vi.fn(),
  getUserIdentity: vi.fn(),
  needsProfileSetup: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { url });
  }),
}));

vi.mock("@/server/settings/invitations", () => ({
  findInvitationByRawToken: mocks.findInvitationByRawToken,
}));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/auth/config", () => ({ signIn: vi.fn() }));
vi.mock("@/lib/auth/email-verification", () => ({ getUserIdentity: mocks.getUserIdentity }));
vi.mock("@/server/onboarding/profile", () => ({ needsProfileSetup: mocks.needsProfileSetup }));
vi.mock("@/lib/theme/loader", () => ({
  getPublicOrgTheme: async () => ({ organizationId: "org_cbc", name: "CBC", logo: null }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/app/verify-email/actions", () => ({ resendVerificationEmailAction: vi.fn() }));
vi.mock("./actions", () => ({ acceptInvitationAction: vi.fn() }));

const { default: InvitePage } = await import("./page");

const TOKEN = "tok_abc123";
const props = {
  params: Promise.resolve({ token: TOKEN }),
} as unknown as PageProps<"/invite/[token]">;
const SIGN_IN_HREF = `/sign-in?callbackUrl=${encodeURIComponent(`/invite/${TOKEN}`)}`;
const SIGN_UP_HREF = `/sign-up?callbackUrl=${encodeURIComponent(`/invite/${TOKEN}`)}`;

async function render() {
  return renderToStaticMarkup(await InvitePage(props)).replace(/&#x27;/g, "'");
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
  mocks.needsProfileSetup.mockResolvedValue(false);
  mocks.getUserIdentity.mockResolvedValue({ email: "new@example.edu", emailVerified: new Date() });
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
    expect(html).toContain(`href="${SIGN_UP_HREF}"`);
    expect(html).toContain("with new@example.edu. You'll come back here.");
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
    expect(html).toContain(`href="${SIGN_UP_HREF}"`);
  });
});

describe("/invite/[token], signed in", () => {
  beforeEach(() => {
    mocks.getSession.mockResolvedValue({ user: { id: "u_new", email: "new@example.edu" } });
  });

  it("readies a brand-new account first, coming straight back", async () => {
    mocks.needsProfileSetup.mockResolvedValue(true);
    await expect(render()).rejects.toMatchObject({
      url: `/onboarding?callbackUrl=${encodeURIComponent(`/invite/${TOKEN}`)}`,
    });
  });

  it("previews the club, then offers Join, with no price or trial", async () => {
    const html = await render();
    expect(html).toContain("Join Claude Builders Club");
    expect(html).toContain("You're invited to join as a member.");
    expect(html).toContain("Invite for new@example.edu");
    expect(html).not.toMatch(/trial|\$\d|per month/i);
  });

  it("keeps the verified-address gate: the link alone doesn't prove the mailbox", async () => {
    mocks.getUserIdentity.mockResolvedValue({ email: "new@example.edu", emailVerified: null });
    const html = await render();
    expect(html).toContain("Verify your email address to accept this invite.");
    expect(html).not.toContain("Invite for new@example.edu");
  });

  it("refuses another account", async () => {
    mocks.getUserIdentity.mockResolvedValue({
      email: "else@example.edu",
      emailVerified: new Date(),
    });
    const html = await render();
    expect(html).toContain("Wrong account");
  });
});
