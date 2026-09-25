import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NotFoundError } from "@/lib/auth/errors";

import { ConflictError } from "./errors";

/**
 * Unit tests of the wrapper semantics with fake clients: context first, the
 * membership check, commit/rollback, afterCommit ordering, navigation
 * errors, error mapping, joining, retries and the overloads. The database
 * side (policies, set_context, fail-closed roles) is proven by pnpm test:rls.
 */

interface FakeClient {
  log: string[];
  role: (user: string, org: string) => string | null;
  failStarts: number;
  $transaction: ReturnType<typeof vi.fn>;
}

const { makeClient, requireUserMock } = vi.hoisted(() => {
  const makeClient = (name: string): FakeClient => {
    const c: FakeClient = {
      log: [],
      role: () => "MEMBER",
      failStarts: 0,
      $transaction: vi.fn(),
    };
    c.$transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>, opts: unknown) => {
        if (c.failStarts > 0) {
          c.failStarts--;
          throw Object.assign(new Error("Unable to start a transaction in the given time."), {
            code: "P2028",
          });
        }
        c.log.push(`${name}:BEGIN ${JSON.stringify(opts)}`);
        const tx = {
          name,
          $queryRaw: vi.fn(async (_strings: TemplateStringsArray, user: string, org: string) => {
            c.log.push(`${name}:set_context(${user},${org})`);
            return [{ role: c.role(user, org) }];
          }),
        };
        try {
          const result = await fn(tx);
          c.log.push(`${name}:COMMIT`);
          return result;
        } catch (error) {
          c.log.push(`${name}:ROLLBACK`);
          throw error;
        }
      },
    );
    return c;
  };
  return { makeClient, requireUserMock: vi.fn() };
});

const { app, service } = vi.hoisted(() => ({
  app: makeClient("app"),
  service: makeClient("service"),
}));

vi.mock("./clients", () => ({ appDb: app, serviceDb: service }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));

import { currentTx, withOrgAction, withOrgTx, withSystemOrgTx, withUserTx } from "./context";

const user = { id: "u1", email: "u1@example.edu", name: "U One" };

beforeEach(() => {
  for (const c of [app, service]) {
    c.log.length = 0;
    c.role = () => "MEMBER";
    c.failStarts = 0;
    c.$transaction.mockClear();
  }
  requireUserMock.mockReset();
  requireUserMock.mockResolvedValue(user);
});

