import { AsyncLocalStorage } from "node:async_hooks";

import { notFound, redirect, unstable_rethrow } from "next/navigation";
import { cache } from "react";

import {
  Prisma,
  type OrgKind,
  type OrgPlan,
  type OrgSettings,
  type OrgTheme,
  type PrismaClient,
  type Role,
} from "@/generated/prisma/client";
import { NotFoundError } from "@/lib/auth/errors";
import { requireUser, type SessionUser } from "@/lib/auth/session";
import type { PlanFeature } from "@/lib/billing/features";
import { spaceRefusal, type SpaceRefusal } from "@/lib/billing/space";
import type { VerifiedConnector } from "@/server/connectors/token";

import { appDb, serviceDb } from "./clients";
import { AppError, mapDbError } from "./errors";

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

/** A member of the org acting in it: what withOrgTxAs hands its callback. */
export interface MemberContext extends TxContext {
  userId: string;
  organizationId: string;
  role: Role;
}

/** withOrgAction / withOrgTx context: an authenticated member of the org. */
export interface OrgContext extends MemberContext {
  user: SessionUser;
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

/** Thrown by assertNoTx: network I/O was attempted inside a transaction. */
export class NetworkInTransactionError extends Error {
  constructor(label: string) {
    super(`${label}: network I/O must not run inside a database transaction`);
    this.name = "NetworkInTransactionError";
  }
}

/**
 * Guard for every network client (email, Blob, Google, Claude, Supabase,
 * Netlify): throws when called inside a transaction wrapper, so a slow call
 * can never hold a pooled connection or send for a write that rolls back.
 */
export function assertNoTx(label: string): void {
  if (als.getStore()) throw new NetworkInTransactionError(label);
}

/**
 * Runs `fn` with no transaction context in scope, even when called from
 * inside a wrapper (the job runner uses it so handlers always start clean).
 */
export function runOutsideTx<T>(fn: () => T): T {
  return als.exit(fn);
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
 * What a space must allow before an action runs (src/lib/billing/space.ts).
 * - feature: the action belongs to it (finance, databases, files, people,
 *   ...); a space without it refuses the action, so a typed request can't
 *   reach a locked feature any more than a page can.
 * - onRefused: "throw" (the default) throws SpaceRefusedError, an AppError
 *   whose message is meant for the person (the actions' error mappers turn
 *   it into `{ error }`); "return" hands back a SpaceRefusal instead of
 *   running the handler, for actions whose results are `{ error }` shapes.
 */
export interface OrgActionOptions {
  feature?: PlanFeature;
  onRefused?: "return" | "throw";
}

/** An action the space refused (withOrgAction, onRefused "throw"). */
export class SpaceRefusedError extends AppError {
  readonly refusal: SpaceRefusal;

  constructor(refusal: SpaceRefusal) {
    super(refusal.error, 403, "SPACE_FEATURE");
    this.name = "SpaceRefusedError";
    this.refusal = refusal;
  }
}

/** The space checks of withOrgAction, in its transaction (one indexed read). */
async function checkSpace(
  db: TxClient,
  organizationId: string,
  options: OrgActionOptions,
): Promise<SpaceRefusal | null> {
  const space = await db.organization.findUnique({
    where: { id: organizationId },
    select: { kind: true, plan: true, trialEndsAt: true },
  });
  if (!space) return null;
  const refusal = spaceRefusal(space, options);
  if (refusal && options.onRefused !== "return") throw new SpaceRefusedError(refusal);
  return refusal;
}

/**
 * The same space check for actions that can't run in withOrgAction (they
 * talk to the network between reads, like Settings > Integrations): null
 * when `options` allow the action in the org, else the refusal to return.
 */
export async function orgSpaceRefusal(
  organizationId: string,
  options: Omit<OrgActionOptions, "onRefused">,
): Promise<SpaceRefusal | null> {
  return withOrgTx(organizationId, ({ db }) =>
    checkSpace(db, organizationId, { ...options, onRefused: "return" }),
  );
}

/**
 * Wraps a Server Action. Signature `(organizationId, ...args)`: the session
 * user must be a member of the org
 * (checked by the database in the set_context round trip; a non-member gets
 * NotFoundError, so an action cannot probe whether an org exists).
 *
 *   export const createThing = withOrgAction(async (ctx, input: Input) => {
 *     await ctx.db.thing.create({ data: { organizationId: ctx.organizationId, ... } });
 *     ctx.afterCommit(() => invalidate([tags.things(ctx.organizationId)]));
 *   });
 *
 * Before the handler it asks the space (OrgActionOptions): an action of a
 * feature the space lacks is refused
 * (SpaceRefusedError, or with onRefused "return" a SpaceRefusal in place of
 * the handler's result: only for handlers whose results are `{ error }`).
 */
export function withOrgAction<Args extends unknown[], Result>(
  handler: (ctx: OrgContext, ...args: Args) => Promise<Result>,
  options: OrgActionOptions = {},
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
      async (ctx) => {
        const refusal = await checkSpace(ctx.db, organizationId, options);
        if (refusal) return refusal as Result;
        return handler(
          { ...ctx, user, userId: user.id, organizationId, role: ctx.role as Role },
          ...args,
        );
      },
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
 * App-user work for a member who was authenticated WITHOUT a session: the
 * collaboration bridge (src/app/api/collab), whose signed requests carry the
 * user id the collaboration server verified from that user's own token.
 * Otherwise exactly withOrgAction: app_user under RLS with the user's
 * context, NotFoundError for a non-member, no retry. The caller must have
 * verified the identity first; ESLint limits the importers
 * (COLLAB_BRIDGE in eslint.config.mjs, a security review item).
 */
export function withOrgTxAs<T>(
  userId: string,
  organizationId: string,
  fn: (ctx: MemberContext) => Promise<T>,
): Promise<T> {
  return runInTx(
    {
      client: appDb,
      kind: "action",
      userId,
      organizationId,
      requireMember: true,
      retryOnStartFailure: false,
    },
    (ctx) => fn({ ...ctx, userId, organizationId, role: ctx.role as Role }),
  );
}

/**
 * A connector call refused before its handler ran (src/server/connectors):
 * the member connected the app to a different space, or the club turned AI
 * connectors off. The message is meant for the member, through their app.
 */
export class ConnectorRefusedError extends AppError {
  readonly reason: "scope" | "switch";

  constructor(reason: "scope" | "switch", clubName?: string) {
    super(
      reason === "scope"
        ? "This app was connected to one space only, and this isn't it. To use another, disconnect the app on your Bananasplit profile and connect it again."
        : `${clubName ?? "This club"} has turned off AI apps. Its owners and admins can turn them back on in Admin panel › Privacy.`,
      403,
      reason === "scope" ? "CONNECTOR_SCOPE" : "CONNECTORS_OFF",
    );
    this.name = "ConnectorRefusedError";
    this.reason = reason;
  }
}

/**
 * A connected AI app's own rows for its member, with no org context: the
 * grant itself and the member's list of spaces (docs/features/ai-connectors.md).
 * Otherwise exactly withUserTx, for a member authenticated by a verified
 * AuthKit token instead of a session (VerifiedConnector is built only by
 * src/server/connectors/token.ts). No retry. ESLint limits the importers
 * (CONNECTORS in eslint.config.mjs, a security review item).
 */
export function withConnectorUserTx<T>(
  connector: VerifiedConnector,
  fn: (ctx: UserContext) => Promise<T>,
): Promise<T> {
  return runInTx(
    {
      client: appDb,
      kind: "user",
      userId: connector.userId,
      organizationId: null,
      requireMember: false,
      retryOnStartFailure: false,
    },
    (ctx) => fn({ ...ctx, userId: connector.userId, organizationId: null }),
  );
}

/** The part of a ConnectorGrant the org wrapper checks: null is every space. */
export interface ConnectorGrantScope {
  organizationId: string | null;
}

/**
 * A connected AI app acting in one space for its member: app_user under RLS
 * with the member's context, as withOrgAction, for a member authenticated
 * by a verified AuthKit token instead of a session. Refuses, in order:
 * - a grant scoped to another space (ConnectorRefusedError "scope");
 * - a non-member, or a space scheduled for deletion (NotFoundError, so a
 *   tool can't probe whether an org exists);
 * - a club with AI connectors switched off (ConnectorRefusedError "switch"),
 *   whatever the grant says;
 * - what the space's plan leaves out (SpaceRefusedError): feature
 *   "connectors", then the tool's own `feature`. (A trial that ends drops
 *   to Free; nothing is paused, so reads and writes are refused alike.)
 * The handler gets an OrgContext whose `user` is the member's own row, so
 * services that read ctx.user work unchanged. ESLint limits the importers
 * (CONNECTORS in eslint.config.mjs, a security review item).
 */
export function withConnectorOrgTx<T>(
  connector: VerifiedConnector,
  grant: ConnectorGrantScope,
  organizationId: string,
  options: Omit<OrgActionOptions, "onRefused">,
  fn: (ctx: OrgContext) => Promise<T>,
): Promise<T> {
  if (grant.organizationId !== null && grant.organizationId !== organizationId) {
    return Promise.reject(new ConnectorRefusedError("scope"));
  }
  return runInTx(
    {
      client: appDb,
      kind: "action",
      userId: connector.userId,
      organizationId,
      requireMember: true,
      retryOnStartFailure: false,
    },
    async (ctx) => {
      // Sequential: one connection per transaction.
      const space = await ctx.db.organization.findUnique({
        where: { id: organizationId },
        select: {
          name: true,
          kind: true,
          plan: true,
          trialEndsAt: true,
          deletedAt: true,
          settings: { select: { connectorsEnabled: true } },
        },
      });
      if (!space || space.deletedAt) throw new NotFoundError();
      if (space.settings && !space.settings.connectorsEnabled) {
        throw new ConnectorRefusedError("switch", space.name);
      }
      const refusal =
        spaceRefusal(space, { feature: "connectors" }) ??
        spaceRefusal(space, { feature: options.feature });
      if (refusal) throw new SpaceRefusedError(refusal);
      const user = await ctx.db.user.findUnique({
        where: { id: connector.userId },
        select: { id: true, email: true, name: true },
      });
      if (!user) throw new NotFoundError();
      return fn({
        ...ctx,
        user,
        userId: connector.userId,
        organizationId,
        role: ctx.role as Role,
      });
    },
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
  /** PERSONAL: the user's Personal space (listed first, as "Personal"). */
  kind: OrgKind;
  role: Role;
  /** Organization.logo ({ key, s64, s256, s512 }), for the org switcher. */
  logo: Prisma.JsonValue | null;
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
    /** CLUB or PERSONAL (the user's own space). */
    kind: OrgKind;
    /** What the space includes (src/lib/billing/space.ts: spaceIncludes). */
    plan: OrgPlan;
    /** TRIAL: when the trial ends (after it, the organization is on Team Free). */
    trialEndsAt: Date | null;
  };
  role: Role;
  /** Every live org the user belongs to, by name. */
  memberships: MembershipSummary[];
  /** The user's orgs scheduled for deletion (their URL shows the cancel page). */
  pendingDeletion: MembershipSummary[];
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
          kind: true,
          plan: true,
          trialEndsAt: true,
        },
      });
      const memberships = await db.membership.findMany({
        where: { userId: user.id },
        select: {
          role: true,
          organization: {
            select: {
              id: true,
              name: true,
              slug: true,
              deletedAt: true,
              logo: true,
              kind: true,
            },
          },
        },
        orderBy: { organization: { name: "asc" } },
      });
      const settings = await db.orgSettings.findUnique({
        where: { organizationId: resolved.organizationId },
      });
      const theme = await db.orgTheme.findUnique({
        where: { organizationId: resolved.organizationId },
      });
      const summary = (m: (typeof memberships)[number]): MembershipSummary => ({
        organizationId: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        kind: m.organization.kind,
        role: m.role,
        logo: m.organization.logo,
      });
      return {
        user,
        organization,
        role,
        memberships: memberships.filter((m) => m.organization.deletedAt === null).map(summary),
        pendingDeletion: memberships.filter((m) => m.organization.deletedAt !== null).map(summary),
        settings,
        theme,
      };
    });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
});
