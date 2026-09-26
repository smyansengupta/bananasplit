import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Settings > Members actions (roles, titles, removal and its cleanup,
 * transferOwnership, leaveOrg, invitations) against a fake withOrgAction
 * that hands the handler a mocked transaction client and runs afterCommit
 * callbacks after it returns, like the real wrapper. The database side of
 * the same rules (membership_guard, RLS) is covered by actions.db.test.ts
 * and the RLS suites.
 */

vi.mock("@/server/db/context", async () =>
  (await import("@/test/fake-context")).fakeContextModule(),
);
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  rateLimitKey: (...parts: string[]) => parts.join(":"),
  retryAfterText: () => "in an hour",
}));
const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { url });
  }),
}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

const { fake, resetFake } = await import("@/test/fake-context");
const { Role } = await import("@/generated/prisma/enums");
const { ForbiddenError, NotFoundError } = await import("@/lib/auth/errors");
const actions = await import("./actions");
const {
  changeMemberRole,
  removeMember,
  setMemberTitle,
  transferOwnership,
  leaveOrg,
  inviteMember,
  resendInvitation,
  revokeInvitation,
} = actions;

type Row = { userId: string; role: string };

let locked: Row[] = [];
const sqlLog: string[] = [];

function sqlOf(call: unknown[]): string {
  return (call[0] as TemplateStringsArray).join("?");
}

function makeDb() {
  return {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      sqlLog.push(sql);
      if (sql.includes("FOR UPDATE")) return locked;
      if (sql.includes("write_org_audit")) return [{ id: "audit_1" }];
      if (sql.includes("enqueue_job")) return [{ id: "job_1" }];
      return [];
    }),
    $executeRaw: vi.fn(async (strings: TemplateStringsArray) => {
      sqlLog.push(strings.join("?"));
      return 0;
    }),
    membership: {
      update: vi.fn(),
      delete: vi.fn(async () => {
        sqlLog.push("DELETE Membership");
      }),
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(),
    },
    transaction: { count: vi.fn(async () => 0) },
    taskAssignee: { deleteMany: vi.fn() },
    eventAttendee: { deleteMany: vi.fn() },
    task: { updateMany: vi.fn() },
    project: { updateMany: vi.fn() },
    orgChartPosition: { updateMany: vi.fn() },
    organization: { findUnique: vi.fn(async () => ({ name: "Org One", slug: "org-one" })) },
    notification: { createMany: vi.fn() },
    invitation: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "inv_1" })),
      update: vi.fn(),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
  };
}

function makeSystemDb() {
  return {
    notification: { deleteMany: vi.fn() },
    orgChartPosition: { updateMany: vi.fn() },
    $executeRaw: vi.fn(async () => 0),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFake({ role: Role.ADMIN, db: makeDb(), systemDb: makeSystemDb() });
  locked = [];
  sqlLog.length = 0;
});

