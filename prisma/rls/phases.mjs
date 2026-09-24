// RLS and catalog suite for everything added after 0B (Phases 1-9): every
// new table gets tenant isolation, fail-closed service, per-command write
// rules and its triggers exercised, and the catalog tests pin the reviewed
// grant matrix for EVERY table, so a table added later without a review
// fails here. Run through `pnpm test:rls` after tests.mjs and attacks.mjs.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { A, B, count, HASH, rc, runSuite, tryq, tryv } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

// The reviewed table-privilege matrix. S=SELECT I=INSERT U=UPDATE (u = a
// column-level UPDATE grant only) D=DELETE; roles in the order app_user,
// app_service, app_auth. A new table, or a changed grant, fails
// P-CAT1 until this matrix is updated in review.
const GRANTS = {
  Account: ["", "", "SIUD"],
  Attendance: ["SIUD", "SIUD", ""],
  AvailabilityPoll: ["SIUD", "SIUD", ""],
  Ballot: ["SIUD", "SIUD", ""],
  BallotChoice: ["S", "SIUD", ""],
  BallotDefinition: ["SIUD", "SIUD", ""],
  BudgetCategory: ["SIUD", "SIUD", ""],
  BudgetPeriod: ["SIUD", "SIUD", ""],
  Contact: ["SIUD", "SIUD", ""],
  ContactEmail: ["SIUD", "SIUD", ""],
  ContactTermStats: ["S", "SIUD", ""],
  DataSourceSyncState: ["S", "SIUD", ""],
  DatabaseDefinition: ["SIU", "SIUD", ""],
  Event: ["SIUD", "SIUD", ""],
  EventAttendee: ["SIUD", "SIUD", ""],
  EventLinkLog: ["SI", "SI", ""],
  FinanceAuditLog: ["S", "S", ""],
  Invitation: ["SIUD", "SIUD", ""],
  Job: ["S", "S", ""],
  Label: ["SIUD", "SIUD", ""],
  Membership: ["SUD", "SIUD", ""],
  Note: ["SIUD", "SIUD", ""],
  Notification: ["SIu", "SIUD", ""],
  OrgAuditLog: ["S", "S", ""],
  // DELETE only on DRAFT positions (b3_org_chart_draft_delete; P-CAT5, P3-05).
  OrgChartPosition: ["SIUD", "SIUD", ""],
  OrgChartVersion: ["SIU", "SIUD", ""],
  OrgCreationCode: ["", "", ""],
  OrgDeletionLog: ["", "", ""],
  OrgExport: ["SI", "SIUD", ""],
  OrgIntegration: ["SIUD", "SIUD", ""],
  OrgMemberHistory: ["S", "S", ""],
  OrgSecret: ["", "", ""],
  OrgSettings: ["SU", "SIUD", ""],
  OrgSlugHistory: ["", "", ""],
  OrgTheme: ["SIUD", "SIUD", ""],
  Organization: ["SU", "SIUD", ""],
  PollResponse: ["SIUD", "SIUD", ""],
  PollSlot: ["SIUD", "SIUD", ""],
  Project: ["SIUD", "SIUD", ""],
  RateLimitBucket: ["", "", ""],
  Receipt: ["SID", "SID", ""],
  Session: ["", "", "SIUD"],
  Signup: ["SIUD", "SIUD", ""],
  Sponsor: ["SIUD", "SIUD", ""],
  Sponsorship: ["SIUD", "SIUD", ""],
  Task: ["SIUD", "SIUD", ""],
  TaskActivity: ["SI", "SI", ""],
  TaskAssignee: ["SIUD", "SIUD", ""],
  TaskComment: ["SIUD", "SIUD", ""],
  TaskLabel: ["SIUD", "SIUD", ""],
  TaskMention: ["SIUD", "SIUD", ""],
  Transaction: ["SIU", "SIU", ""],
  User: ["Su", "S", "SIUD"],
  UserCredential: ["", "", "SIUD"],
  VerificationToken: ["", "", "SIUD"],
  WeeklyUpdate: ["SIUD", "SIUD", ""],
  _prisma_migrations: ["", "", ""],
};

// Tables with no organizationId, each for a reason (Phase 9 org-id coverage).
const NO_ORG_ID = [
  "Account",
  "OrgCreationCode",
  "Organization",
  "RateLimitBucket",
  "Session",
  "User",
  "UserCredential",
  "VerificationToken",
  "_prisma_migrations",
];

// Tables added after 0B: tenant isolation and fail-closed service checks.
const NEW_TENANT_TABLES = [
  "OrgSettings",
  "OrgIntegration",
  "OrgExport",
  "OrgChartVersion",
  "OrgChartPosition",
  "DatabaseDefinition",
  "EventLinkLog",
  "Contact",
  "ContactEmail",
  "Attendance",
  "ContactTermStats",
  "Signup",
  "BallotDefinition",
  "Ballot",
  "BallotChoice",
  "DataSourceSyncState",
  "TaskComment",
  "TaskMention",
  "TaskActivity",
  "WeeklyUpdate",
  "OrgTheme",
  "EventAttendee",
  "PollSlot",
  "PollResponse",
  "TaskAssignee",
  "TaskLabel",
  "Receipt",
];

