import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

import { runtimeDatabaseUrl, type DbRole } from "./urls";

/**
 * One Prisma client per database role, each over its own pg pool.
 *
 * - appDb      app_user: request code, tenant data under RLS. Use it only
 *              through the wrappers in ./context (withOrgAction, withOrgTx,
 *              withUserTx), which set the transaction-bound context first;
 *              outside them every tenant policy fails closed (0 rows).
 * - serviceDb  app_service: jobs, crons and the enumerated no-context paths.
 *              Fail-closed without app.org_id; use withSystemOrgTx.
 * - authDb     app_auth: the Auth.js adapter, credentials sign-in, sign-up,
 *              verify-email, ICS token resolution and the rate limiter. No
 *              tenant access at all.
 * - legacyDb   app_legacy: the TEMPORARY strangler role for the Phase 0-6
 *              modules until each moves to withOrgAction/appDb (0C). It has
 *              FOR ALL policies on the 23 legacy tables and nothing else.
 *              @/lib/prisma re-exports it.
 *
 * Clients are created lazily on first use, so importing this module never
 * needs a database URL (next build, vitest, prisma generate). Each pool is
 * capped at 5 connections, and in development the clients live on
 * globalThis so hot reloads do not leak pools.
 */

const POOL_MAX = 5;

type Clients = Partial<Record<DbRole, PrismaClient>>;

const globalForDb = globalThis as unknown as { __cbcDbClients?: Clients };
const clients: Clients = globalForDb.__cbcDbClients ?? {};
if (process.env.NODE_ENV !== "production") {
  globalForDb.__cbcDbClients = clients;
}

function createClient(role: DbRole): PrismaClient {
  const adapter = new PrismaPg(
    { connectionString: runtimeDatabaseUrl(role), max: POOL_MAX },
    {
      onPoolError: (err) => console.error(`[db:${role}] pool error`, err.message),
    },
  );
  return new PrismaClient({ adapter });
}

/** The real client for `role`, created on first call. */
export function getClient(role: DbRole): PrismaClient {
  let client = clients[role];
  if (!client) {
    client = createClient(role);
    clients[role] = client;
  }
  return client;
}

/**
 * A PrismaClient-typed handle that creates the real client on first property
 * access. Methods are bound to the real client so `$transaction`,
 * `$queryRaw` and model delegates behave exactly as on a plain client.
 */
function lazyClient(role: DbRole): PrismaClient {
  return new Proxy({} as PrismaClient, {
    get(_target, prop) {
      const real = getClient(role) as unknown as Record<PropertyKey, unknown>;
      const value = real[prop];
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(real)
        : value;
    },
    has(_target, prop) {
      return prop in (getClient(role) as object);
    },
  });
}

export const appDb: PrismaClient = lazyClient("app");
export const serviceDb: PrismaClient = lazyClient("service");
export const authDb: PrismaClient = lazyClient("auth");
export const legacyDb: PrismaClient = lazyClient("legacy");

/** Closes every pool that was opened (scripts and tests). */
export async function disconnectAll(): Promise<void> {
  const open = Object.entries(clients) as [DbRole, PrismaClient][];
  for (const [role] of open) delete clients[role];
  await Promise.all(open.map(([, client]) => client.$disconnect()));
}
