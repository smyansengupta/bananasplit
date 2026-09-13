import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/generated/prisma/client";
import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { requireFinanceAccess, requireOrgMembership, requireRole } from "@/lib/auth/guards";

// guards.ts only uses requireUser (not getSession) from this module, so that's
// the binding to replace. Replace the whole module rather than spreading over
// importOriginal(): the real session.ts pulls in next-auth (via config.ts),
// which fails to resolve under Vitest's module graph.
const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));

const { findUniqueMock } = vi.hoisted(() => ({ findUniqueMock: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { membership: { findUnique: findUniqueMock } },
}));

const testUser = { id: "user_1", email: "member@example.edu", name: "Test User" };

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue(testUser);
});

describe("requireOrgMembership", () => {
  it("throws NotFoundError for a non-member (never Forbidden — don't leak org existence)", async () => {
    findUniqueMock.mockResolvedValue(null);
    await expect(requireOrgMembership("org_1")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("returns context for a member", async () => {
    findUniqueMock.mockResolvedValue({ role: Role.MEMBER });
    await expect(requireOrgMembership("org_1")).resolves.toEqual({
      user: testUser,
      organizationId: "org_1",
      role: Role.MEMBER,
    });
  });
});

describe("requireRole", () => {
  it("denies a MEMBER from an admin-only action", async () => {
    findUniqueMock.mockResolvedValue({ role: Role.MEMBER });
    await expect(requireRole("org_1", Role.ADMIN)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("denies a TREASURER from an admin-only action (sideways, not above MEMBER here)", async () => {
    findUniqueMock.mockResolvedValue({ role: Role.TREASURER });
    await expect(requireRole("org_1", Role.ADMIN)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("allows an ADMIN", async () => {
    findUniqueMock.mockResolvedValue({ role: Role.ADMIN });
    await expect(requireRole("org_1", Role.ADMIN)).resolves.toMatchObject({ role: Role.ADMIN });
  });

  it("allows an OWNER for an admin-only action", async () => {
    findUniqueMock.mockResolvedValue({ role: Role.OWNER });
    await expect(requireRole("org_1", Role.ADMIN)).resolves.toMatchObject({ role: Role.OWNER });
  });

  it("still reports NotFound (not Forbidden) for a non-member", async () => {
    findUniqueMock.mockResolvedValue(null);
    await expect(requireRole("org_1", Role.ADMIN)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("requireFinanceAccess", () => {
  it("allows OWNER", async () => {
    findUniqueMock.mockResolvedValue({ role: Role.OWNER });
    await expect(requireFinanceAccess("org_1")).resolves.toMatchObject({ role: Role.OWNER });
  });

  it("allows TREASURER", async () => {
    findUniqueMock.mockResolvedValue({ role: Role.TREASURER });
    await expect(requireFinanceAccess("org_1")).resolves.toMatchObject({ role: Role.TREASURER });
  });

  it("denies ADMIN", async () => {
    findUniqueMock.mockResolvedValue({ role: Role.ADMIN });
    await expect(requireFinanceAccess("org_1")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("denies MEMBER", async () => {
    findUniqueMock.mockResolvedValue({ role: Role.MEMBER });
    await expect(requireFinanceAccess("org_1")).rejects.toBeInstanceOf(ForbiddenError);
  });
});