runSuite("rls-phases", async ({ tcase, clients }) => {
  // ======================= Catalog =======================
  await tcase(
    "P-CAT1",
    "table privileges of every runtime role match the reviewed matrix (every table)",
    "owner",
    null,
    async (q) => {
      const rows = (
        await q(`
      SELECT c.relname,
        (SELECT array_agg(
           (CASE WHEN has_any_column_privilege(r, c.oid, 'SELECT') THEN 'S' ELSE '' END) ||
           (CASE WHEN has_any_column_privilege(r, c.oid, 'INSERT') THEN 'I' ELSE '' END) ||
           (CASE WHEN has_table_privilege(r, c.oid, 'UPDATE') THEN 'U'
                 WHEN has_any_column_privilege(r, c.oid, 'UPDATE') THEN 'u' ELSE '' END) ||
           (CASE WHEN has_table_privilege(r, c.oid, 'DELETE') THEN 'D' ELSE '' END) ORDER BY o)
           FROM unnest(ARRAY['app_user','app_service','app_auth']) WITH ORDINALITY AS x(r, o)) AS g
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p') ORDER BY 1`)
      ).rows;
      const diffs = [];
      for (const r of rows) {
        if (!(r.relname in GRANTS))
          diffs.push(`${r.relname}: not in the reviewed matrix (${r.g.join("/")})`);
        else if (JSON.stringify(GRANTS[r.relname]) !== JSON.stringify(r.g)) {
          diffs.push(`${r.relname}: ${r.g.join("/")} != ${GRANTS[r.relname].join("/")}`);
        }
      }
      for (const t of Object.keys(GRANTS))
        if (!rows.some((r) => r.relname === t)) diffs.push(`${t}: missing`);
      return diffs;
    },
    { value: [] },
  );

  await tcase(
    "P-CAT2",
    "org-id coverage: every table has organizationId or is on the allowlist",
    "owner",
    null,
    async (q) =>
      (
        await q(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
                 AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'organizationId' AND NOT a.attisdropped)
               ORDER BY 1`)
      ).rows.map((r) => r.relname),
    { value: NO_ORG_ID },
  );

  await tcase(
    "P-CAT3",
    "every app_service policy is fail-closed on app.org_id()",
    "owner",
    null,
    async (q) =>
      (
        await q(`SELECT tablename || ':' || policyname AS p FROM pg_policies
               WHERE schemaname = 'public' AND 'app_service' = ANY (roles)
                 AND NOT (coalesce(qual, '') || coalesce(with_check, '') LIKE '%app.org_id()%IS NOT NULL%')
               ORDER BY 1`)
      ).rows.map((r) => r.p),
    { value: [] },
  );

  await tcase(
    "P-CAT4",
    "app_user UPDATE on User is limited to the profile columns (never email or emailVerified)",
    "owner",
    null,
    async (q) =>
      (
        await q(`SELECT column_name FROM information_schema.column_privileges
               WHERE table_schema = 'public' AND table_name = 'User' AND grantee = 'app_user' AND privilege_type = 'UPDATE'
               ORDER BY 1`)
      ).rows.map((r) => r.column_name),
    {
      value: [
        "avatar",
        "bio",
        "emailPreferences",
        "gradYear",
        "image",
        "links",
        "major",
        "name",
        "pronouns",
        "timezone",
      ],
    },
  );

  await tcase(
    "P-CAT5",
    "history tables: no app_user DELETE on org-chart versions, position DELETE only in DRAFT versions, no UPDATE/DELETE on TaskActivity",
    "owner",
    null,
    async (q) =>
      (
        await q(`SELECT tablename || ':' || cmd AS p FROM pg_policies
               WHERE schemaname = 'public' AND 'app_user' = ANY (roles)
                 AND ((tablename = 'OrgChartVersion' AND cmd = 'DELETE')
                   OR (tablename = 'OrgChartPosition' AND cmd = 'DELETE'
                       AND (qual IS NULL OR qual NOT LIKE '%''DRAFT''%' OR qual NOT LIKE '%is_org_admin%'))
                   OR (tablename = 'TaskActivity' AND cmd IN ('UPDATE','DELETE')))`)
      ).rows.map((r) => r.p),
    { value: [] },
  );

  await tcase(
    "P-CAT6",
    "app.reserved_slugs() equals RESERVED_SLUGS in src/lib/slug.ts",
    "owner",
    null,
    async (q) => {
      const src = readFileSync(path.join(here, "..", "..", "src", "lib", "slug.ts"), "utf8");
      const block = src.match(/RESERVED_SLUGS[^=]*=\s*\[([^\]]*)\]/);
      const ts = block ? [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort() : null;
      const sql = (await q(`SELECT array(SELECT unnest(app.reserved_slugs()) ORDER BY 1) s`))
        .rows[0].s;
      return { equal: JSON.stringify(ts) === JSON.stringify(sql), ts, sql };
    },
    { check: (v) => v.equal },
  );

  await tcase(
    "P-CAT7",
    "Phase 1-9 enum values and indexes exist",
    "owner",
    null,
    async (q) => ({
      notification_types: (
        await q(`SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) v FROM pg_enum e
                                   JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'NotificationType'`)
      ).rows[0].v,
      task_status: (
        await q(`SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) v FROM pg_enum e
                           JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'TaskStatus'`)
      ).rows[0].v,
      indexes: (
        await q(`SELECT array_agg(indexname::text ORDER BY indexname) v FROM pg_indexes WHERE schemaname = 'public' AND indexname IN
      ('Transaction_categoryId_idx','FinanceAuditLog_transactionId_idx','BudgetCategory_budgetPeriodId_idx',
       'Note_organizationId_deletedAt_updatedAt_idx','Job_organizationId_dedupeKey_active_key')`)
      ).rows[0].v,
    }),
    {
      value: {
        notification_types: [
          "TASK_ASSIGNED",
          "TASK_DUE_SOON",
          "EVENT_INVITE",
          "INVITE_ACCEPTED",
          "INTEGRATION_ERROR",
          "SECURITY_ALERT",
          "TASK_MENTIONED",
          "TASK_COMMENTED",
          "TASK_DUE_REMINDER",
          "TASK_DIGEST",
          "TASK_FLAGGED",
          "WEEKLY_UPDATE_REMINDER",
          "EVENT_UPDATED",
          "EVENT_CANCELLED",
        ],
        task_status: ["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "COMPLETED"],
        indexes: [
          "BudgetCategory_budgetPeriodId_idx",
          "FinanceAuditLog_transactionId_idx",
          "Job_organizationId_dedupeKey_active_key",
          "Note_organizationId_deletedAt_updatedAt_idx",
          "Transaction_categoryId_idx",
        ],
      },
    },
  );

  // ======================= Isolation on every new table =======================
  await tcase(
    "P-ISO1",
    "app_service without app.org_id sees nothing on any new table",
    "app_service",
    null,
    async (q) => {
      const out = {};
      for (const t of NEW_TENANT_TABLES) out[t] = await count(q, `SELECT count(*) n FROM "${t}"`);
      return out;
    },
    { check: (v) => Object.values(v).every((n) => n === 0) },
  );
  await tcase(
    "P-ISO2",
    "app_service with app.org_id=A sees no org B row on any new table",
    "app_service",
    { org: "org_A" },
    async (q) => {
      const out = {};
      for (const t of NEW_TENANT_TABLES)
        out[t] = await count(q, `SELECT count(*) n FROM "${t}" WHERE "organizationId" <> 'org_A'`);
      return out;
    },
    { check: (v) => Object.values(v).every((n) => n === 0) },
  );
  await tcase(
    "P-ISO3",
    "an OWNER of org A sees no org B row on any new table",
    "app_user",
    A("u_ownerA"),
    async (q) => {
      const out = {};
      for (const t of NEW_TENANT_TABLES)
        out[t] = await count(q, `SELECT count(*) n FROM "${t}" WHERE "organizationId" <> 'org_A'`);
      return out;
    },
    { check: (v) => Object.values(v).every((n) => n === 0) },
  );
  await tcase(
    "P-ISO4",
    "a spoofed org GUC (non-member) sees nothing on any new table",
    "app_user",
    { user: "u_memberB", org: "org_A" },
    async (q) => {
      const out = {};
      for (const t of NEW_TENANT_TABLES) out[t] = await count(q, `SELECT count(*) n FROM "${t}"`);
      return out;
    },
    { check: (v) => Object.values(v).every((n) => n === 0) },
  );
  await tcase(
    "P-ISO5",
    "an OWNER cannot insert rows into another org on any admin-writable new table",
    "app_user",
    A("u_ownerA"),
    async (q) => ({
      OrgIntegration: await tryq(
        q,
        `INSERT INTO "OrgIntegration" ("id","organizationId","provider","updatedAt") VALUES ('x','org_B','NETLIFY_BUILD_HOOK',now())`,
      ),
      OrgChartVersion: await tryq(
        q,
        `INSERT INTO "OrgChartVersion" ("id","organizationId","number","source","createdById","updatedAt") VALUES ('x','org_B',9,'MANUAL','u_ownerA',now())`,
      ),
      DatabaseDefinition: await tryq(
        q,
        `INSERT INTO "DatabaseDefinition" ("id","organizationId","key","name","kind","updatedAt") VALUES ('x','org_B','k','K','CUSTOM',now())`,
      ),
      Contact: await tryq(
        q,
        `INSERT INTO "Contact" ("id","organizationId","updatedAt") VALUES ('x','org_B',now())`,
      ),
      OrgTheme: await tryq(
        q,
        `INSERT INTO "OrgTheme" ("organizationId","light","updatedAt") VALUES ('org_B','{}',now())`,
      ),
      WeeklyUpdate: await tryq(
        q,
        `INSERT INTO "WeeklyUpdate" ("id","organizationId","userId","weekStart","updatedAt") VALUES ('x','org_B','u_ownerA','2026-09-21',now())`,
      ),
    }),
    { check: (v) => Object.values(v).every((c) => c === "42501") },
  );

  // ======================= Phase 1: settings and integrations =======================
  await tcase(
    "P1-01",
    "OrgSettings: members read, only OWNER/ADMIN update, nobody inserts or deletes",
    "app_user",
    A("u_memberA"),
    async (q) => {
      const s = {};
      s.member_reads = await count(q, `SELECT count(*) n FROM "OrgSettings"`);
      s.member_update = await rc(q, `UPDATE "OrgSettings" SET "publicEventsEnabled" = true`);
      s.member_insert = await tryq(
        q,
        `INSERT INTO "OrgSettings" ("organizationId","updatedAt") VALUES ('org_A',now())`,
      );
      s.member_delete = await tryq(q, `DELETE FROM "OrgSettings"`);
      await q(`SELECT app.set_context('u_adminA','org_A')`);
      s.admin_update = await rc(q, `UPDATE "OrgSettings" SET "publicEventsEnabled" = true`);
      s.admin_delete = await tryq(q, `DELETE FROM "OrgSettings"`);
      return s;
    },
    {
      value: {
        member_reads: 1,
        member_update: 0,
        member_insert: "42501",
        member_delete: "42501",
        admin_update: 1,
        admin_delete: "42501",
      },
    },
  );
  await tcase(
    "P1-02",
    "every org gets OrgSettings and the five built-in databases at creation (service path)",
    "app_service",
    { user: "u_memberB", org: "org_new" },
    async (q) => {
      await q(`INSERT INTO "Organization" ("id","name","slug") VALUES ('org_new','New','fx-new')`);
      return {
        settings: await count(q, `SELECT count(*) n FROM "OrgSettings"`),
        mail_fallback: (await q(`SELECT "platformMailFallback" f FROM "OrgSettings"`)).rows[0].f,
        databases: (
          await q(`SELECT array_agg("key" ORDER BY "sortOrder") k FROM "DatabaseDefinition"`)
        ).rows[0].k,
      };
    },
    {
      value: {
        settings: 1,
        mail_fallback: false,
        databases: ["sessions", "attendance", "signups", "ballots", "people"],
      },
    },
  );
  await tcase(
    "P1-03",
    "OrgIntegration: members see nothing; OWNER/ADMIN read and write; only the OWNER removes",
    "app_user",
    A("u_memberA"),
    async (q) => {
      const s = {};
      s.member_sees = await count(q, `SELECT count(*) n FROM "OrgIntegration"`);
      s.member_insert = await tryq(
        q,
        `INSERT INTO "OrgIntegration" ("id","organizationId","provider","updatedAt") VALUES ('i_m','org_A','NETLIFY_BUILD_HOOK',now())`,
      );
      await q(`SELECT app.set_context('u_adminA','org_A')`);
      s.admin_sees = await count(q, `SELECT count(*) n FROM "OrgIntegration"`);
      s.admin_insert = await tryq(
        q,
        `INSERT INTO "OrgIntegration" ("id","organizationId","provider","updatedAt") VALUES ('i_a','org_A','NETLIFY_BUILD_HOOK',now())`,
      );
      s.admin_delete = await rc(q, `DELETE FROM "OrgIntegration" WHERE "id" = 'int_A_email'`);
      await q(`SELECT app.set_context('u_ownerA','org_A')`);
      s.owner_delete = await rc(q, `DELETE FROM "OrgIntegration" WHERE "id" = 'int_A_email'`);
      return s;
    },
    {
      value: {
        member_sees: 0,
        member_insert: "42501",
        admin_sees: 3,
        admin_insert: 1,
        admin_delete: 0,
        owner_delete: 1,
      },
    },
  );
  await tcase(
    "P1-04",
    "removing an integration removes its secrets (composite FK cascade)",
    "app_user",
    A("u_ownerA"),
    async (q) => {
      await q(`DELETE FROM "OrgIntegration" WHERE "id" = 'int_A_claude'`);
      await q(`SELECT app.set_context('u_ownerA','org_A')`);
      return await count(q, `SELECT count(*) n FROM "OrgIntegration" WHERE "id" = 'int_A_claude'`);
    },
    { value: 0 },
  );
  await tcase(
    "P1-04b",
    "...and the OrgSecret row is gone with it (checked on the service path)",
    "app_service",
    { org: "org_A" },
    async (q) => {
      await q(`DELETE FROM "OrgIntegration" WHERE "id" = 'int_A_claude'`);
      return (
        await q(`SELECT count(*)::int n FROM app.secret_read('org_A','int_A_claude','API_KEY')`)
      ).rows[0].n;
    },
    { value: 0 },
  );
  await tcase(
    "P1-05",
    "OrgExport: OWNER-only reads and requests, for themselves; the job updates on the service path",
    "app_user",
    A("u_adminA"),
    async (q) => {
      const s = {};
      s.admin_sees = await count(q, `SELECT count(*) n FROM "OrgExport"`);
      s.admin_insert = await tryq(
        q,
        `INSERT INTO "OrgExport" ("id","organizationId","requestedById") VALUES ('x1','org_A','u_adminA')`,
      );
      await q(`SELECT app.set_context('u_ownerA','org_A')`);
      s.owner_sees = await count(q, `SELECT count(*) n FROM "OrgExport"`);
      s.owner_insert_self = await tryq(
        q,
        `INSERT INTO "OrgExport" ("id","organizationId","requestedById") VALUES ('x2','org_A','u_ownerA')`,
      );
      s.owner_insert_other = await tryq(
        q,
        `INSERT INTO "OrgExport" ("id","organizationId","requestedById") VALUES ('x3','org_A','u_adminA')`,
      );
      s.owner_update = await tryq(q, `UPDATE "OrgExport" SET "status" = 'EXPIRED'`);
      return s;
    },
    {
      value: {
        admin_sees: 0,
        admin_insert: "42501",
        owner_sees: 1,
        owner_insert_self: 1,
        owner_insert_other: "42501",
        owner_update: "42501",
      },
    },
  );
  await tcase(
    "P1-06",
    "OrgSlugHistory, OrgCreationCode and OrgDeletionLog are unreachable for request and service code",
    "app_service",
    { org: "org_A" },
    async (q) => ({
      slug_history: await tryq(q, `SELECT 1 FROM "OrgSlugHistory"`),
      creation_codes: await tryq(q, `SELECT 1 FROM "OrgCreationCode"`),
      deletion_log: await tryq(q, `SELECT 1 FROM "OrgDeletionLog"`),
    }),
    { value: { slug_history: "42501", creation_codes: "42501", deletion_log: "42501" } },
  );
  await tcase(
    "P1-07",
    "an OWNER rename reserves the old slug, which redirects; slug_available honours history and reserved words",
    "app_user",
    A("u_ownerA"),
    async (q) => ({
      renamed: await rc(
        q,
        `UPDATE "Organization" SET "slug" = 'fx-a-renamed' WHERE "id" = 'org_A'`,
      ),
      old_resolves: (
        await q(
          `SELECT "organizationId" o, "canonicalSlug" c, "isRetired" r FROM app.resolve_org_slug('fx-a')`,
        )
      ).rows[0],
      new_resolves: (await q(`SELECT "isRetired" r FROM app.resolve_org_slug('fx-a-renamed')`))
        .rows[0].r,
      old_available: (await q(`SELECT app.slug_available('fx-a') a`)).rows[0].a,
      reserved_available: (await q(`SELECT app.slug_available('admin') a`)).rows[0].a,
      fresh_available: (await q(`SELECT app.slug_available('fx-brand-new') a`)).rows[0].a,
      unknown_resolves: (await q(`SELECT count(*)::int n FROM app.resolve_org_slug('nope-nope')`))
        .rows[0].n,
    }),
    {
      value: {
        renamed: 1,
        old_resolves: { o: "org_A", c: "fx-a-renamed", r: true },
        new_resolves: false,
        old_available: false,
        reserved_available: false,
        fresh_available: true,
        unknown_resolves: 0,
      },
    },
  );
  await tcase(
    "P1-08",
    "a new org cannot claim a reserved word or another org's retired slug (every path)",
    "app_service",
    { user: "u_memberB", org: "org_x" },
    async (q) => {
      const s = {};
      s.reserved = await tryq(
        q,
        `INSERT INTO "Organization" ("id","name","slug") VALUES ('org_x','X','api')`,
      );
      return s;
    },
    { value: { reserved: "23505" } },
  );
  await tcase(
    "P1-08b",
    "a retired slug stays reserved after its org is renamed (service path too)",
    "app_service",
    B("u_ownerB"),
    async (q) => {
      await q(`UPDATE "Organization" SET "slug" = 'fx-b-renamed' WHERE "id" = 'org_B'`);
      // The claim is a different org, so the service context moves with it.
      await q(`SELECT app.set_context('u_ownerB','org_y')`);
      return {
        claim_old: await tryq(
          q,
          `INSERT INTO "Organization" ("id","name","slug") VALUES ('org_y','Y','fx-b')`,
        ),
      };
    },
    { value: { claim_old: "23505" } },
  );
  await tcase(
    "P1-09",
    "org-creation codes: platform issue, then single-use redemption by the creating user only",
    "app_service",
    null,
    async (q) => {
      const s = {};
      const hash = "c".repeat(64);
      s.issued =
        typeof (
          await q(
            `SELECT app.issue_org_creation_code($1,'Jackson@Example.edu','CBC',(now() AT TIME ZONE 'UTC') + interval '7 days') id`,
            [hash],
          )
        ).rows[0].id === "string";
      s.listed_email = (
        await q(`SELECT "createdByEmail" e FROM app.list_org_creation_codes(10)`)
      ).rows[0].e;
      await q(`SELECT app.set_context('u_invitee','org_new_c')`);
      s.redeem_for_other = await tryv(q, `SELECT app.redeem_org_creation_code($1,'u_memberB')`, [
        hash,
      ]);
      s.redeem = (
        await q(`SELECT app.redeem_org_creation_code($1,'u_invitee') ok`, [hash])
      ).rows[0].ok;
      s.redeem_again = (
        await q(`SELECT app.redeem_org_creation_code($1,'u_invitee') ok`, [hash])
      ).rows[0].ok;
      return s;
    },
    {
      value: {
        issued: true,
        listed_email: "jackson@example.edu",
        redeem_for_other: "error:42501",
        redeem: true,
        redeem_again: false,
      },
    },
  );
  await tcase(
    "P1-09b",
    "request code cannot issue, list or redeem org-creation codes",
    "app_user",
    A("u_ownerA"),
    async (q) => ({
      issue: await tryv(
        q,
        `SELECT app.issue_org_creation_code($1,'x@example.edu',NULL,(now() AT TIME ZONE 'UTC') + interval '1 day')`,
        ["d".repeat(64)],
      ),
      list: await tryv(q, `SELECT count(*) FROM app.list_org_creation_codes(10)`),
    }),
    { value: { issue: "error:42501", list: "error:42501" } },
  );
  await tcase(
    "P1-10",
    "org purge on the service path: log_org_deletion reserves the slug and survives the delete",
    "app_service",
    { org: "org_B" },
    async (q) => {
      const s = {};
      s.foreign = await tryv(q, `SELECT app.log_org_deletion('org_A', NULL)`);
      s.logged =
        typeof (await q(`SELECT app.log_org_deletion('org_B','u_ownerB') id`)).rows[0].id ===
        "string";
      s.deleted = await rc(q, `DELETE FROM "Organization" WHERE "id" = 'org_B'`);
      s.slug_still_taken = (await q(`SELECT app.slug_available('fx-b') a`)).rows[0].a === false;
      return s;
    },
    { value: { foreign: "error:42501", logged: true, deleted: 1, slug_still_taken: true } },
  );
  await tcase(
    "P1-B1-01",
    "OrgSettings.ballotIndividualVisibility: an ADMIN may not change it (it would grant ADMINs the votes); an OWNER may; other privacy columns stay ADMIN-editable",
    "app_user",
    A("u_adminA"),
    async (q) => {
      const s = {};
      s.admin_ballots = await tryq(
        q,
        `UPDATE "OrgSettings" SET "ballotIndividualVisibility" = 'OWNER_AND_ADMINS'`,
      );
      await q(`SELECT app.set_context('u_adminA','org_A')`);
      s.admin_other = await rc(q, `UPDATE "OrgSettings" SET "ballotMinCellSize" = 5`);
      await q(`SELECT app.set_context('u_ownerA','org_A')`);
      s.owner_ballots = await rc(
        q,
        `UPDATE "OrgSettings" SET "ballotIndividualVisibility" = 'NOBODY'`,
      );
      return s;
    },
    { value: { admin_ballots: "42501", admin_other: 1, owner_ballots: 1 } },
  );
  await tcase(
    "P1-B1-02",
    "OrgSettings.ballotIndividualVisibility on the service path needs an OWNER actor (jobs cannot change it)",
    "app_service",
    { org: "org_A" },
    async (q) => {
      const s = {};
      s.no_actor = await tryq(
        q,
        `UPDATE "OrgSettings" SET "ballotIndividualVisibility" = 'NOBODY'`,
      );
      await q(`SELECT app.set_context('u_ownerA','org_A')`);
      s.owner_actor = await rc(
        q,
        `UPDATE "OrgSettings" SET "ballotIndividualVisibility" = 'NOBODY'`,
      );
      return s;
    },
    { value: { no_actor: "42501", owner_actor: 1 } },
  );

  // ======================= Phase 2: profiles =======================
  await tcase(
    "P2-01",
    "a user edits their own profile columns, never someone else's, never email",
    "app_user",
    A("u_memberA"),
    async (q) => ({
      own: await rc(
        q,
        `UPDATE "User" SET "pronouns" = 'she/her', "bio" = 'hi', "links" = '[{"kind":"github","url":"https://github.com/x"}]', "avatar" = '{"key":"a"}', "gradYear" = 2028, "major" = 'CS' WHERE "id" = 'u_memberA'`,
      ),
      other: await rc(q, `UPDATE "User" SET "bio" = 'x' WHERE "id" = 'u_adminA'`),
      email: await tryq(
        q,
        `UPDATE "User" SET "email" = 'evil@example.edu' WHERE "id" = 'u_memberA'`,
      ),
    }),
    { value: { own: 1, other: 0, email: "42501" } },
  );
  await tcase(
    "P2-02",
    "Membership.title: OWNER/ADMIN set it, members cannot",
    "app_user",
    A("u_memberA"),
    async (q) => {
      const member = await rc(
        q,
        `UPDATE "Membership" SET "title" = 'VP' WHERE "userId" = 'u_memberA' AND "organizationId" = 'org_A'`,
      );
      await q(`SELECT app.set_context('u_adminA','org_A')`);
      const admin = await rc(
        q,
        `UPDATE "Membership" SET "title" = 'Head of Tech' WHERE "userId" = 'u_memberA' AND "organizationId" = 'org_A'`,
      );
      return { member, admin };
    },
    { value: { member: 0, admin: 1 } },
  );
  // B2: "Turn off feed" on the profile's calendar card (migration
  // b2_ics_feed_off). Request code runs it through withUserTx, i.e.
  // app.set_context(user, NULL).
  await tcase(
    "P2-03",
    "app.clear_ics_token_hash clears only the caller's own feed link",
    "app_user",
    { user: "u_adminA" },
    async (q) => {
      const s = {};
      await q(`SELECT app.set_ics_token_hash($1)`, [HASH("f")]);
      await q(`SELECT app.set_context('u_memberA', '')`);
      await q(`SELECT app.set_ics_token_hash($1)`, [HASH("e")]);
      s.member_active = (await q(`SELECT app.ics_token_created_at() t`)).rows[0].t !== null;
      s.cleared = (await q(`SELECT app.clear_ics_token_hash() c`)).rows[0].c;
      s.member_after = (await q(`SELECT app.ics_token_created_at() t`)).rows[0].t;
      s.cleared_again = (await q(`SELECT app.clear_ics_token_hash() c`)).rows[0].c;
      await q(`SELECT app.set_context('u_adminA', '')`);
      s.admin_still_active = (await q(`SELECT app.ics_token_created_at() t`)).rows[0].t !== null;
      return s;
    },
    {
      value: {
        member_active: true,
        cleared: true,
        member_after: null,
        cleared_again: false,
        admin_still_active: true,
      },
    },
  );
  await tcase(
    "P2-04",
    "app.clear_ics_token_hash without a user context is refused",
    "app_user",
    null,
    (q) => q(`SELECT app.clear_ics_token_hash()`),
    { error: "42501" },
  );
  await tcase(
    "P2-05",
    "app.clear_ics_token_hash is executable by app_user only",
    "owner",
    null,
    async () => {
      const out = {};
      for (const role of ["app_service", "app_auth"]) {
        const c = clients[role];
        await c.query("BEGIN");
        try {
          // The EXECUTE check comes before the body: no context is needed.
          out[role] = await tryv((sql, params) => c.query(sql, params), `SELECT app.clear_ics_token_hash()`);
        } finally {
          await c.query("ROLLBACK");
        }
      }
      return out;
    },
    { value: { app_service: "error:42501", app_auth: "error:42501" } },
  );
  await tcase(
    "P2-06",
    "people pages: a member sees co-members' profile columns, never a user only in another org",
    "app_user",
    A("u_memberA"),
    async (q) => ({
      co_member: await count(
        q,
        `SELECT count(*) n FROM "User" WHERE "id" = 'u_adminA' AND "links" IS NOT NULL`,
      ),
      other_org_only: await count(q, `SELECT count(*) n FROM "User" WHERE "id" = 'u_memberB'`),
      other_org_titles: await count(
        q,
        `SELECT count(*) n FROM "Membership" WHERE "organizationId" <> 'org_A' AND "userId" <> 'u_memberA'`,
      ),
    }),
    { value: { co_member: 1, other_org_only: 0, other_org_titles: 0 } },
  );

  // ======================= Phase 3: org chart =======================
  await tcase(
    "P3-01",
    "members see only the published chart; OWNER/ADMIN see drafts",
    "app_user",
    A("u_memberA"),
    async (q) => {
      const member = {
        versions: await count(q, `SELECT count(*) n FROM "OrgChartVersion"`),
        positions: await count(q, `SELECT count(*) n FROM "OrgChartPosition"`),
      };
      await q(`SELECT app.set_context('u_adminA','org_A')`);
      const admin = {
        versions: await count(q, `SELECT count(*) n FROM "OrgChartVersion"`),
        positions: await count(q, `SELECT count(*) n FROM "OrgChartPosition"`),
      };
      return { member, admin };
    },
    { value: { member: { versions: 1, positions: 2 }, admin: { versions: 2, positions: 3 } } },
  );
  await tcase(
    "P3-02",
    "a MEMBER cannot create or change a version or position; nobody deletes history",
    "app_user",
    A("u_memberA"),
    async (q) => {
      const s = {};
      s.member_update_published = await rc(
        q,
        `UPDATE "OrgChartVersion" SET "status" = 'ARCHIVED' WHERE "id" = 'ocv_A1'`,
      );
      s.member_insert = await tryq(
        q,
        `INSERT INTO "OrgChartVersion" ("id","organizationId","number","source","createdById","updatedAt") VALUES ('v_m','org_A',3,'MANUAL','u_memberA',now())`,
      );
      s.member_position_update = await rc(
        q,
        `UPDATE "OrgChartPosition" SET "title" = 'x' WHERE "id" = 'pos_A1_pres'`,
      );
      await q(`SELECT app.set_context('u_ownerA','org_A')`);
      s.owner_delete = await tryq(q, `DELETE FROM "OrgChartVersion" WHERE "id" = 'ocv_A2'`);
      s.owner_insert_as_other = await tryq(
        q,
        `INSERT INTO "OrgChartVersion" ("id","organizationId","number","source","createdById","updatedAt") VALUES ('v_o','org_A',3,'MANUAL','u_adminA',now())`,
      );
      s.owner_insert = await tryq(
        q,
        `INSERT INTO "OrgChartVersion" ("id","organizationId","number","source","createdById","updatedAt") VALUES ('v_o2','org_A',3,'MANUAL','u_ownerA',now())`,
      );
      s.creator_immutable = await tryq(
        q,
        `UPDATE "OrgChartVersion" SET "createdById" = 'u_ownerA' WHERE "id" = 'ocv_A2'`,
      );
      return s;
    },
    {
      value: {
        member_update_published: 0,
        member_insert: "42501",
        member_position_update: 0,
        owner_delete: "42501",
        owner_insert_as_other: "42501",
        owner_insert: 1,
        creator_immutable: "42501",
      },
    },
  );
  await tcase(
    "P3-03",
    "the active chart pointer and reportsTo stay inside the org",
    "app_user",
    A("u_ownerA"),
    async (q) => ({
      foreign_active: await tryq(
        q,
        `UPDATE "Organization" SET "activeOrgChartVersionId" = 'ocv_B1' WHERE "id" = 'org_A'`,
      ),
      own_active: await tryq(
        q,
        `UPDATE "Organization" SET "activeOrgChartVersionId" = 'ocv_A2' WHERE "id" = 'org_A'`,
      ),
      foreign_reports_to: await tryq(
        q,
        `UPDATE "OrgChartPosition" SET "reportsToId" = 'pos_B1_pres' WHERE "id" = 'pos_A2_pres'`,
      ),
    }),
    { value: { foreign_active: "23503", own_active: 1, foreign_reports_to: "23503" } },
  );
  await tcase(
    "P3-05",
    "OWNER/ADMIN delete positions only from a DRAFT; members delete nothing",
    "app_user",
    A("u_memberA"),
    async (q) => {
      const s = {};
      s.member_draft = await rc(q, `DELETE FROM "OrgChartPosition" WHERE "id" = 'pos_A2_pres'`);
      await q(`SELECT app.set_context('u_adminA','org_A')`);
      s.admin_published = await rc(q, `DELETE FROM "OrgChartPosition" WHERE "id" = 'pos_A1_vp'`);
      s.admin_foreign = await rc(q, `DELETE FROM "OrgChartPosition" WHERE "id" = 'pos_B1_pres'`);
      s.admin_draft = await rc(q, `DELETE FROM "OrgChartPosition" WHERE "id" = 'pos_A2_pres'`);
      await q(`UPDATE "OrgChartVersion" SET "status" = 'DISCARDED' WHERE "id" = 'ocv_A2'`);
      s.admin_discarded = await rc(q, `DELETE FROM "OrgChartPosition" WHERE "versionId" = 'ocv_A2'`);
      return s;
    },
    {
      value: { member_draft: 0, admin_published: 0, admin_foreign: 0, admin_draft: 1, admin_discarded: 0 },
    },
  );
  await tcase(
    "P3-04",
    "a MEMBER cannot publish by pointing the org at a version (Organization updates are admin-only)",
    "app_user",
    A("u_memberA"),
    (q) =>
      rc(q, `UPDATE "Organization" SET "activeOrgChartVersionId" = 'ocv_A2' WHERE "id" = 'org_A'`),
    { value: 0 },
  );

  // ======================= Phase 4a: sessions and databases =======================
  await tcase(
    "P4a-01",
    "members create and edit only their own INTERNAL events; PUBLIC is OWNER/ADMIN",
    "app_user",
    A("u_memberA"),
    async (q) => {
      const s = {};
      s.member_public_insert = await tryq(
        q,
        `INSERT INTO "Event" ("id","organizationId","title","startsAt","endsAt","createdById","visibility","updatedAt") VALUES ('ev1','org_A','x',now(),now(),'u_memberA','PUBLIC',now())`,
      );
      s.member_internal_insert = await tryq(
        q,
        `INSERT INTO "Event" ("id","organizationId","title","startsAt","endsAt","createdById","visibility","updatedAt") VALUES ('ev2','org_A','x',now(),now(),'u_memberA','INTERNAL',now())`,
      );
      s.member_publishes_own = await tryq(
        q,
        `UPDATE "Event" SET "visibility" = 'PUBLIC' WHERE "id" = 'e_A'`,
      );
      s.member_edits_public = await rc(
        q,
        `UPDATE "Event" SET "title" = 'x' WHERE "id" = 'e_A_pub'`,
      );
      s.member_deletes_public = await rc(q, `DELETE FROM "Event" WHERE "id" = 'e_A_pub'`);
      await q(`SELECT app.set_context('u_adminA','org_A')`);
      s.admin_public_insert = await tryq(
        q,
        `INSERT INTO "Event" ("id","organizationId","title","startsAt","endsAt","createdById","visibility","updatedAt") VALUES ('ev3','org_A','x',now(),now(),'u_adminA','PUBLIC',now())`,
      );
      s.admin_edits_public = await rc(q, `UPDATE "Event" SET "title" = 'y' WHERE "id" = 'e_A_pub'`);
      return s;
    },
    {
      value: {
        member_public_insert: "42501",
        member_internal_insert: 1,
        member_publishes_own: "42501",
        member_edits_public: 0,
        member_deletes_public: 0,
        admin_public_insert: 1,
        admin_edits_public: 1,
      },
    },
  );
  await tcase(
    "P4a-02",
    "Event.term defaults from the org timezone; app.term_of splits at July 1 in local time",
    "app_user",
    A("u_adminA"),
    async (q) => {
      await q(
        `INSERT INTO "Event" ("id","organizationId","title","startsAt","endsAt","createdById","updatedAt") VALUES ('ev_t','org_A','t','2026-07-01 03:00','2026-07-01 04:00','u_adminA',now())`,
      );
      return {
        default_term: (await q(`SELECT "term" FROM "Event" WHERE "id" = 'ev_t'`)).rows[0].term,
        utc_same_instant: (await q(`SELECT app.term_of('2026-07-01 03:00','UTC') t`)).rows[0].t,
        january: (await q(`SELECT app.term_of('2027-01-15 12:00','America/New_York') t`)).rows[0].t,
      };
    },
    {
      value: { default_term: "spring-2026", utc_same_instant: "fall-2026", january: "spring-2027" },
    },
  );
  await tcase(
    "P4a-03",
    "an event host must be a member of the event's org",
    "app_user",
    A("u_adminA"),
    async (q) => ({
      non_member: await tryq(
        q,
        `UPDATE "Event" SET "hostUserId" = 'u_memberB' WHERE "id" = 'e_A_pub'`,
      ),
      member: await tryq(q, `UPDATE "Event" SET "hostUserId" = 'u_memberA' WHERE "id" = 'e_A_pub'`),
      foreign_merge: await tryq(q, `UPDATE "Event" SET "mergedIntoId" = 'e_B' WHERE "id" = 'e_A2'`),
    }),
    { value: { non_member: "23514", member: 1, foreign_merge: "23503" } },
  );
  await tcase(
    "P4a-04",
    "DatabaseDefinition: members read; OWNER/ADMIN create and edit; nobody deletes (archive)",
    "app_user",
    A("u_memberA"),
    async (q) => {
      const s = {};
      s.member_reads = await count(q, `SELECT count(*) n FROM "DatabaseDefinition"`);
      s.member_update = await rc(q, `UPDATE "DatabaseDefinition" SET "name" = 'x'`);
      await q(`SELECT app.set_context('u_adminA','org_A')`);
      s.admin_update = await rc(
        q,
        `UPDATE "DatabaseDefinition" SET "memberVisibility" = 'ADMINS' WHERE "key" = 'people'`,
      );
      s.admin_insert = await tryq(
        q,
        `INSERT INTO "DatabaseDefinition" ("id","organizationId","key","name","kind","updatedAt") VALUES ('dd1','org_A','custom-1','Custom','CUSTOM',now())`,
      );
      s.admin_delete = await tryq(q, `DELETE FROM "DatabaseDefinition" WHERE "key" = 'people'`);
      return s;
    },
    {
      value: {
        member_reads: 5,
        member_update: 0,
        admin_update: 1,
        admin_insert: 1,
        admin_delete: "42501",
      },
    },
  );

  // ======================= Phase 4b: website data =======================
  const visible = async (q) => ({
    attendance: await count(q, `SELECT count(*) n FROM "Attendance"`),
    signups: await count(q, `SELECT count(*) n FROM "Signup"`),
    contacts: await count(q, `SELECT count(*) n FROM "Contact"`),
    emails: await count(q, `SELECT count(*) n FROM "ContactEmail"`),
    term_stats: await count(q, `SELECT count(*) n FROM "ContactTermStats"`),
    ballots: await count(q, `SELECT count(*) n FROM "Ballot"`),
    choices: await count(q, `SELECT count(*) n FROM "BallotChoice"`),
    definitions: await count(q, `SELECT count(*) n FROM "BallotDefinition"`),
    sync_state: await count(q, `SELECT count(*) n FROM "DataSourceSyncState"`),
    link_log: await count(q, `SELECT count(*) n FROM "EventLinkLog"`),
  });
  await tcase(
    "P4b-01",
    "default PII visibility per tier: member, treasurer, admin, owner",
    "app_user",
    A("u_memberA"),
    async (q) => {
      const member = await visible(q);
      await q(`SELECT app.set_context('u_treasA','org_A')`);
      const treasurer = await visible(q);
      await q(`SELECT app.set_context('u_adminA','org_A')`);
      const admin = await visible(q);
      await q(`SELECT app.set_context('u_ownerA','org_A')`);
      const owner = await visible(q);
      return { member, treasurer, admin, owner };
    },
    {
      value: {
        member: {
          attendance: 3,
          signups: 0,
          contacts: 2,
          emails: 0,
          term_stats: 2,
          ballots: 0,
          choices: 0,
          definitions: 1,
          sync_state: 0,
          link_log: 0,
        },
        treasurer: {
          attendance: 3,
          signups: 0,
          contacts: 2,
          emails: 0,
          term_stats: 2,
          ballots: 0,
          choices: 0,
          definitions: 1,
          sync_state: 0,
          link_log: 0,
        },
        admin: {
          attendance: 3,
          signups: 2,
          contacts: 2,
          emails: 2,
          term_stats: 2,
          ballots: 0,
          choices: 0,
          definitions: 1,
          sync_state: 1,
          link_log: 1,
        },
        owner: {
          attendance: 3,
          signups: 2,
          contacts: 2,
          emails: 2,
          term_stats: 2,
          ballots: 3,
          choices: 10,
          definitions: 1,
          sync_state: 1,
          link_log: 1,
        },
      },
    },
  );
  await tcase(
    "P4b-02",
    "Privacy settings drive the same policies (admins see ballots; members see signups and emails)",
    "app_user",
    A("u_ownerA"),
    async (q) => {
      await q(
        `UPDATE "OrgSettings" SET "ballotIndividualVisibility" = 'OWNER_AND_ADMINS', "contactEmailVisibility" = 'MEMBERS'`,
      );
      await q(
        `UPDATE "DatabaseDefinition" SET "memberVisibility" = 'MEMBERS' WHERE "kind" = 'SIGNUPS'`,
      );
      await q(`SELECT app.set_context('u_adminA','org_A')`);
      const admin_ballots = await count(q, `SELECT count(*) n FROM "Ballot"`);
      await q(`SELECT app.set_context('u_memberA','org_A')`);
      const member = {
        signups: await count(q, `SELECT count(*) n FROM "Signup"`),
        emails: await count(q, `SELECT count(*) n FROM "ContactEmail"`),
        ballots: await count(q, `SELECT count(*) n FROM "Ballot"`),
      };
      return { admin_ballots, member };
    },
    { value: { admin_ballots: 3, member: { signups: 2, emails: 2, ballots: 0 } } },
  );
  await tcase(
    "P4b-03",
    "hiding every people database hides contacts from members; NOBODY hides ballots from the owner too",
    "app_user",
    A("u_ownerA"),
    async (q) => {
      await q(
        `UPDATE "DatabaseDefinition" SET "memberVisibility" = 'ADMINS' WHERE "kind" IN ('ATTENDANCE','PEOPLE','SIGNUPS')`,
      );
      await q(`UPDATE "OrgSettings" SET "ballotIndividualVisibility" = 'NOBODY'`);
      const owner_ballots = await count(q, `SELECT count(*) n FROM "Ballot"`);
      await q(`SELECT app.set_context('u_memberA','org_A')`);
      return {
        owner_ballots,
        member_contacts: await count(q, `SELECT count(*) n FROM "Contact"`),
        member_attendance: await count(q, `SELECT count(*) n FROM "Attendance"`),
      };
    },
    { value: { owner_ballots: 0, member_contacts: 0, member_attendance: 0 } },
  );
  await tcase(
    "P4b-04",
    "website-data writes are OWNER/ADMIN only",
    "app_user",
    A("u_memberA"),
    async (q) => ({
      contact: await tryq(
        q,
        `INSERT INTO "Contact" ("id","organizationId","updatedAt") VALUES ('cx','org_A',now())`,
      ),
      attendance: await tryq(
        q,
        `INSERT INTO "Attendance" ("id","organizationId","eventId","contactId","term","checkedInAt","method") VALUES ('ax','org_A','e_A2','c_A2','fall-2026',now(),'MANUAL')`,
      ),
      ballot_definition: await tryq(
        q,
        `INSERT INTO "BallotDefinition" ("id","organizationId","slug","title","definition") VALUES ('bx','org_A','s','T','{}')`,
      ),
      suppress: await rc(
        q,
        `UPDATE "Attendance" SET "suppressedAt" = now() WHERE "id" = 'att_A_sync'`,
      ),
      link_log: await tryq(
        q,
        `INSERT INTO "EventLinkLog" ("id","organizationId","eventId","source","externalId","method") VALUES ('lx','org_A','e_A','GOOGLE','g','EXACT')`,
      ),
    }),
    {
      value: {
        contact: "42501",
        attendance: "42501",
        ballot_definition: "42501",
        suppress: 0,
        link_log: "42501",
      },
    },
  );
  await tcase(
    "P4b-05",
    "synced rows can be suppressed but never deleted; suite rows can be deleted; the record source is immutable",
    "app_user",
    A("u_ownerA"),
    async (q) => ({
      delete_synced_attendance: await rc(q, `DELETE FROM "Attendance" WHERE "id" = 'att_A_sync'`),
      delete_suite_attendance: await rc(q, `DELETE FROM "Attendance" WHERE "id" = 'att_A_suite'`),
      delete_synced_signup: await rc(q, `DELETE FROM "Signup" WHERE "id" = 'su_A_sync'`),
      delete_suite_signup: await rc(q, `DELETE FROM "Signup" WHERE "id" = 'su_A_suite'`),
      delete_synced_ballot: await rc(q, `DELETE FROM "Ballot" WHERE "id" = 'bal_A1'`),
      delete_suite_ballot: await rc(q, `DELETE FROM "Ballot" WHERE "id" = 'bal_A3'`),
      suppress_synced: await rc(
        q,
        `UPDATE "Attendance" SET "suppressedAt" = now() WHERE "id" = 'att_A_sync'`,
      ),
      relabel_source: await tryq(
        q,
        `UPDATE "Attendance" SET "source" = 'SUITE' WHERE "id" = 'att_A_sync'`,
      ),
      relabel_signup: await tryq(
        q,
        `UPDATE "Signup" SET "recordSource" = 'CSV' WHERE "id" = 'su_A_sync'`,
      ),
    }),
    {
      value: {
        delete_synced_attendance: 0,
        delete_suite_attendance: 1,
        delete_synced_signup: 0,
        delete_suite_signup: 1,
        delete_synced_ballot: 0,
        delete_suite_ballot: 1,
        suppress_synced: 1,
        relabel_source: "42501",
        relabel_signup: "42501",
      },
    },
  );
  await tcase(
    "P4b-06",
    "a contact linked to a user must be a member; cross-org event and contact references fail",
    "app_user",
    A("u_ownerA"),
    async (q) => ({
      non_member_link: await tryq(
        q,
        `UPDATE "Contact" SET "userId" = 'u_memberB' WHERE "id" = 'c_A1'`,
      ),
      foreign_event: await tryq(
        q,
        `INSERT INTO "Attendance" ("id","organizationId","eventId","contactId","term","checkedInAt","method") VALUES ('ay','org_A','e_B','c_A1','fall-2026',now(),'MANUAL')`,
      ),
      foreign_voter: await tryq(
        q,
        `UPDATE "Ballot" SET "voterContactId" = 'c_B1' WHERE "id" = 'bal_A2'`,
      ),
      foreign_definition_event: await tryq(
        q,
        `UPDATE "BallotDefinition" SET "linkedEventId" = 'e_B' WHERE "id" = 'bd_A'`,
      ),
    }),
    {
      value: {
        non_member_link: "23514",
        foreign_event: "23503",
        foreign_voter: "23503",
        foreign_definition_event: "23503",
      },
    },
  );
  await tcase(
    "P4b-07",
    "rollups: stamps, first visit, term stats, attendance counts and signup conversion",
    "app_user",
    A("u_ownerA"),
    async (q) => ({
      stamps: (
        await q(
          `SELECT "id", "stampNumber" s, "termStampTotal" t, "isFirstVisit" f FROM "Attendance" ORDER BY "id" COLLATE "C"`,
        )
      ).rows,
      contacts: (
        await q(`SELECT "id", "sessionsAttended" n FROM "Contact" ORDER BY "id" COLLATE "C"`)
      ).rows,
      term_stats: (
        await q(
          `SELECT "contactId" c, "term", "stampCount" s FROM "ContactTermStats" ORDER BY "contactId" COLLATE "C"`,
        )
      ).rows,
      events: (
        await q(
          `SELECT "id", "attendanceCount" n FROM "Event" WHERE "id" IN ('e_A','e_A_pub','e_A2') ORDER BY "id" COLLATE "C"`,
        )
      ).rows,
      signups: (
        await q(
          `SELECT "id", "daysToFirstAttendance" d, "status" FROM "Signup" ORDER BY "id" COLLATE "C"`,
        )
      ).rows,
    }),
    {
      value: {
        stamps: [
          { id: "att_A_suite", s: 2, t: 2, f: false },
          { id: "att_A_sync", s: 1, t: 2, f: true },
          { id: "att_A_sync2", s: 1, t: 1, f: true },
        ],
        contacts: [
          { id: "c_A1", n: 2 },
          { id: "c_A2", n: 1 },
        ],
        term_stats: [
          { c: "c_A1", term: "fall-2026", s: 2 },
          { c: "c_A2", term: "fall-2026", s: 1 },
        ],
        events: [
          { id: "e_A", n: 2 },
          { id: "e_A2", n: 0 },
          { id: "e_A_pub", n: 1 },
        ],
        signups: [
          { id: "su_A_suite", d: 3, status: "PENDING" },
          { id: "su_A_sync", d: 5, status: "PENDING" },
        ],
      },
    },
  );
  await tcase(
    "P4b-08",
    "suppressing a check-in and refreshing drops it from every rollup",
    "app_user",
    A("u_ownerA"),
    async (q) => {
      await q(`UPDATE "Attendance" SET "suppressedAt" = now() WHERE "id" = 'att_A_sync'`);
      await q(`SELECT app.refresh_contact_rollups('org_A', ARRAY['c_A1'])`);
      return {
        suite_stamp: (
          await q(
            `SELECT "stampNumber" s, "isFirstVisit" f FROM "Attendance" WHERE "id" = 'att_A_suite'`,
          )
        ).rows[0],
        contact: (await q(`SELECT "sessionsAttended" n FROM "Contact" WHERE "id" = 'c_A1'`)).rows[0]
          .n,
        event: (await q(`SELECT "attendanceCount" n FROM "Event" WHERE "id" = 'e_A'`)).rows[0].n,
      };
    },
    { value: { suite_stamp: { s: 1, f: true }, contact: 1, event: 1 } },
  );
  await tcase(
    "P4b-09",
    "rollup and explode functions: OWNER/ADMIN or the service path for their own org only",
    "app_user",
    A("u_memberA"),
    async (q) => {
      const s = {};
      s.member_refresh = await tryv(q, `SELECT app.refresh_contact_rollups('org_A', NULL)::text`);
      s.member_explode = await tryv(q, `SELECT app.explode_ballot('org_A','bal_A1')`);
      s.member_lapsed = await tryv(q, `SELECT app.refresh_lapsed('org_A')`);
      await q(`SELECT app.set_context('u_adminA','org_A')`);
      s.admin_explode = await tryv(q, `SELECT app.explode_ballot('org_A','bal_A1')`);
      s.admin_foreign = await tryv(q, `SELECT app.refresh_contact_rollups('org_B', NULL)::text`);
      return s;
    },
    {
      value: {
        member_refresh: "error:42501",
        member_explode: "error:42501",
        member_lapsed: "error:42501",
        admin_explode: 5,
        admin_foreign: "error:42501",
      },
    },
  );
  await tcase(
    "P4b-10",
    "service path: rollups and lapsed for app.org_id only",
    "app_service",
    { org: "org_A" },
    async (q) => ({
      own: await tryv(q, `SELECT app.refresh_contact_rollups('org_A', NULL)::text`),
      foreign: await tryv(q, `SELECT app.refresh_contact_rollups('org_B', NULL)::text`),
      lapsed: await tryv(q, `SELECT app.refresh_lapsed('org_A')`),
    }),
    { value: { own: "", foreign: "error:42501", lapsed: 0 } },
  );
  await tcase(
    "P4b-11",
    "ballot_tally for the OWNER: counts, first choices and Borda; free text never tallied",
    "app_user",
    A("u_ownerA"),
    async (q) =>
      (
        await q(
          `SELECT question_key q, choice_key c, votes v, first_choice f, borda b, ballots n, suppressed s FROM app.ballot_tally('org_A','bd_A','OWNER')`,
        )
      ).rows,
    {
      value: [
        { q: "day", c: "tue", v: 2, f: null, b: null, n: 3, s: false },
        { q: "day", c: "thu", v: 1, f: null, b: null, n: 3, s: false },
        { q: "topics", c: "agents", v: 3, f: 2, b: 5, n: 3, s: false },
        { q: "topics", c: "rag", v: 2, f: 1, b: 4, n: 3, s: false },
        { q: "topics", c: "evals", v: 1, f: 0, b: 1, n: 3, s: false },
      ],
    },
  );
  await tcase(
    "P4b-12",
    "ballot_tally for members: cells below k are suppressed; claiming OWNER does not help",
    "app_user",
    A("u_memberA"),
    async (q) => ({
      member: (
        await q(
          `SELECT choice_key c, votes v, suppressed s FROM app.ballot_tally('org_A','bd_A','MEMBER') WHERE question_key = 'topics'`,
        )
      ).rows,
      claims_owner: (
        await q(
          `SELECT choice_key c, votes v, suppressed s FROM app.ballot_tally('org_A','bd_A','OWNER') WHERE question_key = 'topics'`,
        )
      ).rows,
    }),
    {
      value: {
        member: [
          { c: "agents", v: 3, s: false },
          { c: "rag", v: null, s: true },
          { c: "evals", v: null, s: true },
        ],
        claims_owner: [
          { c: "agents", v: 3, s: false },
          { c: "rag", v: null, s: true },
          { c: "evals", v: null, s: true },
        ],
      },
    },
  );
  await tcase(
    "P4b-13",
    "ballot_tally: hidden results, other orgs and a missing org GUC are refused or empty",
    "app_user",
    A("u_ownerA"),
    async (q) => {
      await q(`UPDATE "OrgSettings" SET "ballotResultsVisibleToMembers" = false`);
      const owner_rows = await count(
        q,
        `SELECT count(*) n FROM app.ballot_tally('org_A','bd_A','OWNER')`,
      );
      await q(`SELECT app.set_context('u_memberA','org_A')`);
      return {
        owner_rows,
        member_rows_hidden: await count(
          q,
          `SELECT count(*) n FROM app.ballot_tally('org_A','bd_A','MEMBER')`,
        ),
        foreign: await tryv(q, `SELECT count(*) FROM app.ballot_tally('org_B','bd_B','MEMBER')`),
      };
    },
    { value: { owner_rows: 5, member_rows_hidden: 0, foreign: "error:42501" } },
  );
  await tcase(
    "P4b-14",
    "cached reports on the service path pass the tier explicitly",
    "app_service",
    { org: "org_A" },
    async (q) => ({
      member_tier: (
        await q(
          `SELECT count(*) FILTER (WHERE suppressed)::int n FROM app.ballot_tally('org_A','bd_A','MEMBER')`,
        )
      ).rows[0].n,
      owner_tier: (
        await q(
          `SELECT count(*) FILTER (WHERE suppressed)::int n FROM app.ballot_tally('org_A','bd_A','OWNER')`,
        )
      ).rows[0].n,
      rows_member: (
        await q(`SELECT app.can_view_rows('org_A','SIGNUPS','MEMBER') a, app.can_view_rows('org_A','SIGNUPS','ADMIN') b,
                                  app.can_view_rows('org_A','SIGNUPS','TREASURER') c, app.can_view_rows('org_B','ATTENDANCE','OWNER') d`)
      ).rows[0],
    }),
    {
      value: {
        member_tier: 4,
        owner_tier: 0,
        rows_member: { a: false, b: true, c: false, d: false },
      },
    },
  );
  await tcase(
    "P4b-15",
    "DataSourceSyncState is written only on the service path",
    "app_user",
    A("u_ownerA"),
    async (q) => ({
      owner_insert: await tryq(
        q,
        `INSERT INTO "DataSourceSyncState" ("id","organizationId","integrationId","stream","updatedAt") VALUES ('d2','org_A','int_A_supa','signups',now())`,
      ),
      owner_update: await tryq(q, `UPDATE "DataSourceSyncState" SET "rowsUpserted" = 1`),
    }),
    { value: { owner_insert: "42501", owner_update: "42501" } },
  );

  // ======================= Phase 6: tasks =======================
  await tcase(
    "P6-01",
    "comments: members write their own; the author or OWNER/ADMIN edits; authorship is immutable",
    "app_user",
    A("u_memberA"),
    async (q) => {
      const s = {};
      s.as_other = await tryq(
        q,
        `INSERT INTO "TaskComment" ("id","organizationId","taskId","authorId","body") VALUES ('c1','org_A','t_A','u_adminA','x')`,
      );
      s.own_insert = await tryq(
        q,
        `INSERT INTO "TaskComment" ("id","organizationId","taskId","authorId","body") VALUES ('c2','org_A','t_A','u_memberA','x')`,
      );
      s.edit_own = await rc(
        q,
        `UPDATE "TaskComment" SET "body" = 'y', "editedAt" = now() WHERE "id" = 'tc_A_member'`,
      );
      s.edit_admins = await rc(
        q,
        `UPDATE "TaskComment" SET "body" = 'y' WHERE "id" = 'tc_A_admin'`,
      );
      s.delete_admins = await rc(q, `DELETE FROM "TaskComment" WHERE "id" = 'tc_A_admin'`);
      s.reassign = await tryq(
        q,
        `UPDATE "TaskComment" SET "authorId" = 'u_adminA' WHERE "id" = 'tc_A_member'`,
      );
      await q(`SELECT app.set_context('u_adminA','org_A')`);
      s.admin_moderates = await rc(
        q,
        `UPDATE "TaskComment" SET "deletedAt" = now() WHERE "id" = 'tc_A_member'`,
      );
      s.foreign_task = await tryq(
        q,
        `INSERT INTO "TaskComment" ("id","organizationId","taskId","authorId","body") VALUES ('c3','org_A','t_B','u_adminA','x')`,
      );
      return s;
    },
    {
      value: {
        as_other: "42501",
        own_insert: 1,
        edit_own: 1,
        edit_admins: 0,
        delete_admins: 0,
        reassign: "42501",
        admin_moderates: 1,
        foreign_task: "23503",
      },
    },
  );
  await tcase(
    "P6-02",
    "mentions: only of members, recorded as the actor",
    "app_user",
    A("u_memberA"),
    async (q) => ({
      non_member: await tryq(
        q,
        `INSERT INTO "TaskMention" ("id","organizationId","taskId","sourceKey","mentionedUserId","mentionedById") VALUES ('m1','org_A','t_A','desc','u_memberB','u_memberA')`,
      ),
      as_other: await tryq(
        q,
        `INSERT INTO "TaskMention" ("id","organizationId","taskId","sourceKey","mentionedUserId","mentionedById") VALUES ('m2','org_A','t_A','desc','u_adminA','u_adminA')`,
      ),
      ok: await tryq(
        q,
        `INSERT INTO "TaskMention" ("id","organizationId","taskId","sourceKey","mentionedUserId","mentionedById") VALUES ('m3','org_A','t_A','desc','u_adminA','u_memberA')`,
      ),
    }),
    { value: { non_member: "23514", as_other: "42501", ok: 1 } },
  );
  await tcase(
    "P6-03",
    "task activity is append-only and attributed to the actor",
    "app_user",
    A("u_ownerA"),
    async (q) => ({
      update: await tryq(q, `UPDATE "TaskActivity" SET "type" = 'X'`),
      delete: await tryq(q, `DELETE FROM "TaskActivity"`),
      as_other: await tryq(
        q,
        `INSERT INTO "TaskActivity" ("id","organizationId","taskId","actorId","type") VALUES ('a1','org_A','t_A','u_memberA','STATUS_CHANGED')`,
      ),
      ok: await tryq(
        q,
        `INSERT INTO "TaskActivity" ("id","organizationId","taskId","actorId","type") VALUES ('a2','org_A','t_A','u_ownerA','STATUS_CHANGED')`,
      ),
    }),
    { value: { update: "42501", delete: "42501", as_other: "42501", ok: 1 } },
  );
  await tcase(
    "P6-04",
    "Sunday updates: everyone reads the org's, each writes only their own, admins may delete",
    "app_user",
    A("u_memberA"),
    async (q) => {
      const s = {};
      s.reads = await count(q, `SELECT count(*) n FROM "WeeklyUpdate"`);
      s.for_other = await tryq(
        q,
        `INSERT INTO "WeeklyUpdate" ("id","organizationId","userId","weekStart","updatedAt") VALUES ('w1','org_A','u_adminA','2026-09-21',now())`,
      );
      s.own = await tryq(
        q,
        `INSERT INTO "WeeklyUpdate" ("id","organizationId","userId","weekStart","updatedAt") VALUES ('w2','org_A','u_memberA','2026-09-21',now())`,
      );
      s.edit_other = await rc(
        q,
        `UPDATE "WeeklyUpdate" SET "note" = 'x' WHERE "id" = 'wu_A_admin'`,
      );
      s.edit_own = await rc(q, `UPDATE "WeeklyUpdate" SET "note" = 'x' WHERE "id" = 'wu_A_member'`);
      await q(`SELECT app.set_context('u_adminA','org_A')`);
      s.admin_delete = await rc(q, `DELETE FROM "WeeklyUpdate" WHERE "id" = 'wu_A_member'`);
      return s;
    },
    {
      value: { reads: 2, for_other: "42501", own: 1, edit_other: 0, edit_own: 1, admin_delete: 1 },
    },
  );
  await tcase(
    "P6-05",
    "task owner and intake triage user must be members; BLOCKED is a status",
    "app_user",
    A("u_memberA"),
    async (q) => ({
      non_member_owner: await tryq(
        q,
        `UPDATE "Task" SET "ownerId" = 'u_memberB' WHERE "id" = 't_A'`,
      ),
      blocked: await tryq(
        q,
        `UPDATE "Task" SET "status" = 'BLOCKED', "blockedReason" = 'room', "blockedAt" = now() WHERE "id" = 't_A'`,
      ),
      non_member_triage: await tryq(
        q,
        `UPDATE "Project" SET "isIntake" = true, "triageUserId" = 'u_memberB' WHERE "id" = 'p_A'`,
      ),
      foreign_notification_task: await tryq(
        q,
        `INSERT INTO "Notification" ("id","organizationId","userId","type","title","taskId") VALUES ('nt','org_A','u_adminA','TASK_MENTIONED','x','t_B')`,
      ),
    }),
    {
      value: {
        non_member_owner: "23514",
        blocked: 1,
        non_member_triage: "23514",
        foreign_notification_task: "23503",
      },
    },
  );
  await tcase(
    "P6-06",
    "notification dedupe keys are unique per recipient",
    "app_user",
    A("u_memberA"),
    async (q) => ({
      first: await tryq(
        q,
        `INSERT INTO "Notification" ("id","organizationId","userId","type","title","dedupeKey") VALUES ('nd1','org_A','u_adminA','TASK_MENTIONED','x','mention:t_A:desc')`,
      ),
      duplicate: await tryq(
        q,
        `INSERT INTO "Notification" ("id","organizationId","userId","type","title","dedupeKey") VALUES ('nd2','org_A','u_adminA','TASK_MENTIONED','x','mention:t_A:desc')`,
      ),
    }),
    { value: { first: 1, duplicate: "23505" } },
  );

  // ======================= Phase 7: calendar children =======================
  await tcase(
    "P7-01",
    "attendees, slots and responses carry organizationId: no cross-org rows either way",
    "app_user",
    A("u_memberA"),
    async (q) => ({
      attendee_foreign_event: await tryq(
        q,
        `INSERT INTO "EventAttendee" ("organizationId","eventId","userId") VALUES ('org_A','e_B','u_bothAB')`,
      ),
      // BEFORE triggers run before the RLS check: the member-of-parent-org
      // trigger refuses the other org's event first (23503, as for a missing one).
      attendee_foreign_org: await tryq(
        q,
        `INSERT INTO "EventAttendee" ("organizationId","eventId","userId") VALUES ('org_B','e_B','u_bothAB')`,
      ),
      slot_foreign_poll: await tryq(
        q,
        `INSERT INTO "PollSlot" ("id","organizationId","pollId","startsAt","endsAt") VALUES ('sx','org_A','poll_B',now(),now())`,
      ),
      slot_foreign_org: await tryq(
        q,
        `INSERT INTO "PollSlot" ("id","organizationId","pollId","startsAt","endsAt") VALUES ('sy','org_B','poll_B',now(),now())`,
      ),
      own_response: await tryq(
        q,
        `INSERT INTO "PollResponse" ("id","organizationId","pollId","slotId","userId","availability","updatedAt") VALUES ('pr1','org_A','poll_A','s_A','u_memberA','YES',now())`,
      ),
      attendee_ok: await tryq(
        q,
        `INSERT INTO "EventAttendee" ("organizationId","eventId","userId") VALUES ('org_A','e_A2','u_memberA')`,
      ),
    }),
    {
      value: {
        attendee_foreign_event: "23503",
        attendee_foreign_org: "23503",
        slot_foreign_poll: "23503",
        slot_foreign_org: "42501",
        own_response: 1,
        attendee_ok: 1,
      },
    },
  );
  await tcase(
    "P7-02",
    "guest responses on the service path: same-poll slot required, org GUC required",
    "app_service",
    { org: "org_A" },
    async (q) => {
      await q(
        `INSERT INTO "AvailabilityPoll" ("id","organizationId","title","timezone","durationMinutes","createdById") VALUES ('poll_A2','org_A','P2','UTC',30,'u_adminA')`,
      );
      await q(
        `INSERT INTO "PollSlot" ("id","organizationId","pollId","startsAt","endsAt") VALUES ('s_A2','org_A','poll_A2',now(),now())`,
      );
      return {
        guest: await tryq(
          q,
          `INSERT INTO "PollResponse" ("id","organizationId","pollId","slotId","guestName","guestKeyHash","availability","updatedAt") VALUES ('g1','org_A','poll_A','s_A','Guest',$1,'YES',now())`,
          ["e".repeat(64)],
        ),
        other_polls_slot: await tryq(
          q,
          `INSERT INTO "PollResponse" ("id","organizationId","pollId","slotId","guestName","availability","updatedAt") VALUES ('g2','org_A','poll_A','s_A2','Guest','YES',now())`,
        ),
        same_guest_key_twice: await tryq(
          q,
          `INSERT INTO "PollResponse" ("id","organizationId","pollId","slotId","guestName","guestKeyHash","availability","updatedAt") VALUES ('g3','org_A','poll_A','s_A','Guest 2',$1,'NO',now())`,
          ["e".repeat(64)],
        ),
      };
    },
    { value: { guest: 1, other_polls_slot: "42501", same_guest_key_twice: "23505" } },
  );
  await tcase(
    "P7-03",
    "Google event ids are unique per org and calendar",
    "app_service",
    { org: "org_A" },
    async (q) => ({
      first: await rc(
        q,
        `UPDATE "Event" SET "googleCalendarId" = 'cal1', "googleEventId" = 'g1', "googleSyncState" = 'SYNCED' WHERE "id" = 'e_A'`,
      ),
      duplicate: await tryq(
        q,
        `UPDATE "Event" SET "googleCalendarId" = 'cal1', "googleEventId" = 'g1' WHERE "id" = 'e_A2'`,
      ),
    }),
    { value: { first: 1, duplicate: "23505" } },
  );

  // ======================= Phase 8: themes =======================
  await tcase(
    "P8-01",
    "OrgTheme: members read their org's theme; only OWNER/ADMIN write or reset it",
    "app_user",
    A("u_memberA"),
    async (q) => {
      const s = {};
      s.member_reads = await count(q, `SELECT count(*) n FROM "OrgTheme"`);
      s.member_update = await rc(q, `UPDATE "OrgTheme" SET "preset" = 'x'`);
      s.member_delete = await rc(q, `DELETE FROM "OrgTheme"`);
      await q(`SELECT app.set_context('u_adminA','org_A')`);
      s.admin_update = await rc(q, `UPDATE "OrgTheme" SET "mode" = 'DARK', "lockMode" = true`);
      s.admin_reset = await rc(q, `DELETE FROM "OrgTheme"`);
      s.admin_insert = await tryq(
        q,
        `INSERT INTO "OrgTheme" ("organizationId","light","updatedAt") VALUES ('org_A','{"primary":"#000000"}',now())`,
      );
      return s;
    },
    {
      value: {
        member_reads: 1,
        member_update: 0,
        member_delete: 0,
        admin_update: 1,
        admin_reset: 1,
        admin_insert: 1,
      },
    },
  );
  await tcase(
    "P8-02",
    "another org's members never see the theme",
    "app_user",
    B("u_memberB"),
    (q) => count(q, `SELECT count(*) n FROM "OrgTheme"`),
    { value: 0 },
  );
  // B8 migration b8_theme_logo_display: the new column rides on the same
  // per-command policies (no new table, no new grant).
  await tcase(
    "P8-03",
    "OrgTheme.logoDisplay: defaults to LOGO_AND_NAME; members cannot change it, admins can",
    "app_user",
    A("u_memberA"),
    async (q) => {
      const s = {};
      s.default = (await q(`SELECT "logoDisplay"::text AS v FROM "OrgTheme"`)).rows[0]?.v ?? null;
      s.member_update = await rc(q, `UPDATE "OrgTheme" SET "logoDisplay" = 'NAME_ONLY'`);
      await q(`SELECT app.set_context('u_adminA','org_A')`);
      s.admin_update = await rc(q, `UPDATE "OrgTheme" SET "logoDisplay" = 'LOGO_ONLY'`);
      s.bad_value = await tryq(q, `UPDATE "OrgTheme" SET "logoDisplay" = 'x'`);
      return s;
    },
    { value: { default: "LOGO_AND_NAME", member_update: 0, admin_update: 1, bad_value: "22P02" } },
  );

  // ============ B9: org-wide collaboration tables ============
  // Label, Task, Project and the task/poll/event children were given
  // policies that test organizationId and nothing else, so any member could
  // write them at the database level. Label was the one that contradicted
  // the app (labels.write is ADMIN+), and a member deleting every label in
  // the org was reproduced. The rest stay tenant-only by decision, and the
  // 'tenant_only_write' manifest check holds the reviewed list.
  await tcase(
    "P-B9-01",
    "labels: every member reads, only OWNER/ADMIN insert, rename or delete",
    "app_user",
    A("u_memberA"),
    async (q) => {
      const s = {};
      s.member_reads = await count(q, `SELECT count(*) n FROM "Label"`);
      s.member_insert = await tryq(
        q,
        `INSERT INTO "Label" ("id","organizationId","name","color") VALUES ('l_m','org_A','Member','#000000')`,
      );
      s.member_rename = await rc(q, `UPDATE "Label" SET "name" = 'Renamed' WHERE "id" = 'l_A'`);
      s.member_deletes_all = await rc(q, `DELETE FROM "Label"`);
      await q(`SELECT app.set_context('u_treasA','org_A')`);
      s.treasurer_insert = await tryq(
        q,
        `INSERT INTO "Label" ("id","organizationId","name","color") VALUES ('l_t','org_A','Treasurer','#000000')`,
      );
      await q(`SELECT app.set_context('u_adminA','org_A')`);
      s.admin_insert = await tryq(
        q,
        `INSERT INTO "Label" ("id","organizationId","name","color") VALUES ('l_a','org_A','Admin','#000000')`,
      );
      s.admin_rename = await rc(q, `UPDATE "Label" SET "name" = 'Renamed' WHERE "id" = 'l_A'`);
      s.admin_foreign = await rc(q, `UPDATE "Label" SET "name" = 'X' WHERE "id" = 'l_B'`);
      s.admin_delete = await rc(q, `DELETE FROM "Label" WHERE "id" = 'l_A'`);
      return s;
    },
    {
      value: {
        member_reads: 1,
        member_insert: "42501",
        member_rename: 0,
        member_deletes_all: 0,
        treasurer_insert: "42501",
        admin_insert: 1,
        admin_rename: 1,
        admin_foreign: 0,
        admin_delete: 1,
      },
    },
  );
  await tcase(
    "P-B9-02",
    "projects: OWNER/ADMIN create and delete; a member may still clear a triage owner and write tasks",
    "app_user",
    A("u_memberA"),
    async (q) => {
      const s = {};
      s.member_insert = await tryq(
        q,
        `INSERT INTO "Project" ("id","organizationId","name") VALUES ('p_m','org_A','Member project')`,
      );
      s.member_delete = await rc(q, `DELETE FROM "Project" WHERE "id" = 'p_A'`);
      // The documented carve-out: untieDepartingMember runs as the member
      // who is leaving and clears the triage owner.
      s.member_clears_triage = await rc(
        q,
        `UPDATE "Project" SET "triageUserId" = NULL WHERE "id" = 'p_A'`,
      );
      // Members still own the task board itself.
      s.member_task = await tryq(
        q,
        `INSERT INTO "Task" ("id","organizationId","title","rank","createdById","updatedAt")
         VALUES ('t_m','org_A','Member task','a0','u_memberA', now())`,
      );
      await q(`SELECT app.set_context('u_adminA','org_A')`);
      s.admin_insert = await tryq(
        q,
        `INSERT INTO "Project" ("id","organizationId","name") VALUES ('p_a','org_A','Admin project')`,
      );
      s.admin_delete = await rc(q, `DELETE FROM "Project" WHERE "id" = 'p_a'`);
      s.admin_foreign_insert = await tryq(
        q,
        `INSERT INTO "Project" ("id","organizationId","name") VALUES ('p_x','org_B','Wrong org')`,
      );
      return s;
    },
    {
      value: {
        member_insert: "42501",
        member_delete: 0,
        member_clears_triage: 1,
        member_task: 1,
        admin_insert: 1,
        admin_delete: 1,
        admin_foreign_insert: "42501",
      },
    },
  );

  // ======================= A3: platform services =======================
  // The maintenance definer functions (migration a3_platform_maintenance),
  // and the service-path patterns the job handlers rely on.
  await tcase(
    "P-A3-01",
    "prune functions are executable by app_service only",
    "owner",
    null,
    async () => {
      const out = {};
      for (const role of ["app_user", "app_auth"]) {
        const c = clients[role];
        await c.query("BEGIN");
        try {
          const q = (sql, params) => c.query(sql, params);
          out[role] = [
            await tryv(q, `SELECT app.prune_rate_limit_buckets(3456000)`),
            await tryv(q, `SELECT app.prune_jobs(30)`),
          ];
        } finally {
          await c.query("ROLLBACK");
        }
      }
      return out;
    },
    {
      value: {
        app_user: ["error:42501", "error:42501"],
        app_auth: ["error:42501", "error:42501"],
      },
    },
  );

  // Committed setup for the prune cases (the functions run in their own
  // transaction under test and roll back; the rows are removed afterwards).
  await clients.owner.query(`
    INSERT INTO "RateLimitBucket" ("key", "windowStart", "count") VALUES
      ('a3:old', (now() AT TIME ZONE 'UTC') - interval '50 days', 3),
      ('a3:recent', (now() AT TIME ZONE 'UTC') - interval '10 days', 3),
      ('a3:now', date_trunc('minute', now() AT TIME ZONE 'UTC'), 1)`);
  await clients.owner.query(`
    INSERT INTO "Job" ("organizationId", "kind", "dedupeKey", "status", "completedAt", "createdAt", "runAt") VALUES
      ('org_A', 'maintenance', 'a3:done-old', 'DONE', (now() AT TIME ZONE 'UTC') - interval '40 days', (now() AT TIME ZONE 'UTC') - interval '41 days', (now() AT TIME ZONE 'UTC') - interval '41 days'),
      ('org_A', 'maintenance', 'a3:dead-old', 'DEAD', (now() AT TIME ZONE 'UTC') - interval '40 days', (now() AT TIME ZONE 'UTC') - interval '41 days', (now() AT TIME ZONE 'UTC') - interval '41 days'),
      ('org_A', 'maintenance', 'a3:done-new', 'DONE', (now() AT TIME ZONE 'UTC') - interval '1 day', (now() AT TIME ZONE 'UTC') - interval '2 days', (now() AT TIME ZONE 'UTC') - interval '2 days'),
      ('org_A', 'maintenance', 'a3:pending-old', 'PENDING', NULL, (now() AT TIME ZONE 'UTC') - interval '41 days', (now() AT TIME ZONE 'UTC') + interval '1 day')`);
  const expectedOldBuckets = Number(
    (
      await clients.owner.query(
        `SELECT count(*) n FROM "RateLimitBucket" WHERE "windowStart" < (now() AT TIME ZONE 'UTC') - interval '40 days'`,
      )
    ).rows[0].n,
  );
  const expectedOldJobs = Number(
    (
      await clients.owner.query(
        `SELECT count(*) n FROM "Job" WHERE "status" IN ('DONE','DEAD','CANCELLED') AND "completedAt" < (now() AT TIME ZONE 'UTC') - interval '30 days'`,
      )
    ).rows[0].n,
  );
  try {
    await tcase(
      "P-A3-02",
      "prune_rate_limit_buckets deletes only buckets past the retention, and refuses a short retention",
      "app_service",
      null,
      async (q) => ({
        too_short: await tryv(q, `SELECT app.prune_rate_limit_buckets(3600)`),
        deleted: Number((await q(`SELECT app.prune_rate_limit_buckets(3456000) AS n`)).rows[0].n),
      }),
      { value: { too_short: "error:22023", deleted: expectedOldBuckets } },
    );
    await tcase(
      "P-A3-03",
      "prune_jobs deletes finished jobs past the retention and never touches PENDING or recent ones",
      "app_service",
      { org: "org_A" },
      async (q) => {
        const tooShort = await tryv(q, `SELECT app.prune_jobs(1)`);
        const deleted = Number((await q(`SELECT app.prune_jobs(30) AS n`)).rows[0].n);
        const left = (
          await q(`SELECT "dedupeKey" FROM "Job" WHERE "dedupeKey" LIKE 'a3:%' ORDER BY 1`)
        ).rows.map((r) => r.dedupeKey);
        return { tooShort, deleted, left };
      },
      {
        value: {
          tooShort: "error:22023",
          deleted: expectedOldJobs,
          left: ["a3:done-new", "a3:pending-old"],
        },
      },
    );
  } finally {
    await clients.owner.query(`DELETE FROM "RateLimitBucket" WHERE "key" LIKE 'a3:%'`);
    await clients.owner.query(`DELETE FROM "Job" WHERE "dedupeKey" LIKE 'a3:%'`);
  }

  await tcase(
    "P-A3-04",
    "notify-email on the service path: insert for a member, enqueue in the same tx, emailSentAt compare-and-set once",
    "app_service",
    { org: "org_A" },
    async (q) => {
      const s = {};
      s.insert = await tryq(
        q,
        `INSERT INTO "Notification" ("id","organizationId","userId","type","title") VALUES ('n_a3','org_A','u_memberA','SECURITY_ALERT','Key replaced')`,
      );
      s.non_member = await tryq(
        q,
        `INSERT INTO "Notification" ("id","organizationId","userId","type","title") VALUES ('n_a3b','org_A','u_memberB','SECURITY_ALERT','x')`,
      );
      s.job = (
        await q(
          `SELECT app.enqueue_job('org_A','notify-email','notify-email:n_a3','{"notificationId":"n_a3"}'::jsonb) IS NOT NULL AS ok`,
        )
      ).rows[0].ok;
      s.first_claim = await rc(
        q,
        `UPDATE "Notification" SET "emailSentAt" = now() WHERE "id" = 'n_a3' AND "emailSentAt" IS NULL`,
      );
      s.second_claim = await rc(
        q,
        `UPDATE "Notification" SET "emailSentAt" = now() WHERE "id" = 'n_a3' AND "emailSentAt" IS NULL`,
      );
      await q(`SELECT app.set_context('', 'org_B')`);
      s.other_org_sees = await count(
        q,
        `SELECT count(*) n FROM "Notification" WHERE "id" = 'n_a3'`,
      );
      return s;
    },
    {
      value: {
        insert: 1,
        non_member: "42501",
        job: true,
        first_claim: 1,
        second_claim: 0,
        other_org_sees: 0,
      },
    },
  );
  await tcase(
    "P-A3-05",
    "invite-email on the service path: the token hash is rotated in the job's own org only",
    "app_service",
    { org: "org_A" },
    async (q) => {
      const own = await rc(q, `UPDATE "Invitation" SET "token" = 'rotated_A' WHERE "id" = 'inv_A'`);
      await q(`SELECT app.set_context('', 'org_B')`);
      const foreign = await rc(
        q,
        `UPDATE "Invitation" SET "token" = 'rotated_B' WHERE "id" = 'inv_A'`,
      );
      await q(`SELECT app.set_context('', '')`);
      const none = await rc(
        q,
        `UPDATE "Invitation" SET "token" = 'rotated_0' WHERE "id" = 'inv_A'`,
      );
      return { own, foreign, none };
    },
    { value: { own: 1, foreign: 0, none: 0 } },
  );
  await tcase(
    "P-A3-06",
    "app.enqueue_job has no legacy branch left: an unknown login role is refused outright",
    "app_auth",
    null,
    async (q) => ({
      // 0C removed the app_legacy branch, which could queue invite-email,
      // reimbursement-email and notify-email for any row of the org it
      // named. app_auth is the remaining non-tenant login role: platform
      // jobs only, never an org job.
      org_job: await tryv(
        q,
        `SELECT app.enqueue_job('org_A','invite-email','invite-email:inv_A','{"invitationId":"inv_A"}'::jsonb)`,
      ),
      platform_job: await tryv(
        q,
        `SELECT app.enqueue_job(NULL,'verify-email','verify-email:u_memberA','{}'::jsonb) IS NOT NULL`,
      ),
    }),
    { value: { org_job: "error:42501", platform_job: true } },
  );
  await tcase(
    "P-A3-07",
    "a site-rebuild enqueued for later is not claimable before its runAt; a due gcal job is",
    "app_service",
    { org: "org_A" },
    async (q) => {
      await q(
        `SELECT app.enqueue_job('org_A','site-rebuild','site-rebuild:org_A','{}'::jsonb, ((now() AT TIME ZONE 'UTC') + interval '60 seconds')::timestamp)`,
      );
      await q(`SELECT app.enqueue_job('org_A','gcal','gcal:e_A','{"eventId":"e_A"}'::jsonb)`);
      const claimed = (
        await q(
          `SELECT "kind" FROM app.claim_jobs('{"site-rebuild":90,"gcal":90}'::jsonb, 10) ORDER BY 1`,
        )
      ).rows.map((r) => r.kind);
      return claimed;
    },
    { value: ["gcal"] },
  );
});
