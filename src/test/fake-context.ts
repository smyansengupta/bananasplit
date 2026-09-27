import { vi } from "vitest";

/**
 * A stand-in for @/server/db/context in unit tests: the wrappers hand the
 * callback the mocked clients in `fake` and run afterCommit callbacks after
 * the handler returns, like the real wrappers (a thrown error skips them).
 *
 *   vi.mock("@/server/db/context", async () =>
 *     (await import("@/test/fake-context")).fakeContextModule());
 *   import { fake } from "@/test/fake-context";
 *   fake.role = "OWNER"; fake.db = { membership: { update: vi.fn() } };
 *
 * The database rules themselves (RLS, membership_guard) are covered by the
 * *.db.test.ts files and pnpm test:rls.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface FakeState {
  userId: string;
  email: string;
  role: string | null;
  /** ctx.db for withOrgAction / withOrgTx / withUserTx. */
  db: any;
  /** ctx.db for withSystemOrgTx. */
  systemDb: any;
  /** Every withSystemOrgTx call: [orgId, options]. */
  systemCalls: Array<[string | null, { userId?: string | null }]>;
}

export const fake: FakeState = {
  userId: "actor",
  email: "actor@example.edu",
  role: "ADMIN",
  db: {},
  systemDb: {},
  systemCalls: [],
};

export function resetFake(overrides: Partial<FakeState> = {}): void {
  fake.userId = "actor";
  fake.email = "actor@example.edu";
  fake.role = "ADMIN";
  fake.db = {};
  fake.systemDb = {};
  fake.systemCalls = [];
  Object.assign(fake, overrides);
}

async function withQueue<T>(
  run: (afterCommit: (fn: () => unknown) => void) => Promise<T>,
): Promise<T> {
  const queue: Array<() => unknown> = [];
  const result = await run((fn) => queue.push(fn));
  for (const fn of queue) await fn();
  return result;
}

function orgCtx(organizationId: string, afterCommit: (fn: () => unknown) => void, kind: string) {
  return {
    kind,
    db: fake.db,
    user: { id: fake.userId, email: fake.email, name: null },
    userId: fake.userId,
    organizationId,
    role: fake.role,
    afterCommit,
  };
}

export function fakeContextModule() {
  return {
    withOrgAction:
      (handler: (ctx: any, ...args: any[]) => Promise<unknown>) =>
      (organizationId: string, ...args: any[]) =>
        withQueue((afterCommit) => handler(orgCtx(organizationId, afterCommit, "action"), ...args)),
    withOrgTx: (organizationId: string, fn: (ctx: any) => Promise<unknown>) =>
      withQueue((afterCommit) => fn(orgCtx(organizationId, afterCommit, "page"))),
    withUserTx: (userId: string, fn: (ctx: any) => Promise<unknown>) =>
      withQueue((afterCommit) =>
        fn({ kind: "user", db: fake.db, userId, organizationId: null, role: null, afterCommit }),
      ),
    // The named user, not the session one (the collaboration bridge).
    withOrgTxAs: vi.fn(
      (userId: string, organizationId: string, fn: (ctx: any) => Promise<unknown>) =>
        withQueue((afterCommit) =>
          fn({ kind: "action", db: fake.db, userId, organizationId, role: fake.role, afterCommit }),
        ),
    ),
    withSystemOrgTx: vi.fn(
      (organizationId: string | null, optsOrFn: any, maybeFn?: (ctx: any) => Promise<unknown>) => {
        const fn = typeof optsOrFn === "function" ? optsOrFn : maybeFn!;
        const opts = typeof optsOrFn === "function" ? {} : (optsOrFn ?? {});
        fake.systemCalls.push([organizationId, opts]);
        return withQueue((afterCommit) =>
          fn({
            kind: "system",
            db: fake.systemDb,
            userId: opts.userId ?? null,
            organizationId,
            role: null,
            afterCommit,
          }),
        );
      },
    ),
    assertNoTx: vi.fn(),
    currentTx: () => undefined,
    runOutsideTx: <T>(fn: () => T) => fn(),
    afterCommitOrNow: async (fn: () => unknown) => {
      await fn();
    },
    getOrgContextBySlug: vi.fn(),
  };
}
