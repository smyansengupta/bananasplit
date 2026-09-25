import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

/**
 * A Prisma client as the table owner (MIGRATE_DATABASE_URL), for `*.db.test.ts`
 * fixtures only — never imported by application code.
 *
 * The database tests need to read and set up rows without a tenant context:
 * look the seeded CBC org up by slug, count what an action wrote across orgs,
 * and so on. They used `legacyDb` for that, because app_legacy carried
 * `FOR ALL USING(true)` policies on 23 tables — that is, the tests leaned on
 * the very hole the 0C teardown closes. The owner connection is what the
 * migrations and the seed already use, and several tests already open a raw
 * `pg` client on the same URL for the same reason.
 *
 * Call `disconnectOwnerDb()` alongside `disconnectAll()` in afterAll.
 */

let client: PrismaClient | null = null;

function real(): PrismaClient {
  if (!client) {
    const connectionString = process.env.MIGRATE_DATABASE_URL;
    if (!connectionString) throw new Error("ownerDb needs MIGRATE_DATABASE_URL");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 3 }) });
  }
  return client;
}

/** Created on first property access, so importing this module needs no URL. */
export const ownerDb: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const target = real() as unknown as Record<PropertyKey, unknown>;
    const value = target[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
  },
  has(_target, prop) {
    return prop in (real() as object);
  },
});

export async function disconnectOwnerDb(): Promise<void> {
  const open = client;
  client = null;
  await open?.$disconnect();
}
