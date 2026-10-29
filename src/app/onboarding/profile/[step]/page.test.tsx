import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Your profile": one flow of five steps (docs/features/personal-and-clubs.md).
 * Step 1 is required (Sign out is the only way off it); every later step
 * has Skip, and "Finish later" goes to the Personal dashboard.
 */

const mocks = vi.hoisted(() => ({
  profile: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { url });
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u1" }) }));
vi.mock("@/server/onboarding/profile", () => ({ getOnboardingProfile: mocks.profile }));
vi.mock("@/components/auth/sign-out-button", () => ({
  SignOutButton: () => <button type="button">Sign out</button>,
}));
vi.mock("@/app/verify-email/actions", () => ({ resendVerificationEmailAction: vi.fn() }));
vi.mock("../actions", () => ({
  finishProfileSetup: vi.fn(),
  saveBasicsStep: vi.fn(),
  saveSchoolStep: vi.fn(),
  saveBioStep: vi.fn(),
  saveAvailabilityStep: vi.fn(),
}));
// The heavy editors aren't under test here.
vi.mock("../basics-step", () => ({ BasicsStep: () => <div>basics form</div> }));
vi.mock("../availability-step", () => ({ AvailabilityStep: () => <div>availability form</div> }));

const { default: ProfileStepPage } = await import("./page");

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: "u1",
    name: "Ada Lovelace",
    email: "ada@example.edu",
    emailVerified: true,
    image: null,
    avatar: null,
    pronouns: "she/her",
    major: null,
    gradYear: null,
    bio: null,
    links: [],
    timezone: "America/New_York",
    preferredTitle: null,
    themePreference: null,
    availability: { v: 1, blocks: [], rules: [] },
    onboardedAt: new Date(),
    hasGooglePhoto: false,
    memberships: [],
    ...overrides,
  };
}

async function render(step: string, searchParams: Record<string, string> = {}) {
  const props = {
    params: Promise.resolve({ step }),
    searchParams: Promise.resolve(searchParams),
  } as unknown as PageProps<"/onboarding/profile/[step]">;
  return renderToStaticMarkup(await ProfileStepPage(props)).replace(/&#x27;/g, "'");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.profile.mockResolvedValue(profile());
});

describe("/onboarding/profile/[step]", () => {
  it("opens with a real profile about you, step 1 of 5, required", async () => {
    mocks.profile.mockResolvedValue(profile({ onboardedAt: null }));
    const html = await render("basics");
    expect(html).toContain("A real profile about you.");
    expect(html).toContain("Your organizations see it.");
    expect(html).toContain("Step 1 of 5");
    for (const name of ["About you", "School", "Bio and links", "When you can't meet", "Review"])
      expect(html).toContain(name);
    expect(html).toContain("Sign out");
    expect(html).not.toContain("Finish later");
  });

  it("offers Skip and Finish later on every later step; school has no club role", async () => {
    const html = await render("school");
    expect(html).toContain("Step 2 of 5");
    expect(html).toContain(">Skip</button>");
    expect(html).toContain("Finish later");
    expect(html).not.toContain('id="ob-role-label"');
    expect(html).not.toContain("President");
  });

  it("sends a later step back to step 1 until it's saved", async () => {
    mocks.profile.mockResolvedValue(profile({ onboardedAt: null }));
    await expect(render("bio")).rejects.toMatchObject({ url: "/onboarding/profile/basics" });
  });

  it("has no theme step any more", async () => {
    await expect(render("theme")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("reviews what was saved, then Done", async () => {
    mocks.profile.mockResolvedValue(profile({ major: "Computer Science", gradYear: 2027 }));
    const html = await render("review");
    expect(html).toContain("Step 5 of 5");
    expect(html).toContain("Computer Science");
    expect(html).toContain("Nothing marked");
    expect(html).toContain('href="/onboarding/profile/availability"');
    expect(html).toContain("Done");
    expect(html).not.toContain("Theme");
  });
});
