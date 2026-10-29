import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /onboarding is where sign-up and sign-in land
 * (docs/features/onboarding-flows.md). A new account is ready at once:
 * the first visit posts readyAccountAction (rendering writes nothing), which
 * then goes where sign-up started, else "What brings you here?". Someone set up goes
 * where sign-up started, else the Personal space.
 */

const mocks = vi.hoisted(() => ({
  profile: vi.fn(),
  personalHomeHref: vi.fn(),
  markComplete: vi.fn(),
  ensurePersonalSpace: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { url });
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: "u1", email: "verify-test@example.edu", name: "Verify Test" }),
}));
vi.mock("@/server/onboarding/profile", () => ({
  getOnboardingProfile: mocks.profile,
  markProfileSetupComplete: mocks.markComplete,
}));
vi.mock("./ready-account", () => ({ ReadyAccount: () => null }));
vi.mock("@/server/personal/space", () => ({
  personalHomeHref: mocks.personalHomeHref,
  ensurePersonalSpace: mocks.ensurePersonalSpace,
}));

const { default: OnboardingPage } = await import("./page");

function render(searchParams: Record<string, string> = {}) {
  return OnboardingPage({ searchParams: Promise.resolve(searchParams) });
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
  mocks.personalHomeHref.mockResolvedValue("/app/me-abc");
});

describe("OnboardingPage", () => {
  it("hands a new account to the ready form, and writes nothing while rendering", async () => {
    mocks.profile.mockResolvedValue(profile({ onboardedAt: null }));
    const page = (await render()) as { props: { after: string | null } };
    expect(page.props.after).toBeNull();
    expect(mocks.markComplete).not.toHaveBeenCalled();
    expect(mocks.ensurePersonalSpace).not.toHaveBeenCalled();
    expect(mocks.personalHomeHref).not.toHaveBeenCalled();
  });

  it("passes where sign-up started to the ready form, when it started somewhere safe", async () => {
    mocks.profile.mockResolvedValue(profile({ onboardedAt: null }));
    const page = (await render({ callbackUrl: "/onboarding/organization" })) as {
      props: { after: string | null };
    };
    expect(page.props.after).toBe("/onboarding/organization");
    const offsite = (await render({ callbackUrl: "https://evil.example" })) as {
      props: { after: string | null };
    };
    expect(offsite.props.after).toBeNull();
  });

  it("then opens the Personal space (made on the way if missing)", async () => {
    mocks.profile.mockResolvedValue(profile());
    await expect(render()).rejects.toMatchObject({ url: "/app/me-abc" });
    expect(mocks.personalHomeHref).toHaveBeenCalledWith("u1");
  });

  it("opens Personal for a club member too: switching is from there", async () => {
    mocks.profile.mockResolvedValue(profile({ memberships: [{ name: "CBC", slug: "cbc" }] }));
    await expect(render()).rejects.toMatchObject({ url: "/app/me-abc" });
  });

  it("returns to where sign-up started, and never off the site", async () => {
    mocks.profile.mockResolvedValue(profile());
    await expect(render({ callbackUrl: "/onboarding/join?code=ABCD" })).rejects.toMatchObject({
      url: "/onboarding/join?code=ABCD",
    });
    await expect(render({ callbackUrl: "https://evil.example" })).rejects.toMatchObject({
      url: "/app/me-abc",
    });
  });
});
