import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Member management (0A Fix 3 and the removal cleanup), against a fake
 * withOrgAction that hands the handler a mocked transaction client and runs
 * afterCommit callbacks after the handler returns, like the real wrapper.
 * The database side of the same rules (membership_guard) is covered by
 * actions.db.test.ts and the RLS suites.
 */

type Row = { userId: string; role: string };

const { state, db, systemDb, withSystemOrgTxMock } = vi.hoisted(() => {
  const db = {
    $queryRaw: vi.fn(),
    membership: { update: vi.fn(), delete: vi.fn() },
    transaction: { count: vi.fn() },
    taskAssignee: { deleteMany: vi.fn() },
    eventAttendee: { deleteMany: vi.fn() },
    orgChartPosition: { updateMany: vi.fn() },
  };
  const systemDb = { notification: { deleteMany: vi.fn() } };
  return {
    state: { userId: "actor", role: "ADMIN" as string },
    db,
    systemDb,
    withSystemOrgTxMock: vi.fn(
      async (
        organizationId: string,
        _opts: unknown,
        fn: (ctx: { db: typeof systemDb; organizationId: string }) => Promise<unknown>,
      ) => fn({ db: systemDb, organizationId }),
    ),
  };
});

vi.mock("@/server/db/context", () => ({
  withOrgAction:
    (handler: (ctx: unknown, ...args: unknown[]) => Promise<unknown>) =>
    async (organizationId: string, ...args: unknown[]) => {
      const queue: Array<() => unknown> = [];
      const result = await handler(
        {
          kind: "action",
          db,
          user: { id: state.userId, email: `${state.userId}@example.edu`, name: null },
          userId: state.userId,
          organizationId,
          role: state.role,
          afterCommit: (fn: () => unknown) => queue.push(fn),
        },
        ...args,
      );
      for (const fn of queue) await fn();
      return result;
    },
  withSystemOrgTx: withSystemOrgTxMock,
}));

const { Role } = await import("@/generated/prisma/enums");
const { ForbiddenError, NotFoundError } = await import("@/lib/auth/errors");
const { changeMemberRole, removeMember } = await import("./actions");

function lockedRows(rows: Row[]) {
  db.$queryRaw.mockResolvedValue(rows);
}

beforeEach(() => {
  vi.clearAllMocks();
  state.userId = "actor";
  state.role = Role.ADMIN;
  db.transaction.count.mockResolvedValue(0);
});