describe("changeMemberRole", () => {
  it("rejects an ADMIN granting OWNER", async () => {
    locked = [
      { userId: "owner", role: Role.OWNER },
      { userId: "target", role: Role.MEMBER },
    ];
    const result = await changeMemberRole("org_1", "target", Role.OWNER);
    expect(result.error).toMatch(/only an owner can make someone an owner/i);
    expect(fake.db.membership.update).not.toHaveBeenCalled();
  });

  it("rejects an ADMIN demoting an OWNER", async () => {
    locked = [
      { userId: "owner", role: Role.OWNER },
      { userId: "owner_2", role: Role.OWNER },
    ];
    const result = await changeMemberRole("org_1", "owner_2", Role.MEMBER);
    expect(result.error).toMatch(/only an owner/i);
    expect(fake.db.membership.update).not.toHaveBeenCalled();
  });

  it("rejects changing your own role, before locking anything", async () => {
    fake.role = Role.OWNER;
    const result = await changeMemberRole("org_1", "actor", Role.MEMBER);
    expect(result.error).toMatch(/your own role/i);
    expect(fake.db.$queryRaw).not.toHaveBeenCalled();
  });

  it("refuses to demote the last OWNER (seen after the row lock)", async () => {
    fake.role = Role.OWNER;
    locked = [{ userId: "target", role: Role.OWNER }];
    const result = await changeMemberRole("org_1", "target", Role.ADMIN);
    expect(result.error).toMatch(/last owner/i);
    expect(fake.db.membership.update).not.toHaveBeenCalled();
  });

  it("lets an OWNER grant OWNER, and audits it", async () => {
    fake.role = Role.OWNER;
    locked = [
      { userId: "actor", role: Role.OWNER },
      { userId: "target", role: Role.ADMIN },
    ];
    const result = await changeMemberRole("org_1", "target", Role.OWNER);
    expect(result.error).toBeUndefined();
    expect(fake.db.membership.update).toHaveBeenCalledWith({
      where: { userId_organizationId: { userId: "target", organizationId: "org_1" } },
      data: { role: Role.OWNER },
    });
    expect(sqlLog.some((s) => s.includes("write_org_audit"))).toBe(true);
  });

  it("locks the org's OWNER rows and the target row FOR UPDATE", async () => {
    locked = [{ userId: "target", role: Role.MEMBER }];
    await changeMemberRole("org_1", "target", Role.TREASURER);
    const call = fake.db.$queryRaw.mock.calls[0];
    expect(sqlOf(call)).toMatch(/FOR UPDATE/);
    expect(sqlOf(call)).toMatch(/"role" = 'OWNER'/);
    expect(call.slice(1)).toEqual(["org_1", ["target"]]);
  });

  it("returns not-found for someone who isn't a member", async () => {
    locked = [{ userId: "owner", role: Role.OWNER }];
    await expect(changeMemberRole("org_1", "stranger", Role.MEMBER)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("rejects a TREASURER or MEMBER outright", async () => {
    fake.role = Role.TREASURER;
    await expect(changeMemberRole("org_1", "target", Role.MEMBER)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    fake.role = Role.MEMBER;
    await expect(changeMemberRole("org_1", "target", Role.MEMBER)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("rejects an unknown role value", async () => {
    const result = await changeMemberRole("org_1", "target", "SUPERUSER" as never);
    expect(result.error).toMatch(/valid role/i);
  });
});

describe("setMemberTitle", () => {
  it("lets an ADMIN title a member, trimmed, and clears an empty title", async () => {
    fake.db.membership.findUnique.mockResolvedValue({ role: Role.MEMBER, title: "Old" });
    expect(await setMemberTitle("org_1", "target", "  Head of Tech  ")).toEqual({});
    expect(fake.db.membership.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { title: "Head of Tech" } }),
    );
    await setMemberTitle("org_1", "target", "   ");
    expect(fake.db.membership.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { title: null } }),
    );
  });

  it("refuses an ADMIN editing an OWNER's title, and titles over 80 characters", async () => {
    fake.db.membership.findUnique.mockResolvedValue({ role: Role.OWNER, title: null });
    expect((await setMemberTitle("org_1", "owner", "Boss")).error).toMatch(/only an owner/i);
    expect((await setMemberTitle("org_1", "target", "x".repeat(81))).error).toMatch(
      /80 characters/,
    );
    expect(fake.db.membership.update).not.toHaveBeenCalled();
  });

  it("refuses a MEMBER", async () => {
    fake.role = Role.MEMBER;
    await expect(setMemberTitle("org_1", "actor", "Me")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("removeMember", () => {
  it("unties the member in the same transaction (assignments, events, task ownership, triage, chart), audits before the delete, then cleans notifications after commit", async () => {
    locked = [
      { userId: "owner", role: Role.OWNER },
      { userId: "target", role: Role.MEMBER },
    ];

    const result = await removeMember("org_1", "target");

    expect(result.error).toBeUndefined();
    const where = { organizationId: "org_1", userId: "target" };
    expect(fake.db.taskAssignee.deleteMany).toHaveBeenCalledWith({ where });
    expect(fake.db.eventAttendee.deleteMany).toHaveBeenCalledWith({ where });
    expect(fake.db.task.updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org_1",
        ownerId: "target",
        status: { not: "COMPLETED" },
        deletedAt: null,
      },
      data: { ownerId: null, ownerRelation: null, ownerFlagged: false, ownerAssignedById: null },
    });
    expect(fake.db.project.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1", triageUserId: "target" },
      data: { triageUserId: null },
    });
    expect(fake.db.orgChartPosition.updateMany).toHaveBeenCalledWith({
      where,
      data: { userId: null, matchState: "UNMATCHED", matchScore: null },
    });
    // Draft match suggestions drop the member.
    expect(sqlLog.some((s) => s.includes("array_remove") && s.includes("suggestedUserIds"))).toBe(
      true,
    );
    const auditAt = sqlLog.findIndex((s) => s.includes("write_org_audit"));
    const deleteAt = sqlLog.indexOf("DELETE Membership");
    expect(auditAt).toBeGreaterThan(-1);
    expect(auditAt).toBeLessThan(deleteAt);
    expect(fake.systemCalls).toContainEqual(["org_1", { userId: "actor" }]);
    expect(fake.systemDb.notification.deleteMany).toHaveBeenCalledWith({ where });
  });

  it("rejects an ADMIN removing an OWNER", async () => {
    locked = [
      { userId: "owner", role: Role.OWNER },
      { userId: "owner_2", role: Role.OWNER },
    ];
    const result = await removeMember("org_1", "owner_2");
    expect(result.error).toMatch(/only an owner/i);
    expect(fake.db.membership.delete).not.toHaveBeenCalled();
    expect(fake.db.eventAttendee.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses to remove the last OWNER", async () => {
    fake.role = Role.OWNER;
    locked = [{ userId: "target", role: Role.OWNER }];
    const result = await removeMember("org_1", "target");
    expect(result.error).toMatch(/last owner/i);
    expect(fake.db.membership.delete).not.toHaveBeenCalled();
  });

  it("refuses while the member has unreimbursed expenses, and touches nothing", async () => {
    locked = [{ userId: "target", role: Role.MEMBER }];
    fake.db.transaction.count.mockResolvedValue(2);
    const result = await removeMember("org_1", "target");
    expect(result.error).toMatch(/2 unreimbursed expenses/i);
    expect(fake.db.taskAssignee.deleteMany).not.toHaveBeenCalled();
    expect(fake.db.membership.delete).not.toHaveBeenCalled();
    expect(fake.systemDb.notification.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects removing yourself", async () => {
    const result = await removeMember("org_1", "actor");
    expect(result.error).toMatch(/leave organization/i);
    expect(fake.db.membership.delete).not.toHaveBeenCalled();
  });
});

describe("transferOwnership", () => {
  it("promotes the target to OWNER first, then steps the caller down to ADMIN", async () => {
    fake.role = Role.OWNER;
    locked = [
      { userId: "actor", role: Role.OWNER },
      { userId: "target", role: Role.ADMIN },
    ];
    expect(await transferOwnership("org_1", "target")).toEqual({});
    expect(fake.db.membership.update.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      {
        where: { userId_organizationId: { userId: "target", organizationId: "org_1" } },
        data: { role: Role.OWNER },
      },
      {
        where: { userId_organizationId: { userId: "actor", organizationId: "org_1" } },
        data: { role: Role.ADMIN },
      },
    ]);
    // The new owner is told (SECURITY_ALERT notification + its email job).
    expect(fake.db.notification.createMany).toHaveBeenCalledOnce();
  });

  it("is OWNER-only", async () => {
    fake.role = Role.ADMIN;
    await expect(transferOwnership("org_1", "target")).rejects.toBeInstanceOf(ForbiddenError);
    expect(fake.db.membership.update).not.toHaveBeenCalled();
  });

  it("refuses yourself and non-members", async () => {
    fake.role = Role.OWNER;
    expect((await transferOwnership("org_1", "actor")).error).toMatch(/another member/i);
    locked = [{ userId: "actor", role: Role.OWNER }];
    await expect(transferOwnership("org_1", "stranger")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("leaveOrg", () => {
  it("refuses the last OWNER", async () => {
    fake.role = Role.OWNER;
    locked = [{ userId: "actor", role: Role.OWNER }];
    const result = await leaveOrg("org_1");
    expect(result.error).toMatch(/only owner/i);
    expect(fake.db.membership.delete).not.toHaveBeenCalled();
  });

  it("lets a member leave: unties, audits before deleting their own row, cleans up after commit, redirects", async () => {
    fake.role = Role.MEMBER;
    locked = [
      { userId: "owner", role: Role.OWNER },
      { userId: "actor", role: Role.MEMBER },
    ];
    await expect(leaveOrg("org_1")).rejects.toThrow(/NEXT_REDIRECT \/app$/);
    expect(fake.db.taskAssignee.deleteMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1", userId: "actor" },
    });
    expect(fake.db.membership.delete).toHaveBeenCalledWith({
      where: { userId_organizationId: { userId: "actor", organizationId: "org_1" } },
    });
    expect(sqlLog.findIndex((s) => s.includes("write_org_audit"))).toBeLessThan(
      sqlLog.indexOf("DELETE Membership"),
    );
  });

  it("lets one of two OWNERs leave", async () => {
    fake.role = Role.OWNER;
    locked = [
      { userId: "actor", role: Role.OWNER },
      { userId: "owner_2", role: Role.OWNER },
    ];
    await expect(leaveOrg("org_1")).rejects.toThrow(/NEXT_REDIRECT/);
    expect(fake.db.membership.delete).toHaveBeenCalledOnce();
  });
});

describe("invitations", () => {
  it("creates the invite with a hash only and queues the email in the same transaction", async () => {
    const result = await inviteMember("org_1", { email: "  New@Example.EDU ", role: Role.MEMBER });
    expect(result).toEqual({});
    const data = fake.db.invitation.create.mock.calls[0][0].data;
    expect(data.email).toBe("new@example.edu");
    expect(data.token).toMatch(/^[0-9a-f]{64}$/);
    expect(sqlLog.some((s) => s.includes("enqueue_job"))).toBe(true);
  });

  it("never invites as OWNER, and refuses members and treasurers", async () => {
    expect(
      (await inviteMember("org_1", { email: "a@example.edu", role: Role.OWNER })).error,
    ).toBeTruthy();
    expect(fake.db.invitation.create).not.toHaveBeenCalled();
    fake.role = Role.TREASURER;
    await expect(
      inviteMember("org_1", { email: "a@example.edu", role: Role.MEMBER }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses an existing member and a duplicate pending invite", async () => {
    fake.db.membership.findFirst.mockResolvedValueOnce({ id: "m" });
    expect(
      (await inviteMember("org_1", { email: "a@example.edu", role: Role.MEMBER })).error,
    ).toMatch(/already a member/);
    fake.db.invitation.findFirst.mockResolvedValueOnce({ id: "inv" });
    expect(
      (await inviteMember("org_1", { email: "a@example.edu", role: Role.MEMBER })).error,
    ).toMatch(/pending invite/);
  });

  it("resend restarts the expiry and queues a fresh link; accepted invites are refused", async () => {
    fake.db.invitation.findFirst.mockResolvedValueOnce({ id: "inv_1", acceptedAt: null });
    expect(await resendInvitation("org_1", "inv_1")).toEqual({});
    expect(fake.db.invitation.update).toHaveBeenCalledWith({
      where: { id: "inv_1" },
      data: { expiresAt: expect.any(Date) },
    });
    expect(sqlLog.some((s) => s.includes("enqueue_job"))).toBe(true);

    fake.db.invitation.findFirst.mockResolvedValueOnce({ id: "inv_2", acceptedAt: new Date() });
    expect((await resendInvitation("org_1", "inv_2")).error).toMatch(/already accepted/);
  });

  it("revoke deletes only this org's pending invite", async () => {
    await revokeInvitation("org_1", "inv_1");
    expect(fake.db.invitation.deleteMany).toHaveBeenCalledWith({
      where: { id: "inv_1", organizationId: "org_1", acceptedAt: null },
    });
  });
});
