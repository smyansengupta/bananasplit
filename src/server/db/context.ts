import { AsyncLocalStorage } from "node:async_hooks";

import { notFound, redirect, unstable_rethrow } from "next/navigation";
import { cache } from "react";

import {
  Prisma,
  type OrgSettings,
  type OrgTheme,
  type PrismaClient,
  type Role,
} from "@/generated/prisma/client";
import { NotFoundError } from "@/lib/auth/errors";
import { requireUser, type SessionUser } from "@/lib/auth/session";

import { appDb, serviceDb } from "./clients";
import { mapDbError } from "./errors";

/**
 * Transaction wrappers: the only way request code, jobs and crons reach
 * tenant data (see docs/ARCHITECTURE.md and the plan's 'RLS mechanism
 * under adapter-pg' decision).
 *
 * Every wrapper runs ONE interactive transaction whose first statement is
 *   SELECT app.set_context(user, org)
 * which sets app.user_id / app.org_id transaction-locally, stamps them with
 * the current transaction (a context leaked onto a pooled connection is dead
 * in the next transaction) and returns the caller's Role in the org in the
 * same round trip. RLS then enforces tenancy and membership in the database.
 *
 * Semantics shared by every wrapper:
 * - ReadCommitted, maxWait 10s, timeout 10s. No network I/O inside the
 *   transaction (email, Blob, Google, Claude, Supabase, Netlify): queue it
 *   with ctx.afterCommit(fn) or enqueue a job (app.enqueue_job runs in the
 *   same transaction, so a rolled-back write never sends anything).
 * - ctx.afterCommit(fn) callbacks run in order after COMMIT and are dropped
 *   on rollback. Cache invalidation (src/server/cache/invalidate.ts) queues
 *   here too. A failing callback is logged, never thrown: the write is
 *   already committed.
 * - A redirect(), notFound(), forbidden() or unauthorized() thrown by the
 *   handler COMMITS the transaction and is rethrown after commit (and after
 *   the afterCommit queue), preserving 'write, then redirect'. Any other
 *   throw rolls back. A returned value (e.g. { error }) commits.
 * - Database errors that escape the handler are mapped to generic AppErrors
 *   (./errors): no constraint message or policy name reaches the client.
 * - A wrapper called inside a transaction that already has the same client,
 *   user and org joins it instead of opening a second connection; any other
 *   combination opens its own transaction.
 * - Page reads (withOrgTx, withUserTx) retry once when the transaction
 *   could not start (P2028, e.g. a cold Neon compute). Actions never retry.
 *
 * The context lives in AsyncLocalStorage, so shared services can reach the
 * current transaction with currentTx() instead of threading `db` through.
 * Cached loaders (src/server/cached) must NOT read it: they open their own
 * withSystemOrgTx with explicit arguments.
 */

export type TxClient = Prisma.TransactionClient;

export type TxKind = "action" | "page" | "user" | "system";

export type AfterCommit = (fn: () => void | Promise<void>) => void;

/** What every wrapper hands its callback. */
export interface TxContext {
  kind: TxKind;
  /** The transaction client. Use it for every query in the unit of work. */
  db: TxClient;
  userId: string | null;
  organizationId: string | null;
  /** The user's Role in the org (NULL for a service context without a member user). */
  role: Role | null;
  afterCommit: AfterCommit;
}

/** withOrgAction / withOrgTx context: an authenticated member of the org. */
export interface OrgContext extends TxContext {
  user: SessionUser;
  userId: string;
  organizationId: string;
  role: Role;
}

/** withUserTx context: an authenticated user, no org. */
export interface UserContext extends TxContext {
  userId: string;
  organizationId: null;
}

/** withSystemOrgTx context: the fail-closed service role. */
export interface SystemContext extends TxContext {
  organizationId: string | null;
}

interface Store {
  client: PrismaClient;
  ctx: TxContext;
}

const als = new AsyncLocalStorage<Store>();

const TX_OPTIONS = {
  maxWait: 10_000,
  timeout: 10_000,
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
} as const;

/** The transaction context of the current async call chain, if any. */
export function currentTx(): TxContext | undefined {
  return als.getStore()?.ctx;
}

/**
 * Runs `fn` after the current transaction commits, or immediately (awaited)
 * when there is no transaction in scope. For cache invalidation and other
 * post-commit side effects in shared services.
 */
export async function afterCommitOrNow(fn: () => void | Promise<void>): Promise<void> {
  const store = als.getStore();
  if (store) {
    store.ctx.afterCommit(fn);
    return;
  }
  await fn();
}

