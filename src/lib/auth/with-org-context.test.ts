import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/generated/prisma/client";
import { NotFoundError } from "@/lib/auth/errors";
import { withOrgContext } from "@/lib/auth/with-org-context";

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return { ...actual, requireUser: requireUserMock };
});

const { findUniqueMock } = vi.hoisted(() => ({ findUniqueMock: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { membership: { findUnique: findUniqueMock } },
}));

const testUser = { id: "user_1", email: "member@example.edu", name: "Test User" };

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue(testUser);
});

describe("withOrgContext", () => {
  it("injects user, organizationId, and role into the wrapped handler", async () => {
    findUniqueMock.mockResolvedValue({ role: Role.ADMIN });
    const action = withOrgContext(async (ctx, extra: string) => {
      return `${ctx.role}:${ctx.organizationId}:${ctx.user.id}:${extra}`;
    });

    await expect(action("org_1", "hello")).resolves.toBe("ADMIN:org_1:user_1:hello");
  });

  it("rejects with NotFoundError for a non-member without calling the handler", async () => {
    findUniqueMock.mockResolvedValue(null);
    const handler = vi.fn();
    const action = withOrgContext(handler);

    await expect(action("org_1")).rejects.toBeInstanceOf(NotFoundError);
    expect(handler).not.toHaveBeenCalled();
  });
});
