// Shared harness for the RLS suites (tests.mjs, attacks.mjs, phases.mjs).
// Each suite runs against the throwaway database that run.mjs prepared
// (migrations, local-roles.sql, fixtures.sql) and connects as the table
// owner plus the three runtime roles (password 'test', local-roles.sql).
//
// Connection settings come from run.mjs through the environment:
//   RLS_HOST, RLS_PORT, RLS_DB        the throwaway database
//   OWNER_USER, OWNER_PASSWORD        the migration owner (rls_owner by default)
//   ADMIN_USER, ADMIN_PASSWORD        the role run.mjs created the database with
//   RLS_ROLE_PASSWORD                 runtime role password (default 'test')
import pg from "pg";

export const ROLES = ["app_user", "app_service", "app_auth"];

/** The admin run.mjs connected as, for the cases that need a superuser. */
export async function connectAdmin() {
  if (!process.env.ADMIN_USER)
    throw new Error("ADMIN_USER is not set: run through `pnpm test:rls`");
  return connectAs(process.env.ADMIN_USER, process.env.ADMIN_PASSWORD);
}

export function dbConfig() {
  const database = process.env.RLS_DB;
  if (!database) {
    throw new Error(
      "RLS_DB is not set: run the suites through `pnpm test:rls` (prisma/rls/run.mjs)",
    );
  }
  return {
    host: process.env.RLS_HOST || "localhost",
    port: Number(process.env.RLS_PORT || 5432),
    database,
  };
}

export async function connect(role) {
  const c = new pg.Client({
    ...dbConfig(),
    user: role === "owner" ? process.env.OWNER_USER || "postgres" : role,
    password:
      role === "owner"
        ? process.env.OWNER_PASSWORD || "postgres"
        : process.env.RLS_ROLE_PASSWORD || "test",
  });
  await c.connect();
  return c;
}

export async function connectAs(user, password) {
  const c = new pg.Client({ ...dbConfig(), user, password });
  await c.connect();
  return c;
}

/**
 * A result recorder. Cases never see each other's writes: each runs in
 * BEGIN ... ROLLBACK. A case that cannot run in the current setup returns
 * { skipped: reason } and is counted as SKIP, never as PASS.
 */
export function createSuite(name) {
  const clients = {};
  const results = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  function record(pass, line) {
    results.push(`${pass ? "PASS" : "FAIL"} ${line}`);
    if (pass) passed++;
    else failed++;
  }

  function skip(line) {
    results.push(`SKIP ${line}`);
    skipped++;
  }

  async function open() {
    clients.owner = await connect("owner");
    for (const r of ROLES) clients[r] = await connect(r);
    return clients;
  }

  // ctx: { user, org } -> app.set_context(user, org): transaction-local GUCs
  // bound to this transaction. ctx === null -> no GUCs at all.
  async function tcase(id, title, role, ctx, body, expect, client = clients[role]) {
    const c = client;
    let outcome;
    try {
      await c.query("BEGIN");
      if (ctx) {
        await c.query("SELECT app.set_context($1, $2)", [ctx.user ?? "", ctx.org ?? ""]);
      }
      const q = (sql, params) => c.query(sql, params);
      const value = await body(q);
      outcome = { ok: true, value };
    } catch (e) {
      outcome = { ok: false, code: e.code, message: e.message };
    } finally {
      await c.query("ROLLBACK").catch(() => {});
    }
    if (outcome.ok && outcome.value && outcome.value.skipped) {
      skip(`${id} [${role}] ${title} -> ${outcome.value.skipped}`);
      return;
    }
    let pass;
    let got;
    if (expect.error) {
      pass = !outcome.ok && outcome.code === expect.error;
      got = outcome.ok
        ? `no error, value=${JSON.stringify(outcome.value)}`
        : `${outcome.code} ${outcome.message}`;
    } else {
      pass =
        outcome.ok &&
        (expect.check
          ? expect.check(outcome.value)
          : JSON.stringify(outcome.value) === JSON.stringify(expect.value));
      got = outcome.ok ? JSON.stringify(outcome.value) : `${outcome.code} ${outcome.message}`;
    }
    record(pass, `${id} [${role}] ${title} -> ${got}`);
  }

  async function finish() {
    for (const l of results) console.log(l);
    console.log(
      `\n[${name}] ${passed} passed, ${failed} failed, ${skipped} skipped, ${passed + failed + skipped} total`,
    );
    for (const c of Object.values(clients)) await c.end().catch(() => {});
    return failed;
  }

  return { clients, open, tcase, record, skip, finish };
}

export const count = async (q, sql, params) => Number((await q(sql, params)).rows[0].n);
export const rc = async (q, sql, params) => (await q(sql, params)).rowCount;

// Runs one statement under a savepoint: its rowCount (or "ok" for a command
// without one) on success, its SQLSTATE on error. The surrounding
// transaction continues either way.
export const tryq = async (q, sql, params) => {
  await q("SAVEPOINT s");
  try {
    const res = await q(sql, params);
    await q("RELEASE SAVEPOINT s");
    const r = Array.isArray(res) ? res[res.length - 1] : res;
    return r.rowCount ?? "ok";
  } catch (e) {
    await q("ROLLBACK TO SAVEPOINT s");
    return e.code;
  }
};

// Same, but the first column of the first row (or "error:<SQLSTATE>").
export const tryv = async (q, sql, params) => {
  await q("SAVEPOINT s");
  try {
    const r = await q(sql, params);
    await q("RELEASE SAVEPOINT s");
    const row = r.rows[0];
    return row ? Object.values(row)[0] : null;
  } catch (e) {
    await q("ROLLBACK TO SAVEPOINT s");
    return `error:${e.code}`;
  }
};

// Same, but { code, message } of the failure, or { ok: rowCount }.
export const trye = async (q, sql, params) => {
  await q("SAVEPOINT s");
  try {
    const r = await q(sql, params);
    await q("RELEASE SAVEPOINT s");
    return { ok: r.rowCount };
  } catch (e) {
    await q("ROLLBACK TO SAVEPOINT s");
    return { code: e.code, message: e.message };
  }
};

export const HASH = (c) => c.repeat(64);
export const A = (user) => ({ user, org: "org_A" });
export const B = (user) => ({ user, org: "org_B" });

/** Runs a suite body and exits with 0 (all passed), 1 (failures) or 2 (harness error). */
export function runSuite(name, body) {
  const suite = createSuite(name);
  (async () => {
    await suite.open();
    await body(suite);
    const failed = await suite.finish();
    process.exit(failed ? 1 : 0);
  })().catch((e) => {
    console.error(`[${name}] HARNESS ERROR:`, e);
    process.exit(2);
  });
}