/** True for the control-flow errors Next.js throws (redirect, notFound, ...). */
export function isNextControlFlowError(error: unknown): boolean {
  try {
    unstable_rethrow(error);
    return false;
  } catch {
    return true;
  }
}

function isTransactionStartFailure(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2028"
  );
}

async function flush(queue: Array<() => void | Promise<void>>): Promise<void> {
  for (const fn of queue) {
    try {
      await fn();
    } catch (error) {
      // The transaction is committed; a failed side effect must not turn a
      // successful write into an error response.
      console.error("[db] afterCommit callback failed", error);
    }
  }
}

interface RunOptions {
  client: PrismaClient;
  kind: TxKind;
  userId: string | null;
  organizationId: string | null;
  /** Throw NotFoundError unless set_context returns a Role (non-members). */
  requireMember: boolean;
  retryOnStartFailure: boolean;
}

async function runInTx<T>(opts: RunOptions, fn: (ctx: TxContext) => Promise<T>): Promise<T> {
  const current = als.getStore();
  if (
    current &&
    current.client === opts.client &&
    current.ctx.userId === opts.userId &&
    current.ctx.organizationId === opts.organizationId &&
    (!opts.requireMember || current.ctx.role !== null)
  ) {
    return fn(current.ctx);
  }

  const queue: Array<() => void | Promise<void>> = [];
  let navigation: { error: unknown } | null = null;

  const attempt = () => {
    queue.length = 0;
    navigation = null;
    return opts.client.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ role: Role | null }[]>`
        SELECT app.set_context(${opts.userId ?? ""}, ${opts.organizationId ?? ""})::text AS role`;
      const role = rows[0]?.role ?? null;
      if (opts.requireMember && (opts.organizationId === null || role === null)) {
        throw new NotFoundError();
      }
      const ctx: TxContext = {
        kind: opts.kind,
        db: tx,
        userId: opts.userId,
        organizationId: opts.organizationId,
        role,
        afterCommit: (cb) => {
          queue.push(cb);
        },
      };
      try {
        return await als.run({ client: opts.client, ctx }, () => fn(ctx));
      } catch (error) {
        if (isNextControlFlowError(error)) {
          navigation = { error };
          return undefined as T;
        }
        throw error;
      }
    }, TX_OPTIONS);
  };

  let result: T;
  try {
    try {
      result = await attempt();
    } catch (error) {
      if (!opts.retryOnStartFailure || !isTransactionStartFailure(error)) throw error;
      result = await attempt();
    }
  } catch (error) {
    throw mapDbError(error);
  }

  await flush(queue);
  const nav = navigation as { error: unknown } | null;
  if (nav) throw nav.error;
  return result;
}

/**
 * Wraps a Server Action. Signature `(organizationId, ...args)`, the same as
 * the legacy withOrgContext: the session user must be a member of the org
 * (checked by the database in the set_context round trip; a non-member gets
 * NotFoundError, so an action cannot probe whether an org exists).
 *
 *   export const createThing = withOrgAction(async (ctx, input: Input) => {
 *     await ctx.db.thing.create({ data: { organizationId: ctx.organizationId, ... } });
 *     ctx.afterCommit(() => invalidate([tags.things(ctx.organizationId)]));
 *   });
 */
export function withOrgAction<Args extends unknown[], Result>(
  handler: (ctx: OrgContext, ...args: Args) => Promise<Result>,
): (organizationId: string, ...args: Args) => Promise<Result> {
  return async (organizationId, ...args) => {
    const user = await requireUser();
    return runInTx(
      {
        client: appDb,
        kind: "action",
        userId: user.id,
        organizationId,
        requireMember: true,
        retryOnStartFailure: false,
      },
      (ctx) =>
        handler({ ...ctx, user, userId: user.id, organizationId, role: ctx.role as Role }, ...args),
    );
  };
}

/** Page and layout reads for the session user in `organizationId`. */
export async function withOrgTx<T>(
  organizationId: string,
  fn: (ctx: OrgContext) => Promise<T>,
): Promise<T> {
  const user = await requireUser();
  return runInTx(
    {
      client: appDb,
      kind: "page",
      userId: user.id,
      organizationId,
      requireMember: true,
      retryOnStartFailure: true,
    },
    (ctx) => fn({ ...ctx, user, userId: user.id, organizationId, role: ctx.role as Role }),
  );
}

/**
 * The session user's own rows across orgs, with no org context: the org
 * switcher, the notification bell, the user's own profile and ICS token.
 */
