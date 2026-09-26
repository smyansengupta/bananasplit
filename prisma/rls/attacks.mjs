// Executed attack suite for the RLS attacker's findings (report 1: B1-B3
// blocking, N1-N8 non-blocking), ported from the design's 0B-rls-attacks.js.
// Each case is the attack itself, asserted to be refused. Run through
// `pnpm test:rls` (prisma/rls/run.mjs) after tests.mjs.
//
// Context is set with raw set_config(..., true) plus the transaction stamp
// (app.ctx_tx), exactly as an attacker's SQL would. Each case runs inside
// BEGIN ... ROLLBACK; setup rows that another session must see are
// committed by the owner and removed afterwards.
//
// Changes from the design suite, forced by later phases' planned schema:
//   A-N4    TaskAssignee rows carry organizationId (Phase 6); both probes
//           name the attacker's own org, so only the parent differs.
//   A-N4b   OrgSecret has the Phase 1 composite FK to OrgIntegration: a
//           foreign and a nonexistent integration id both fail the FK with
//           an identical message.
//   A-N2b   the throwaway login role is uniquely named per run, because
//           roles are cluster-global and suites may run concurrently.
import { A, B, connect, connectAs, runSuite } from "./lib.mjs";

const STAMP = "(extract(epoch FROM transaction_timestamp()) * 1000000)::bigint::text";

async function setCtx(q, ctx) {
  await q(
    `SELECT set_config('app.user_id', $1, true), set_config('app.org_id', $2, true),
                  set_config('app.ctx_tx', ${STAMP}, true)`,
    [ctx.user ?? "", ctx.org ?? ""],
  );
}

// Statement(s) under a savepoint: the (last) rowCount, or "ok" for a
// command without one, on success; the SQLSTATE on error.
const tryq = async (q, sql, params) => {
  await q("SAVEPOINT a");
  try {
    const res = await q(sql, params);
    await q("RELEASE SAVEPOINT a");
    const r = Array.isArray(res) ? res[res.length - 1] : res;
    return r.rowCount ?? "ok";
  } catch (e) {
    await q("ROLLBACK TO SAVEPOINT a");
    return e.code;
  }
};
// Same, but returns the first column of the first row (or "error:<SQLSTATE>").
const tryv = async (q, sql, params) => {
  await q("SAVEPOINT a");
  try {
    const r = await q(sql, params);
    await q("RELEASE SAVEPOINT a");
    const row = r.rows[0];
    return row ? Object.values(row)[0] : null;
  } catch (e) {
    await q("ROLLBACK TO SAVEPOINT a");
    return `error:${e.code}`;
  }
};
// Same, but returns { code, message } of the failure, or { ok: rowCount }.
const trye = async (q, sql, params) => {
  await q("SAVEPOINT a");
  try {
    const r = await q(sql, params);
    await q("RELEASE SAVEPOINT a");
    return { ok: r.rowCount };
  } catch (e) {
    await q("ROLLBACK TO SAVEPOINT a");
    return { code: e.code, message: e.message };
  }
};

