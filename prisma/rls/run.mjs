#!/usr/bin/env node
// pnpm test:rls: proves the security layer against a real Postgres.
//
//   1. Creates a throwaway database owned by a NON-superuser role with
//      CREATEROLE (rls_owner), like neondb_owner on Neon. A superuser owner
//      would mask ownership and FORCE mistakes (T32 would be SKIP).
//   2. Runs `prisma migrate deploy` as that owner: every migration, exactly
//      as production applies them.
//   3. Applies local-roles.sql as the admin (LOGIN PASSWORD 'test' for the
//      four runtime roles) and fixtures.sql as the owner.
//   4. Runs tests.mjs (regression), attacks.mjs (executed attacks) and
//      phases.mjs (Phase 1-9 tables and the catalog), each in its own
//      process, and fails if any case fails.
//   5. Drops the database (set KEEP_RLS_DB=1 to keep it for debugging).
//
// Connection: RLS_ADMIN_URL, or else MIGRATE_DATABASE_URL / DATABASE_URL
// with the database switched to `postgres`. That role must be able to create
// roles and databases (the local postgres superuser; the CI service user).
// RLS_SUPERUSER_OWNER=1 runs the migrations as the admin instead.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import "dotenv/config";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const require = createRequire(import.meta.url);

const OWNER_ROLE = "rls_owner";
const OWNER_PASSWORD = "test";

function adminUrl() {
  if (process.env.RLS_ADMIN_URL) return new URL(process.env.RLS_ADMIN_URL);
  const base = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  if (!base) {
    throw new Error(
      "Set RLS_ADMIN_URL (or MIGRATE_DATABASE_URL / DATABASE_URL) to a role that can create databases.",
    );
  }
  const url = new URL(base);
  url.pathname = "/postgres";
  return url;
}

async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url.toString() });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

function withDatabase(url, database, user, password) {
  const u = new URL(url.toString());
  u.pathname = `/${database}`;
  if (user) u.username = user;
  if (password !== undefined) u.password = password;
  return u;
}

function runNode(args, env) {
  const r = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  return r.status ?? 1;
}

async function main() {
  const admin = adminUrl();
  const superuserOwner = process.env.RLS_SUPERUSER_OWNER === "1";
  const dbName = `cbc_rls_${Date.now().toString(36)}_${process.pid}`;
  const ownerUser = superuserOwner ? decodeURIComponent(admin.username) : OWNER_ROLE;
  const ownerPassword = superuserOwner ? decodeURIComponent(admin.password) : OWNER_PASSWORD;

  console.log(
    `[test:rls] database ${dbName}, owner ${ownerUser}${superuserOwner ? " (superuser)" : " (non-superuser, CREATEROLE)"}`,
  );

  await withClient(admin, async (c) => {
    if (!superuserOwner) {
      await c.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${OWNER_ROLE}') THEN
          CREATE ROLE ${OWNER_ROLE} LOGIN PASSWORD '${OWNER_PASSWORD}' NOSUPERUSER CREATEROLE CREATEDB NOBYPASSRLS;
        END IF;
      END $$`);
    }
    await c.query(
      superuserOwner
        ? `CREATE DATABASE ${dbName}`
        : `CREATE DATABASE ${dbName} OWNER ${OWNER_ROLE}`,
    );
  });

  const ownerUrl = withDatabase(admin, dbName, ownerUser, ownerPassword);
  let failures = 0;
  try {
    // 2. Migrations, as the owner.
    const prismaCli = require.resolve("prisma/build/index.js", { paths: [repoRoot] });
    const migrate = runNode([prismaCli, "migrate", "deploy"], {
      MIGRATE_DATABASE_URL: ownerUrl.toString(),
      DATABASE_URL: ownerUrl.toString(),
    });
    if (migrate !== 0) throw new Error(`prisma migrate deploy exited with ${migrate}`);

    // 3. Runtime role logins (admin), then fixtures (owner).
    await withClient(withDatabase(admin, dbName), (c) =>
      c.query(readFileSync(path.join(here, "local-roles.sql"), "utf8")),
    );
    await withClient(ownerUrl, (c) =>
      c.query(readFileSync(path.join(here, "fixtures.sql"), "utf8")),
    );

    // 4. Suites.
    const env = {
      RLS_HOST: admin.hostname,
      RLS_PORT: admin.port || "5432",
      RLS_DB: dbName,
      OWNER_USER: ownerUser,
      OWNER_PASSWORD: ownerPassword,
    };
    for (const suite of ["tests.mjs", "attacks.mjs", "phases.mjs"]) {
      console.log(`\n[test:rls] ===== ${suite} =====`);
      const code = runNode([path.join(here, suite)], env);
      if (code !== 0) {
        failures++;
        console.error(`[test:rls] ${suite} exited with ${code}`);
      }
    }
  } finally {
    if (process.env.KEEP_RLS_DB === "1") {
      console.log(`[test:rls] kept database ${dbName}`);
    } else {
      await withClient(admin, (c) => c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`));
    }
  }

  if (failures) {
    console.error(`\n[test:rls] FAILED: ${failures} suite(s) had failures`);
    process.exit(1);
  }
  console.log("\n[test:rls] all suites passed");
}

main().catch((e) => {
  console.error("[test:rls] error:", e);
  process.exit(2);
});
