import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, getUserIdentityMock, requireUserMock, redirectMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  getUserIdentityMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { url });
  }),
  prismaMock: {
    organization: { findUnique: vi.fn(), create: vi.fn() },
    invitation: { findUnique: vi.fn() },
  },
}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));
vi.mock("@/lib/auth/email-verification", () => ({ getUserIdentity: getUserIdentityMock }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/active-org-cookie", () => ({ setActiveOrgCookie: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ notifyUser: vi.fn() }));

const { createOrganizationAction } = await import("./actions");

function form(name: string, slug: string) {
  const data = new FormData();
  data.set("name", name);
  data.set("slug", slug);
  return data;
}

const user = { id: "user_1", email: "jackson@example.edu", name: "Jackson" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  requireUserMock.mockResolvedValue(user);
  prismaMock.organization.findUnique.mockResolvedValue(null);
  prismaMock.organization.create.mockResolvedValue({ id: "org_new", slug: "new-club" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createOrganizationAction (0A Fix 4(c), Fix 16)", () => {
  it("refuses an unverified account", async () => {
    getUserIdentityMock.mockResolvedValue({ ...user, emailVerified: null });

    const result = await createOrganizationAction({}, form("New Club", "new-club"));

    expect(result.error).toMatch(/verify your email/i);
    expect(prismaMock.organization.create).not.toHaveBeenCalled();
  });

  it("in production, refuses a verified user who is not a platform admin", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", "president@example.edu");
    getUserIdentityMock.mockResolvedValue({ ...user, emailVerified: new Date() });

    const result = await createOrganizationAction({}, form("New Club", "new-club"));

    expect(result.error).toMatch(/platform admins/i);
    expect(prismaMock.organization.create).not.toHaveBeenCalled();
  });

  it("in production, lets a platform admin create the org", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", "Jackson@example.edu");
    getUserIdentityMock.mockResolvedValue({ ...user, emailVerified: new Date() });

    await expect(createOrganizationAction({}, form("New Club", "new-club"))).rejects.toThrow(
      /NEXT_REDIRECT \/app\/new-club/,
    );
    expect(prismaMock.organization.create).toHaveBeenCalledOnce();
  });

  it("on previews, any verified user may create an org", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", "");
    getUserIdentityMock.mockResolvedValue({ ...user, emailVerified: new Date() });

    await expect(createOrganizationAction({}, form("New Club", "new-club"))).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    expect(prismaMock.organization.create).toHaveBeenCalledOnce();
  });
});