export async function withUserTx<T>(
  userId: string,
  fn: (ctx: UserContext) => Promise<T>,
): Promise<T> {
  return runInTx(
    {
      client: appDb,
      kind: "user",
      userId,
      organizationId: null,
      requireMember: false,
      retryOnStartFailure: true,
    },
    (ctx) => fn({ ...ctx, userId, organizationId: null }),
  );
}

export interface SystemTxOptions {
  /**
   * The acting user, when a user action reaches the service path (secrets,
   * invite acceptance, org creation). Recorded as app.user_id: audit rows
   * and the bootstrap-OWNER rule use it. Omit for jobs and crons.
   */
  userId?: string | null;
}

/**
 * The service path (app_service): jobs, crons, the secrets accessor and the
 * enumerated no-context routes. Fail-closed: every tenant policy requires
 * app.org_id, so `organizationId` null sees no tenant rows at all (only the
 * platform definer functions work). Authorize BEFORE calling this: it does
 * not check membership.
 */
export function withSystemOrgTx<T>(
  organizationId: string | null,
  fn: (ctx: SystemContext) => Promise<T>,
): Promise<T>;
export function withSystemOrgTx<T>(
  organizationId: string | null,
  options: SystemTxOptions,
  fn: (ctx: SystemContext) => Promise<T>,
): Promise<T>;
export async function withSystemOrgTx<T>(
  organizationId: string | null,
  optionsOrFn: SystemTxOptions | ((ctx: SystemContext) => Promise<T>),
  maybeFn?: (ctx: SystemContext) => Promise<T>,
): Promise<T> {
  const options = typeof optionsOrFn === "function" ? {} : optionsOrFn;
  const fn = typeof optionsOrFn === "function" ? optionsOrFn : maybeFn;
  if (!fn) throw new TypeError("withSystemOrgTx: missing callback");
  return runInTx(
    {
      client: serviceDb,
      kind: "system",
      userId: options.userId ?? null,
      organizationId,
      requireMember: false,
      retryOnStartFailure: false,
    },
    (ctx) => fn({ ...ctx, organizationId }),
  );
}

/** One org the user belongs to (org switcher). */
export interface MembershipSummary {
  organizationId: string;
  name: string;
  slug: string;
  role: Role;
}

export interface OrgContextBySlug {
  user: SessionUser;
  organization: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    logo: Prisma.JsonValue | null;
    activeOrgChartVersionId: string | null;
  };
  role: Role;
  /** Every org the user belongs to, by name. */
  memberships: MembershipSummary[];
  settings: OrgSettings | null;
  theme: OrgTheme | null;
}

/**
 * The org layout's per-request context, deduped with React cache(): the
 * session user, the org resolved from its slug, the user's Role in it, the
 * org switcher list, OrgSettings and OrgTheme, in one transaction.
 * - Unauthenticated: redirect to /sign-in (requireUser).
 * - Unknown slug, soft-deleted org, or not a member: notFound().
 * - A retired slug (renamed org): redirect to the canonical slug.
 */
export const getOrgContextBySlug = cache(async (slug: string): Promise<OrgContextBySlug> => {
  const user = await requireUser();

  const resolved = await withUserTx(user.id, async ({ db }) => {
    const rows = await db.$queryRaw<
      { organizationId: string; canonicalSlug: string; isRetired: boolean }[]
    >`SELECT "organizationId", "canonicalSlug", "isRetired" FROM app.resolve_org_slug(${slug})`;
    return rows[0] ?? null;
  });
  if (!resolved) notFound();
  if (resolved.isRetired) redirect(`/app/${resolved.canonicalSlug}`);

  try {
    return await withOrgTx(resolved.organizationId, async ({ db, role }) => {
      // Sequential: one connection per transaction.
      const organization = await db.organization.findUniqueOrThrow({
        where: { id: resolved.organizationId },
        select: {
          id: true,
          name: true,
          slug: true,
          timezone: true,
          logo: true,
          activeOrgChartVersionId: true,
        },
      });
      const memberships = await db.membership.findMany({
        where: { userId: user.id },
        select: {
          role: true,
          organization: { select: { id: true, name: true, slug: true, deletedAt: true } },
        },
        orderBy: { organization: { name: "asc" } },
      });
      const settings = await db.orgSettings.findUnique({
        where: { organizationId: resolved.organizationId },
      });
      const theme = await db.orgTheme.findUnique({
        where: { organizationId: resolved.organizationId },
      });
      return {
        user,
        organization,
        role,
        memberships: memberships
          .filter((m) => m.organization.deletedAt === null)
          .map((m) => ({
            organizationId: m.organization.id,
            name: m.organization.name,
            slug: m.organization.slug,
            role: m.role,
          })),
        settings,
        theme,
      };
    });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
});