describe("withOrgAction", () => {
  it("sets the context first, passes ctx and args, and commits", async () => {
    const action = withOrgAction(async (ctx, a: number, b: string) => {
      expect(currentTx()?.organizationId).toBe("org1");
      return `${ctx.user.id}:${ctx.organizationId}:${ctx.role}:${ctx.kind}:${a}:${b}`;
    });
    await expect(action("org1", 2, "x")).resolves.toBe("u1:org1:MEMBER:action:2:x");
    expect(app.log).toEqual([
      'app:BEGIN {"maxWait":10000,"timeout":10000,"isolationLevel":"ReadCommitted"}',
      "app:set_context(u1,org1)",
      "app:COMMIT",
    ]);
  });

  it("throws NotFoundError for a non-member before running the handler", async () => {
    app.role = () => null;
    const handler = vi.fn();
    await expect(withOrgAction(handler)("org1")).rejects.toBeInstanceOf(NotFoundError);
    expect(handler).not.toHaveBeenCalled();
    expect(app.log.at(-1)).toBe("app:ROLLBACK");
  });

  it("runs afterCommit callbacks in order after COMMIT", async () => {
    const order: string[] = [];
    const action = withOrgAction(async (ctx) => {
      ctx.afterCommit(() => {
        order.push(`first:${app.log.at(-1)}`);
      });
      ctx.afterCommit(async () => {
        order.push("second");
      });
      order.push("handler");
      return { ok: true };
    });
    await action("org1");
    expect(order).toEqual(["handler", "first:app:COMMIT", "second"]);
  });

  it("drops afterCommit callbacks and rolls back on a throw", async () => {
    const cb = vi.fn();
    const action = withOrgAction(async (ctx) => {
      ctx.afterCommit(cb);
      throw new Error("boom");
    });
    await expect(action("org1")).rejects.toThrow("boom");
    expect(cb).not.toHaveBeenCalled();
    expect(app.log.at(-1)).toBe("app:ROLLBACK");
  });

  it("commits, flushes afterCommit, then rethrows a redirect", async () => {
    const order: string[] = [];
    const action = withOrgAction(async (ctx) => {
      ctx.afterCommit(() => {
        order.push("afterCommit");
      });
      redirect("/app/somewhere");
    });
    const error = await action("org1").catch((e: unknown) => e);
    expect((error as { digest?: string }).digest).toMatch(/^NEXT_REDIRECT/);
    expect(app.log.at(-1)).toBe("app:COMMIT");
    expect(order).toEqual(["afterCommit"]);
  });

  it("commits a returned { error }", async () => {
    await expect(withOrgAction(async () => ({ error: "nope" }))("org1")).resolves.toEqual({
      error: "nope",
    });
    expect(app.log.at(-1)).toBe("app:COMMIT");
  });

  it("maps database errors that escape the handler to generic AppErrors", async () => {
    const action = withOrgAction(async () => {
      throw Object.assign(
        new Error('duplicate key value violates unique constraint "Label_pkey"'),
        { code: "23505" },
      );
    });
    const error = await action("org1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as Error).message).not.toContain("Label_pkey");
  });

  it("never retries when the transaction cannot start", async () => {
    app.failStarts = 1;
    await expect(withOrgAction(async () => 1)("org1")).rejects.toMatchObject({ code: "P2028" });
    expect(app.$transaction).toHaveBeenCalledTimes(1);
  });

  it("a nested wrapper for the same user and org joins the transaction", async () => {
    const action = withOrgAction(async (outer) => {
      const inner = await withOrgTx("org1", async (ctx) => ctx.db);
      return inner === outer.db;
    });
    await expect(action("org1")).resolves.toBe(true);
    expect(app.$transaction).toHaveBeenCalledTimes(1);
  });

  it("the service path from inside an action opens its own transaction and context", async () => {
    const action = withOrgAction(async (outer) => {
      const inner = await withSystemOrgTx("org1", { userId: outer.userId }, async (ctx) => {
        expect(currentTx()?.kind).toBe("system");
        return ctx.kind;
      });
      expect(currentTx()?.kind).toBe("action");
      return inner;
    });
    await expect(action("org1")).resolves.toBe("system");
    expect(service.log).toContain("service:set_context(u1,org1)");
  });
});

describe("withOrgTx and withUserTx", () => {
  it("page reads retry once when the transaction cannot start", async () => {
    app.failStarts = 1;
    await expect(withOrgTx("org1", async (ctx) => ctx.kind)).resolves.toBe("page");
    expect(app.$transaction).toHaveBeenCalledTimes(2);
  });

  it("withUserTx sets the user with no org and does not require membership", async () => {
    app.role = () => null;
    await expect(
      withUserTx("u9", async (ctx) => [ctx.userId, ctx.organizationId, ctx.role]),
    ).resolves.toEqual(["u9", null, null]);
    expect(app.log).toContain("app:set_context(u9,)");
  });
});

describe("withSystemOrgTx", () => {
  it("accepts (orgId, fn) and (orgId, options, fn)", async () => {
    service.role = () => null;
    await expect(
      withSystemOrgTx("org1", async (ctx) => [ctx.organizationId, ctx.userId]),
    ).resolves.toEqual(["org1", null]);
    await expect(
      withSystemOrgTx("org2", { userId: "u5" }, async (ctx) => [ctx.organizationId, ctx.userId]),
    ).resolves.toEqual(["org2", "u5"]);
    expect(service.log).toContain("service:set_context(,org1)");
    expect(service.log).toContain("service:set_context(u5,org2)");
  });

  it("does not require a membership and allows platform work with no org", async () => {
    service.role = () => null;
    await expect(withSystemOrgTx(null, async (ctx) => ctx.organizationId)).resolves.toBeNull();
    expect(requireUserMock).not.toHaveBeenCalled();
  });
});