runSuite("rls-attacks", async ({ clients, record: rec }) => {
  const owner = (sql, params) => clients.owner.query(sql, params);
  const record = (pass, id, finding, role, title, got) =>
    rec(pass, `${id} (${finding}) [${role}] ${title} -> ${got}`);

  // Runs body(q) as `role` inside BEGIN ... ROLLBACK with ctx (null = no GUCs).
  async function acase(id, finding, title, role, ctx, body, expect, c = clients[role]) {
    let outcome;
    try {
      await c.query("BEGIN");
      const q = (sql, params) => c.query(sql, params);
      if (ctx) await setCtx(q, ctx);
      outcome = { ok: true, value: await body(q) };
    } catch (e) {
      outcome = { ok: false, code: e.code, message: e.message };
    } finally {
      await c.query("ROLLBACK").catch(() => {});
    }
    let pass;
    let got;
    if (expect.error) {
      pass = !outcome.ok && outcome.code === expect.error;
      const shown =
        outcome.ok && outcome.value && outcome.value.rows ? outcome.value.rows : outcome.value;
      got = outcome.ok
        ? `no error, value=${JSON.stringify(shown)}`
        : `${outcome.code} ${outcome.message}`;
    } else {
      pass =
        outcome.ok &&
        (expect.check
          ? expect.check(outcome.value)
          : JSON.stringify(outcome.value) === JSON.stringify(expect.value));
      got = outcome.ok ? JSON.stringify(outcome.value) : `${outcome.code} ${outcome.message}`;
    }
    record(pass, id, finding, role, title, got);
  }

  const v3 = (await owner(`SELECT to_regprocedure('app.set_context(text,text)') IS NOT NULL AS v`))
    .rows[0].v;
  console.log(
    `target: ${v3 ? "v3 (app.set_context present)" : "pre-v3 (no app.set_context)"}; owner=${process.env.OWNER_USER || "postgres"}\n`,
  );

  // ======================= B1: cross-org outbox interference =======================
  await owner(`INSERT INTO "Job" ("id","organizationId","kind","dedupeKey","payload","runAt") VALUES
      ('job_B_purge','org_B','org-purge','org-purge:org_B','{"by":"owner B"}', (now() AT TIME ZONE 'UTC') + interval '7 days'),
      ('job_A_rebuild','org_A','site-rebuild','site-rebuild:shared','{}', (now() AT TIME ZONE 'UTC') + interval '7 days')`);
  await owner(`INSERT INTO "Job" ("id","organizationId","kind","dedupeKey","status","payload") VALUES
      ('job_A_done','org_A','digest','digest:2026-09-21','DONE','{}')`);
  {
    // The attacker's requests COMMIT, as real requests do, so an overwrite
    // of org B's row is observable afterwards; everything is removed below.
    const c = clients.app_user;
    const q = (sql, params) => c.query(sql, params);
    let v;
    try {
      await c.query("BEGIN");
      await setCtx(q, A("u_memberA"));
      const intoB = (
        await q(
          `SELECT app.enqueue_job('org_A','org-purge','org-purge:org_B','{"by":"attacker A"}') id`,
        )
      ).rows[0].id;
      await c.query("COMMIT");
      await c.query("BEGIN");
      await setCtx(q, B("u_memberB"));
      const intoA = (
        await q(
          `SELECT app.enqueue_job('org_B','site-rebuild','site-rebuild:shared','{"by":"org B"}') id`,
        )
      ).rows[0].id;
      const once = (
        await q(
          `SELECT app.enqueue_job('org_B','digest','digest:2026-09-21','{}', NULL, 8, true) id`,
        )
      ).rows[0].id;
      await c.query("COMMIT");
      const rowB = (
        await owner(
          `SELECT payload->>'by' b, "rerunRequested" r FROM "Job" WHERE id = 'job_B_purge'`,
        )
      ).rows[0];
      const rowA = (await owner(`SELECT payload->>'by' b FROM "Job" WHERE id = 'job_A_rebuild'`))
        .rows[0];
      v = {
        orgA_call_returned_orgB_job: intoB === "job_B_purge",
        orgB_job_payload_by: rowB.b,
        orgB_call_returned_orgA_job: intoA === "job_A_rebuild",
        orgA_job_payload_by: rowA.b ?? null,
        orgB_once_key_blocked_by_orgA_DONE: once === null,
      };
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      v = { error: `${e.code} ${e.message}` };
    } finally {
      await owner(
        `DELETE FROM "Job" WHERE "dedupeKey" IN ('org-purge:org_B','site-rebuild:shared','digest:2026-09-21')`,
      );
    }
    const want = {
      orgA_call_returned_orgB_job: false,
      orgB_job_payload_by: "owner B",
      orgB_call_returned_orgA_job: false,
      orgA_job_payload_by: null,
      orgB_once_key_blocked_by_orgA_DONE: false,
    };
    record(
      JSON.stringify(v) === JSON.stringify(want),
      "A-B1",
      "B1",
      "app_user",
      "org A and org B members cannot merge into, overwrite, learn or block each other's outbox jobs (committed)",
      JSON.stringify(v),
    );
  }

  // ======================= B2: Transaction separation of duties =======================
  await acase(
    "A-B2",
    "B2",
    "a TREASURER cannot approve, reimburse or pre-approve their own expense by naming someone else",
    "app_user",
    A("u_treasA"),
    async (q) => {
      const s = {};
      s.approve_own_as_third_party = await tryq(
        q,
        `UPDATE "Transaction" SET "status"='APPROVED', "approvedById"='u_ownerA' WHERE "id"='tx_A_treas'`,
      );
      s.rewrite_submitter_then_self_approve = await tryq(
        q,
        `UPDATE "Transaction" SET "submittedById"='u_memberA' WHERE "id"='tx_A_treas';
       UPDATE "Transaction" SET "status"='APPROVED', "approvedById"='u_treasA' WHERE "id"='tx_A_treas'`,
      );
      s.insert_preapproved_own_expense = await tryq(
        q,
        `INSERT INTO "Transaction" ("id","organizationId","budgetPeriodId","categoryId","direction","kind","amountCents","description",
         "occurredAt","status","submittedById","approvedById","updatedAt")
       VALUES ('tx_forged','org_A','bp_A','bc_A','OUT','EXPENSE',99900,'forged',now(),'APPROVED','u_treasA','u_ownerA',now())`,
      );
      s.change_kind_of_members_expense = await tryq(
        q,
        `UPDATE "Transaction" SET "kind"='ADJUSTMENT' WHERE "id"='tx_A_sub'`,
      );
      // The OWNER legitimately approves the treasurer's expense; the treasurer
      // then tries to mark their own expense reimbursed.
      await setCtx(q, A("u_ownerA"));
      await q(
        `UPDATE "Transaction" SET "status"='APPROVED', "approvedById"='u_ownerA' WHERE "id"='tx_A_treas'`,
      );
      await setCtx(q, A("u_treasA"));
      s.self_reimburse = await tryq(
        q,
        `UPDATE "Transaction" SET "status"='REIMBURSED', "reimbursedAt"=now() WHERE "id"='tx_A_treas'`,
      );
      return s;
    },
    { check: (s) => Object.values(s).every((v) => v === "42501") },
  );

  // ======================= B3: forced membership =======================
  await acase(
    "A-B3",
    "B3",
    "an ADMIN cannot enrol an arbitrary user (and so cannot expose their email)",
    "app_user",
    A("u_adminA"),
    async (q) => {
      const insert = await tryq(
        q,
        `INSERT INTO "Membership" ("id","userId","organizationId","role") VALUES ('m_forced','u_memberB','org_A','MEMBER')`,
      );
      const email = (await q(`SELECT "email" FROM "User" WHERE "id" = 'u_memberB'`)).rows.map(
        (r) => r.email,
      );
      return { insert, email_visible: email.length > 0 };
    },
    { value: { insert: "42501", email_visible: false } },
  );

  // ======================= N1: search_path and pg_temp =======================
  await acase(
    "A-N1a",
    "N1",
    "every SECURITY DEFINER function pins search_path = pg_catalog, public, pg_temp",
    "owner",
    null,
    async (q) =>
      (
        await q(`SELECT n.nspname || '.' || p.proname AS f FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema')
                 AND NOT coalesce(p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp'], false) ORDER BY 1`)
      ).rows.map((r) => r.f),
    { value: [] },
  );
  await acase(
    "A-N1b",
    "N1",
    "no runtime role can create temporary objects (TEMPORARY revoked from PUBLIC)",
    "owner",
    null,
    async (q) =>
      (
        await q(`SELECT r FROM unnest(ARRAY['app_user','app_service','app_auth']) r
               WHERE has_database_privilege(r, current_database(), 'TEMPORARY') ORDER BY 1`)
      ).rows.map((x) => x.r),
    { value: [] },
  );
  {
    const c = await connect("app_user"); // fresh session: no cached plans
    try {
      await acase(
        "A-N1c",
        "N1",
        "app_user cannot shadow a type used inside a definer body with a temp object",
        "app_user",
        A("u_memberA"),
        async (q) => {
          const create_temp = await tryq(q, `CREATE TEMP TABLE "JobStatus" (x int)`);
          const enqueue_after =
            create_temp === "42501"
              ? "not reached"
              : await tryv(
                  q,
                  `SELECT app.enqueue_job('org_A','notify-email','notify-email:notif_memberA','{}')`,
                );
          return { create_temp, enqueue_after };
        },
        { value: { create_temp: "42501", enqueue_after: "not reached" } },
        c,
      );
    } finally {
      await c.end();
    }
  }

  // ======================= N2: enqueue_job caller checks =======================
  await acase(
    "A-N2a",
    "N2",
    "app_auth may enqueue platform jobs only; 0C left no legacy branch to abuse",
    "app_auth",
    null,
    async (q) => ({
      // The removed app_legacy branch accepted notify-email, invite-email
      // and reimbursement-email for any row of the org it named. No login
      // role but app_user and app_service may name an org at all now.
      foreign_org_purge: await tryv(
        q,
        `SELECT app.enqueue_job('org_B','org-purge','org-purge:org_B','{}')`,
      ),
      notify_email_for_org: await tryv(
        q,
        `SELECT app.enqueue_job('org_A','notify-email','notify-email:notif_memberA','{}')`,
      ),
      platform_job_ok:
        typeof (await tryv(
          q,
          `SELECT app.enqueue_job(NULL,'verify-email','verify-email:u_memberA','{}')`,
        )) === "string",
    }),
    {
      check: (v) =>
        v.foreign_org_purge === "error:42501" &&
        v.notify_email_for_org === "error:42501" &&
        v.platform_job_ok === true,
    },
  );
  {
    // Roles are cluster-global: a per-run name keeps concurrent runs apart.
    const other = `zz_other_${process.pid}_${Date.now().toString(36)}`;
    await owner(`CREATE ROLE ${other} LOGIN PASSWORD 'test' NOSUPERUSER NOBYPASSRLS`);
    let c;
    try {
      await owner(`GRANT USAGE ON SCHEMA app TO ${other}`);
      await owner(
        `GRANT EXECUTE ON FUNCTION app.enqueue_job(text, text, text, jsonb, timestamp, integer, boolean) TO ${other}`,
      );
      c = await connectAs(other, "test");
      await acase(
        "A-N2b",
        "N2",
        "a login role outside the reviewed list falls into ELSE and is refused",
        other,
        null,
        (q) => q(`SELECT app.enqueue_job('org_A','notify-email','notify-email:x','{}')`),
        { error: "42501" },
        c,
      );
    } finally {
      if (c) await c.end();
      await owner(
        `REVOKE EXECUTE ON FUNCTION app.enqueue_job(text, text, text, jsonb, timestamp, integer, boolean) FROM ${other}`,
      ).catch(() => {});
      await owner(`REVOKE USAGE ON SCHEMA app FROM ${other}`).catch(() => {});
      await owner(`DROP ROLE IF EXISTS ${other}`);
    }
  }

  // ======================= N3: owner-run helpers answer cross-org questions =======================
  const refused = (v) => v === "error:42501" || v === "error:42883";
  await acase(
    "A-N3",
    "N3",
    "owner-run helpers refuse orgs other than the caller's (or no longer exist)",
    "app_user",
    A("u_memberA"),
    async (q) => ({
      user_has_role: await tryv(q, `SELECT app.user_has_role('u_ownerB','org_B','OWNER')`),
      org_has_members: await tryv(q, `SELECT app.org_has_members('org_B')`),
      org_has_other_owner: await tryv(q, `SELECT app.org_has_other_owner('org_B','nobody')`),
      lock_org: await tryv(q, `SELECT app.lock_org('org_B')::text`),
      user_in_org: await tryv(q, `SELECT app.user_in_org('u_memberB','org_B')`),
      user_visible: await tryv(q, `SELECT app.user_visible('u_memberB','org_B')`),
    }),
    { check: (v) => Object.values(v).every(refused) },
  );
  await acase(
    "A-N3b",
    "N3",
    "the same helpers on the service path refuse another org than app.org_id",
    "app_service",
    { org: "org_A" },
    async (q) => ({
      user_has_role: await tryv(q, `SELECT app.user_has_role('u_ownerB','org_B','OWNER')`),
      org_has_other_owner: await tryv(q, `SELECT app.org_has_other_owner('org_B','nobody')`),
      lock_org: await tryv(q, `SELECT app.lock_org('org_B')::text`),
    }),
    { check: (v) => Object.values(v).every(refused) },
  );

  // ======================= N4: existence leaks through errors =======================
  await acase(
    "A-N4",
    "N4",
    "a foreign parent and a missing parent get the same error; secret writes cannot probe",
    "app_user",
    A("u_treasA"),
    async (q) => {
      const txForeign = await trye(
        q,
        `UPDATE "Transaction" SET "eventId" = 'e_B' WHERE "id" = 'tx_A_draft'`,
      );
      const txMissing = await trye(
        q,
        `UPDATE "Transaction" SET "eventId" = 'e_nope' WHERE "id" = 'tx_A_draft'`,
      );
      await setCtx(q, A("u_memberA"));
      const taForeign = await trye(
        q,
        `INSERT INTO "TaskAssignee" ("organizationId","taskId","userId") VALUES ('org_A','t_B','u_memberA')`,
      );
      const taMissing = await trye(
        q,
        `INSERT INTO "TaskAssignee" ("organizationId","taskId","userId") VALUES ('org_A','t_nope','u_memberA')`,
      );
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      return {
        transaction_ref: same(txForeign, txMissing)
          ? "identical"
          : { foreign: txForeign, missing: txMissing },
        assignee_ref: same(taForeign, taMissing)
          ? "identical"
          : { foreign: taForeign, missing: taMissing },
      };
    },
    { value: { transaction_ref: "identical", assignee_ref: "identical" } },
  );
  await acase(
    "A-N4b",
    "N4",
    "secret_write gives the same outcome for another org's integration id and a nonexistent one",
    "app_service",
    { org: "org_A" },
    async (q) => {
      const w = (i) =>
        trye(
          q,
          `SELECT app.secret_write('org_A','${i}','API_KEY','\\x01','\\x02','\\x03','\\x04','\\x05','\\x06',1)`,
        );
      const foreign = await w("int_B_claude");
      const missing = await w("int_nope");
      return JSON.stringify(foreign) === JSON.stringify(missing)
        ? "identical"
        : { foreign, missing };
    },
    { value: "identical" },
  );

  // ======================= N5: within-org integrity =======================
  await acase(
    "A-N5",
    "N5",
    "authorship cannot be rewritten and audit rows cannot be forged",
    "app_user",
    A("u_memberA"),
    async (q) => {
      const s = {};
      s.member_reassigns_note_author = await tryq(
        q,
        `UPDATE "Note" SET "authorId" = 'u_memberA' WHERE "id" = 'n_A_org'`,
      );
      s.member_hides_org_note = await tryq(
        q,
        `UPDATE "Note" SET "authorId" = 'u_memberA', "visibility" = 'PRIVATE' WHERE "id" = 'n_A_org'`,
      );
      s.creator_reassigns_event = await tryq(
        q,
        `UPDATE "Event" SET "createdById" = 'u_adminA' WHERE "id" = 'e_A'`,
      );
      s.reassign_task_creator = await tryq(
        q,
        `UPDATE "Task" SET "createdById" = 'u_ownerA' WHERE "id" = 't_A'`,
      );
      s.create_task_as_someone_else = await tryq(
        q,
        `INSERT INTO "Task" ("id","organizationId","title","rank","createdById","updatedAt") VALUES ('t_forged','org_A','x','a9','u_ownerA',now())`,
      );
      s.forge_backdated_org_audit = await tryq(
        q,
        `INSERT INTO "OrgAuditLog" ("organizationId","actorId","action","createdAt") VALUES ('org_A','u_memberA','member.role.change','2020-01-01')`,
      );
      s.forge_backdated_finance_audit = await tryq(
        q,
        `INSERT INTO "FinanceAuditLog" ("id","organizationId","actorId","transactionId","action","diffJson","createdAt")
       VALUES ('fal_forged','org_A','u_memberA','tx_A_sub','APPROVE','{}','2020-01-01')`,
      );
      await setCtx(q, A("u_adminA"));
      s.admin_reassigns_note_author = await tryq(
        q,
        `UPDATE "Note" SET "authorId" = 'u_adminA' WHERE "id" = 'n_A_org'`,
      );
      return s;
    },
    {
      check: (s) =>
        s.member_reassigns_note_author === 0 &&
        s.member_hides_org_note === 0 &&
        [
          "creator_reassigns_event",
          "reassign_task_creator",
          "create_task_as_someone_else",
          "forge_backdated_org_audit",
          "forge_backdated_finance_audit",
          "admin_reassigns_note_author",
        ].every((k) => s[k] === "42501"),
    },
  );

  // ======================= N6: rate limiter namespace =======================
  await acase(
    "A-N6a",
    "N6",
    "request code cannot burn another principal's sign-in bucket",
    "app_user",
    A("u_memberA"),
    (q) => q(`SELECT * FROM app.rate_limit_hit('signin:owner.b@example.edu', 1, 900)`),
    { error: "42501" },
  );

  // ======================= N7: catalog blind spots =======================
  await acase(
    "A-N7",
    "N7",
    "future-migration mistakes the v2 T27 queries miss are caught by app.security_manifest()",
    "owner",
    null,
    async (q) => {
      await q(`CREATE VIEW public.zz_view AS SELECT "id" FROM "Task"`);
      await q(`GRANT SELECT ON public.zz_view TO app_user`);
      await q(`CREATE TABLE public.zz_part (id int) PARTITION BY RANGE (id)`);
      await q(`GRANT SELECT ON public.zz_part TO app_user`);
      await q(`CREATE MATERIALIZED VIEW public.zz_mat AS SELECT 1 AS x`);
      await q(`GRANT SELECT ON public.zz_mat TO app_service`);
      await q(`GRANT TRUNCATE ON "Task" TO app_user`);
      await q(`GRANT TRIGGER ON "Event" TO app_service`);
      await q(`GRANT REFERENCES ("id") ON "Note" TO app_auth`);
      await q(`CREATE FUNCTION public.zz_pub() RETURNS int LANGUAGE sql AS 'SELECT 1'`);
      await q(`GRANT EXECUTE ON FUNCTION public.zz_pub() TO PUBLIC`);
      await q(
        `CREATE FUNCTION app.zz_def() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = public AS 'SELECT 1'`,
      );
      await q(`CREATE SCHEMA zz_s`);
      await q(`CREATE TABLE zz_s.t (id int)`);
      await q(`GRANT USAGE ON SCHEMA zz_s TO app_user`);
      await q(`GRANT SELECT ON zz_s.t TO app_user`);
      // The v2 catalog tests, verbatim in substance: T27a (relkind r in
      // public), T27b (per-command coverage, relkind r in public), T27f
      // (PUBLIC EXECUTE in schema app).
      const planted = ["zz_view", "zz_part", "zz_mat", "t", "zz_pub", "zz_def"];
      const v2a = (
        await q(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                           WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity AND c.relname <> '_prisma_migrations'`)
      ).rows.map((r) => r.relname);
      const v2b = (
        await q(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                           WHERE n.nspname='public' AND c.relkind='r' AND c.relname <> '_prisma_migrations'
                             AND has_any_column_privilege('app_user', c.oid, 'SELECT')
                             AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname)`)
      ).rows.map((r) => r.relname);
      const v2f = (
        await q(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                           WHERE n.nspname='app' AND has_function_privilege('public', p.oid, 'EXECUTE')`)
      ).rows.map((r) => r.proname);
      const v2_style_found = [...v2a, ...v2b, ...v2f].filter((x) => planted.includes(x)).length;
      const m = await q("SAVEPOINT m")
        .then(() => q(`SELECT DISTINCT check_name FROM app.security_manifest() ORDER BY 1`))
        .then(
          (r) => r.rows.map((x) => x.check_name),
          async (e) => {
            await q("ROLLBACK TO SAVEPOINT m");
            return `error:${e.code}`;
          },
        );
      return { v2_style_T27_found: v2_style_found, manifest_classes: m };
    },
    {
      check: (v) =>
        v.v2_style_T27_found === 0 &&
        Array.isArray(v.manifest_classes) &&
        [
          "dangerous_privilege",
          "definer_search_path",
          "matview_or_foreign_granted",
          "policy_gap",
          "public_execute",
          "rls_disabled",
          "view_not_invoker",
        ].every((k) => v.manifest_classes.includes(k)),
    },
  );
  await acase(
    "A-N7b",
    "N7",
    "the real schema has no violations across all non-system schemas",
    "owner",
    null,
    async (q) =>
      (
        await q(`SELECT check_name || ' ' || object_name v FROM app.security_manifest() ORDER BY 1`)
      ).rows.map((r) => r.v),
    { value: [] },
  );

  // ======================= N8: GUC reuse across pooled transactions =======================
  {
    const c = await connect("app_user");
    try {
      const n = async () => Number((await c.query(`SELECT count(*) n FROM "Task"`)).rows[0].n);
      // Control: a transaction-local context is gone after COMMIT.
      await c.query("BEGIN");
      await c.query(
        `SELECT set_config('app.user_id','u_memberA',true), set_config('app.org_id','org_A',true), set_config('app.ctx_tx', ${STAMP}, true)`,
      );
      await c.query("COMMIT");
      const after_commit_local = await n();
      // The bug the lint bans: a wrapper that sets the context session-level.
      await c.query("BEGIN");
      await c.query(
        `SELECT set_config('app.user_id','u_memberA',false), set_config('app.org_id','org_A',false), set_config('app.ctx_tx', ${STAMP}, false)`,
      );
      await c.query("COMMIT");
      const next_request_after_set_config_false = await n();
      await c.query("RESET ALL");
      // The same bug through SET (no LOCAL).
      await c.query(`SET app.user_id = 'u_memberA'`);
      await c.query(`SET app.org_id = 'org_A'`);
      const next_request_after_SET = await n();
      const v = { after_commit_local, next_request_after_set_config_false, next_request_after_SET };
      record(
        Object.values(v).every((x) => x === 0),
        "A-N8",
        "N8",
        "app_user",
        "a leaked session-level context never reaches the next transaction on the same pooled connection",
        JSON.stringify(v),
      );
    } catch (e) {
      record(
        false,
        "A-N8",
        "N8",
        "app_user",
        "a leaked session-level context never reaches the next transaction",
        `${e.code} ${e.message}`,
      );
    } finally {
      await c.end();
    }
  }
});