describe("changeMemberRole", () => {
  it("rejects an ADMIN granting OWNER", async () => {
    lockedRows([
      { userId: "owner", role: Role.OWNER },
      { userId: "target", role: Role.MEMBER },
    ]);

    const result = await changeMemberRole("org_1", "target", Role.OWNER);

    expect(result.error).toMatch(/only an owner can make someone an owner/i);
    expect(db.membership.update).not.toHaveBeenCalled();
  });

  it("rejects an ADMIN demoting an OWNER", async () => {
    lockedRows([
      { userId: "owner", role: Role.OWNER },
      { userId: "owner_2", role: Role.OWNER },
    ]);

    const result = await changeMemberRole("org_1", "owner_2", Role.MEMBER);

    expect(result.error).toMatch(/only an owner/i);
    expect(db.membership.update).not.toHaveBeenCalled();
  });

  it("rejects changing your own role, before locking anything", async () => {
    state.role = Role.OWNER;

    const result = await changeMemberRole("org_1", "actor", Role.MEMBER);

    expect(result.error).toMatch(/your own role/i);
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.membership.update).not.toHaveBeenCalled();
  });

  it("refuses to demote the last OWNER (seen after the row lock)", async () => {
    // A concurrent demotion committed first: after the FOR UPDATE wait only
    // the target is still an OWNER.
    state.role = Role.OWNER;
    lockedRows([{ userId: "target", role: Role.OWNER }]);

    const result = await changeMemberRole("org_1", "target", Role.ADMIN);

    expect(result.error).toMatch(/last owner/i);
    expect(db.membership.update).not.toHaveBeenCalled();
  });

  it("lets an OWNER grant OWNER and writes in the same transaction", async () => {
    state.role = Role.OWNER;
    lockedRows([
      { userId: "actor", role: Role.OWNER },
      { userId: "target", role: Role.ADMIN },
    ]);

    const result = await changeMemberRole("org_1", "target", Role.OWNER);

    expect(result.error).toBeUndefined();
    expect(db.membership.update).toHaveBeenCalledWith({
      where: { userId_organizationId: { userId: "target", organizationId: "org_1" } },
      data: { role: Role.OWNER },
    });
  });

  it("locks the org's OWNER rows and the target row FOR UPDATE", async () => {
    lockedRows([{ userId: "target", role: Role.MEMBER }]);

    await changeMemberRole("org_1", "target", Role.TREASURER);

    const sql = (db.$queryRaw.mock.calls[0]?.[0] as TemplateStringsArray).join("?");
    expect(sql).toMatch(/FOR UPDATE/);
    expect(sql).toMatch(/"role" = 'OWNER'/);
    expect(db.$queryRaw.mock.calls[0]?.slice(1)).toEqual(["org_1", "target"]);
  });

  it("returns not-found for someone who isn't a member", async () => {
    lockedRows([{ userId: "owner", role: Role.OWNER }]);
    await expect(changeMemberRole("org_1", "stranger", Role.MEMBER)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("rejects a TREASURER or MEMBER outright", async () => {
    state.role = Role.TREASURER;
    await expect(changeMemberRole("org_1", "target", Role.MEMBER)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("rejects an unknown role value", async () => {
    const result = await changeMemberRole("org_1", "target", "SUPERUSER" as never);
    expect(result.error).toMatch(/valid role/i);
  });
});

describe("removeMember", () => {
  it("cleans up assignments, event invitations and chart positions, then notifications after commit", async () => {
    lockedRows([
      { userId: "owner", role: Role.OWNER },
      { userId: "target", role: Role.MEMBER },
    ]);

    const result = await removeMember("org_1", "target");

    expect(result.error).toBeUndefined();
    const where = { organizationId: "org_1", userId: "target" };
    expect(db.taskAssignee.deleteMany).toHaveBeenCalledWith({ where });
    expect(db.eventAttendee.deleteMany).toHaveBeenCalledWith({ where });
    expect(db.orgChartPosition.updateMany).toHaveBeenCalledWith({
      where,
      data: { userId: null, matchState: "UNMATCHED", matchScore: null },
    });
    expect(db.membership.delete).toHaveBeenCalledWith({
      where: { userId_organizationId: { userId: "target", organizationId: "org_1" } },
    });
    expect(withSystemOrgTxMock).toHaveBeenCalledWith(
      "org_1",
      { userId: "actor" },
      expect.any(Function),
    );
    expect(systemDb.notification.deleteMany).toHaveBeenCalledWith({ where });
  });

  it("rejects an ADMIN removing an OWNER", async () => {
    lockedRows([
      { userId: "owner", role: Role.OWNER },
      { userId: "owner_2", role: Role.OWNER },
    ]);

    const result = await removeMember("org_1", "owner_2");

    expect(result.error).toMatch(/only an owner/i);
    expect(db.membership.delete).not.toHaveBeenCalled();
    expect(db.eventAttendee.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses to remove the last OWNER", async () => {
    state.role = Role.OWNER;
    lockedRows([{ userId: "target", role: Role.OWNER }]);

    const result = await removeMember("org_1", "target");

    expect(result.error).toMatch(/last owner/i);
    expect(db.membership.delete).not.toHaveBeenCalled();
  });

  it("refuses while the member has unreimbursed expenses, and touches nothing", async () => {
    lockedRows([{ userId: "target", role: Role.MEMBER }]);
    db.transaction.count.mockResolvedValue(2);

    const result = await removeMember("org_1", "target");

    expect(result.error).toMatch(/2 unreimbursed expenses/i);
    expect(db.taskAssignee.deleteMany).not.toHaveBeenCalled();
    expect(db.membership.delete).not.toHaveBeenCalled();
    expect(systemDb.notification.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects removing yourself", async () => {
    const result = await removeMember("org_1", "actor");
    expect(result.error).toMatch(/yourself/i);
    expect(db.membership.delete).not.toHaveBeenCalled();
  });
});
