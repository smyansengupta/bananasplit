// Regression suite for the security layer (0B, extended through Phase 9),
// ported from the design's 0B-rls-tests.js (v3, 121 cases). Run through
// `pnpm test:rls` (prisma/rls/run.mjs), which creates a throwaway database,
// applies every migration as a NON-superuser owner (like neondb_owner),
// local-roles.sql and fixtures.sql, then runs this file, attacks.mjs and
// phases.mjs.
//
// Every case runs as a runtime role inside BEGIN ... app.set_context(user,
// org) ... ROLLBACK, so cases never see each other's writes. A case that
// cannot run in the current setup (T32 under a superuser owner, T27b's role
// membership plant without ADMIN on the role) is reported as SKIP and never
// counted as PASS.
//
// Changes from the design suite, all forced by later phases' planned schema
// changes and documented at each case:
//   T13a/T13b/T14d/A-N4  TaskAssignee and TaskLabel carry organizationId and
//                        composite FKs (Phase 6); EventAttendee, PollSlot and
//                        PollResponse too (Phase 7). A foreign label on a
//                        same-org row is now rejected by the composite FK
//                        (23503) instead of the EXISTS policy (42501).
//   T16l                 OrgSecret has the Phase 1 composite FK to
//                        OrgIntegration, so a write naming another org's
//                        integration id is refused outright (23503).
//   T27c-f               the reviewed lists include the Phase 1-8 functions
//                        and definer-only tables.
import { A, B, count, connect, connectAdmin, HASH, rc, runSuite, tryq } from "./lib.mjs";

runSuite("rls-tests", async ({ clients, tcase, record }) => {
  // ---------------- Tenant isolation ----------------
  await tcase(
    "T01",
    "cross-org SELECT returns 0 rows",
    "app_user",
    A("u_memberA"),
    async (q) => ({
      orgB_tasks: await count(q, `SELECT count(*) n FROM "Task" WHERE "organizationId" = 'org_B'`),
      orgB_notes: await count(q, `SELECT count(*) n FROM "Note" WHERE "organizationId" = 'org_B'`),
      orgB_by_id: await count(q, `SELECT count(*) n FROM "Event" WHERE "id" = 'e_B'`),
      own_tasks: await count(q, `SELECT count(*) n FROM "Task"`),
    }),
    { value: { orgB_tasks: 0, orgB_notes: 0, orgB_by_id: 0, own_tasks: 2 } },
  );

  await tcase(
    "T02",
    "missing GUC returns 0 rows",
    "app_user",
    null,
    async (q) => ({
      task: await count(q, `SELECT count(*) n FROM "Task"`),
      membership: await count(q, `SELECT count(*) n FROM "Membership"`),
      organization: await count(q, `SELECT count(*) n FROM "Organization"`),
      user: await count(q, `SELECT count(*) n FROM "User"`),
    }),
    { value: { task: 0, membership: 0, organization: 0, user: 0 } },
  );

  await tcase(
    "T03",
    "empty GUCs return 0 rows",
    "app_user",
    { user: "", org: "" },
    async (q) => ({
      task: await count(q, `SELECT count(*) n FROM "Task"`),
      event: await count(q, `SELECT count(*) n FROM "Event"`),
    }),
    { value: { task: 0, event: 0 } },
  );

  await tcase(
    "T04",
    "org GUC of an org the user is not in returns 0 rows",
    "app_user",
    { user: "u_memberA", org: "org_B" },
    async (q) => ({
      task: await count(q, `SELECT count(*) n FROM "Task"`),
      orgB_visible: await count(q, `SELECT count(*) n FROM "Organization" WHERE "id" = 'org_B'`),
    }),
    { value: { task: 0, orgB_visible: 0 } },
  );

  await tcase(
    "T05",
    "INSERT with a foreign organizationId is rejected",
    "app_user",
    A("u_memberA"),
    (q) =>
      q(
        `INSERT INTO "Task" ("id","organizationId","title","rank","createdById","updatedAt") VALUES ('t_x','org_B','x','a9','u_memberA',now())`,
      ),
    { error: "42501" },
  );

  // ---------------- Admin-only rows ----------------
  await tcase(
    "T06a",
    "MEMBER UPDATE/DELETE on admin-only Invitation affects 0 rows",
    "app_user",
    A("u_memberA"),
    async (q) => ({
      updated: await rc(q, `UPDATE "Invitation" SET "expiresAt" = now() WHERE "id" = 'inv_A'`),
      deleted: await rc(q, `DELETE FROM "Invitation" WHERE "id" = 'inv_A'`),
      visible: await count(q, `SELECT count(*) n FROM "Invitation"`),
    }),
    { value: { updated: 0, deleted: 0, visible: 0 } },
  );

  await tcase(
    "T06b",
    "MEMBER INSERT into admin-only Invitation is rejected",
    "app_user",
    A("u_memberA"),
    (q) =>
      q(
        `INSERT INTO "Invitation" ("id","organizationId","email","role","token","expiresAt","invitedById") VALUES ('inv_x','org_A','x@example.edu','MEMBER','h','2030-01-01','u_memberA')`,
      ),
    { error: "42501" },
  );

  await tcase(
    "T06c",
    "ADMIN can DELETE the invitation (control)",
    "app_user",
    A("u_adminA"),
    (q) => rc(q, `DELETE FROM "Invitation" WHERE "id" = 'inv_A'`),
    { value: 1 },
  );

  await tcase(
    "T06d",
    "ADMIN cannot create an OWNER invitation",
    "app_user",
    A("u_adminA"),
    (q) =>
      q(
        `INSERT INTO "Invitation" ("id","organizationId","email","role","token","expiresAt","invitedById") VALUES ('inv_o','org_A','x@example.edu','OWNER','h2','2030-01-01','u_adminA')`,
      ),
    { error: "42501" },
  );

  await tcase(
    "T07",
    "MEMBER UPDATE of Organization affects 0 rows",
    "app_user",
    A("u_memberA"),
    (q) => rc(q, `UPDATE "Organization" SET "name" = 'hijacked' WHERE "id" = 'org_A'`),
    { value: 0 },
  );

  await tcase(
    "T08a",
    "MEMBER cannot set their own role to OWNER (policy: 0 rows)",
    "app_user",
    A("u_memberA"),
    async (q) => ({
      updated: await rc(q, `UPDATE "Membership" SET "role" = 'OWNER' WHERE "userId" = 'u_memberA'`),
      role_after: (await q(`SELECT "role" FROM "Membership" WHERE "userId" = 'u_memberA'`)).rows[0]
        .role,
    }),
    { value: { updated: 0, role_after: "MEMBER" } },
  );

  await tcase(
    "T08b",
    "MEMBER cannot INSERT an OWNER membership for anyone",
    "app_user",
    A("u_memberA"),
    (q) =>
      q(
        `INSERT INTO "Membership" ("id","userId","organizationId","role") VALUES ('m_x','u_memberB','org_A','OWNER')`,
      ),
    { error: "42501" },
  );
  await tcase(
    "T08c",
    "D6: even an ADMIN cannot INSERT any Membership (no app_user INSERT)",
    "app_user",
    A("u_adminA"),
    (q) =>
      q(
        `INSERT INTO "Membership" ("id","userId","organizationId","role") VALUES ('m_x2','u_invitee','org_A','MEMBER')`,
      ),
    { error: "42501" },
  );
  await tcase(
    "T08d",
    "D6: the service path creates a membership only for the joining user",
    "app_service",
    { user: "u_invitee", org: "org_A" },
    async (q) => ({
      for_self: await tryq(
        q,
        `INSERT INTO "Membership" ("id","userId","organizationId","role") VALUES ('m_inv','u_invitee','org_A','MEMBER')`,
      ),
      for_other: await tryq(
        q,
        `INSERT INTO "Membership" ("id","userId","organizationId","role") VALUES ('m_oth','u_memberB','org_A','MEMBER')`,
      ),
    }),
    { value: { for_self: 1, for_other: "42501" } },
  );

  await tcase(
    "T09a",
    "MEMBER DELETE of another member affects 0 rows",
    "app_user",
    A("u_memberA"),
    (q) => rc(q, `DELETE FROM "Membership" WHERE "userId" = 'u_adminA'`),
    { value: 0 },
  );

  await tcase(
    "T09b",
    "MEMBER may leave (delete own membership)",
    "app_user",
    A("u_memberA"),
    (q) =>
      rc(q, `DELETE FROM "Membership" WHERE "userId" = 'u_memberA' AND "organizationId" = 'org_A'`),
    { value: 1 },
  );

  await tcase(
    "T09c",
    "MEMBER cannot UPDATE/DELETE an event created by someone else; can edit own",
    "app_user",
    A("u_memberA"),
    async (q) => ({
      event_by_admin: await rc(q, `DELETE FROM "Event" WHERE "id" = 'e_A2'`),
      event_update_by_admin: await rc(q, `UPDATE "Event" SET "title" = 'x' WHERE "id" = 'e_A2'`),
      own_event: await rc(q, `UPDATE "Event" SET "title" = 'mine' WHERE "id" = 'e_A'`),
    }),
    { value: { event_by_admin: 0, event_update_by_admin: 0, own_event: 1 } },
  );

  // ---------------- OWNER protections (trigger) ----------------
  await tcase(
    "T10a",
    "ADMIN cannot grant OWNER to a member",
    "app_user",
    A("u_adminA"),
    (q) => q(`UPDATE "Membership" SET "role" = 'OWNER' WHERE "userId" = 'u_memberA'`),
    { error: "42501" },
  );
  await tcase(
    "T10b",
    "ADMIN cannot make themselves OWNER",
    "app_user",
    A("u_adminA"),
    (q) => q(`UPDATE "Membership" SET "role" = 'OWNER' WHERE "userId" = 'u_adminA'`),
    { error: "42501" },
  );
  await tcase(
    "T10c",
    "ADMIN cannot demote an OWNER",
    "app_user",
    A("u_adminA"),
    (q) => q(`UPDATE "Membership" SET "role" = 'MEMBER' WHERE "userId" = 'u_ownerA'`),
    { error: "42501" },
  );
  await tcase(
    "T10d",
    "ADMIN cannot remove an OWNER",
    "app_user",
    A("u_adminA"),
    (q) => q(`DELETE FROM "Membership" WHERE "userId" = 'u_ownerA'`),
    { error: "42501" },
  );
  await tcase(
    "T10e",
    "ADMIN cannot add a new OWNER membership",
    "app_user",
    A("u_adminA"),
    (q) =>
      q(
        `INSERT INTO "Membership" ("id","userId","organizationId","role") VALUES ('m_y','u_memberB','org_A','OWNER')`,
      ),
    { error: "42501" },
  );
  await tcase(
    "T10f",
    "ADMIN can promote a member to ADMIN (control)",
    "app_user",
    A("u_adminA"),
    (q) => rc(q, `UPDATE "Membership" SET "role" = 'ADMIN' WHERE "userId" = 'u_memberA'`),
    { value: 1 },
  );
  await tcase(
    "T10g",
    "Membership userId/organizationId are immutable",
    "app_user",
    A("u_adminA"),
    (q) => q(`UPDATE "Membership" SET "userId" = 'u_memberB' WHERE "userId" = 'u_memberA'`),
    { error: "42501" },
  );

  await tcase(
    "T11a",
    "OWNER can grant OWNER, then step down while another OWNER remains",
    "app_user",
    A("u_ownerA"),
    async (q) => ({
      grant: await rc(q, `UPDATE "Membership" SET "role" = 'OWNER' WHERE "userId" = 'u_memberA'`),
      step_down: await rc(
        q,
        `UPDATE "Membership" SET "role" = 'ADMIN' WHERE "userId" = 'u_ownerA'`,
      ),
    }),
    { value: { grant: 1, step_down: 1 } },
  );
  await tcase(
    "T11b",
    "the last OWNER cannot be demoted",
    "app_user",
    A("u_ownerA"),
    (q) => q(`UPDATE "Membership" SET "role" = 'ADMIN' WHERE "userId" = 'u_ownerA'`),
    { error: "23514" },
  );
  await tcase(
    "T11c",
    "the last OWNER cannot leave",
    "app_user",
    A("u_ownerA"),
    (q) => q(`DELETE FROM "Membership" WHERE "userId" = 'u_ownerA'`),
    { error: "23514" },
  );

  await tcase(
    "T12a",
    "ADMIN cannot change the org slug (OWNER-only column)",
    "app_user",
    A("u_adminA"),
    (q) => q(`UPDATE "Organization" SET "slug" = 'stolen' WHERE "id" = 'org_A'`),
    { error: "42501" },
  );
  await tcase(
    "T12b",
    "ADMIN can rename the org",
    "app_user",
    A("u_adminA"),
    (q) => rc(q, `UPDATE "Organization" SET "name" = 'Org A renamed' WHERE "id" = 'org_A'`),
    { value: 1 },
  );
  await tcase(
    "T12c",
    "OWNER can change the slug",
    "app_user",
    A("u_ownerA"),
    (q) => rc(q, `UPDATE "Organization" SET "slug" = 'fx-a2' WHERE "id" = 'org_A'`),
    { value: 1 },
  );

  // ---------------- Child tables and cross-org links ----------------
  // The assignee is a member of both orgs, so only the parent check can
  // reject. Since Phase 6 the row carries organizationId: with its own org
  // the member-of-parent-org trigger refuses the foreign task with the same
  // 23503 as a missing task (N4); claiming the other org is refused too.
  await tcase(
    "T13a",
    "TaskAssignee pointing at another org's task is rejected (same error as a missing task)",
    "app_user",
    A("u_memberA"),
    async (q) => ({
      own_org_column: await tryq(
        q,
        `INSERT INTO "TaskAssignee" ("organizationId","taskId","userId") VALUES ('org_A','t_B','u_bothAB')`,
      ),
      missing_task: await tryq(
        q,
        `INSERT INTO "TaskAssignee" ("organizationId","taskId","userId") VALUES ('org_A','t_nope','u_bothAB')`,
      ),
      foreign_org_column: await tryq(
        q,
        `INSERT INTO "TaskAssignee" ("organizationId","taskId","userId") VALUES ('org_B','t_B','u_bothAB')`,
      ),
    }),
    { value: { own_org_column: "23503", missing_task: "23503", foreign_org_column: "23503" } },
  );
  // Phase 6: TaskLabel has composite FKs to Task and Label on organizationId,
  // so another org's label on a same-org row fails the FK (23503), and a row
  // claiming the other org fails RLS (42501). Either way nothing is written.
  await tcase(
    "T13b",
    "TaskLabel with another org's label is rejected",
    "app_user",
    A("u_memberA"),
    async (q) => ({
      own_org_column: await tryq(
        q,
        `INSERT INTO "TaskLabel" ("organizationId","taskId","labelId") VALUES ('org_A','t_A','l_B')`,
      ),
      foreign_org_column: await tryq(
        q,
        `INSERT INTO "TaskLabel" ("organizationId","taskId","labelId") VALUES ('org_B','t_A','l_B')`,
      ),
      rows: await count(q, `SELECT count(*) n FROM "TaskLabel" WHERE "labelId" = 'l_B'`),
    }),
    { value: { own_org_column: "23503", foreign_org_column: "42501", rows: 0 } },
  );
  await tcase(
    "T13c",
    "PollResponse with another poll's slot is rejected",
    "app_user",
    A("u_memberA"),
    (q) =>
      q(
        `INSERT INTO "PollResponse" ("id","organizationId","pollId","slotId","userId","availability","updatedAt") VALUES ('pr_x','org_A','poll_A','s_B','u_memberA','YES',now())`,
      ),
    { error: "42501" },
  );
  await tcase(
    "T13d",
    "assigning a non-member to a task is rejected (trigger)",
    "app_user",
    A("u_memberA"),
    (q) =>
      q(
        `INSERT INTO "TaskAssignee" ("organizationId","taskId","userId") VALUES ('org_A','t_A','u_memberB')`,
      ),
    { error: "23514" },
  );
  await tcase(
    "T13e",
    "child rows of another org are invisible",
    "app_user",
    A("u_memberA"),
    async (q) => ({
      assignees: await count(q, `SELECT count(*) n FROM "TaskAssignee"`),
      attendees: await count(q, `SELECT count(*) n FROM "EventAttendee"`),
      slots: await count(q, `SELECT count(*) n FROM "PollSlot"`),
    }),
    { value: { assignees: 1, attendees: 1, slots: 1 } },
  );
  await tcase(
    "T13f",
    "MEMBER cannot respond to a poll as someone else",
    "app_user",
    A("u_memberA"),
    (q) =>
      q(
        `INSERT INTO "PollResponse" ("id","organizationId","pollId","slotId","userId","availability","updatedAt") VALUES ('pr_y','org_A','poll_A','s_A','u_adminA','YES',now())`,
      ),
    { error: "42501" },
  );

  await tcase(
    "T14a",
    "same-org trigger rejects a cross-org Transaction.eventId",
    "app_user",
    A("u_treasA"),
    (q) => q(`UPDATE "Transaction" SET "eventId" = 'e_B' WHERE "id" = 'tx_A_draft'`),
    { error: "23503" },
  );
  await tcase(
    "T14b",
    "same-org trigger rejects a foreign period+category (the updateTransaction bug)",
    "app_user",
    A("u_treasA"),
    (q) => q(`UPDATE "Transaction" SET "categoryId" = 'bc_B' WHERE "id" = 'tx_A_draft'`),
    { error: "23503" },
  );
  await tcase(
    "T14c",
    "same-org trigger also protects the service path",
    "app_service",
    A("u_adminA"),
    (q) => q(`UPDATE "Transaction" SET "eventId" = 'e_B' WHERE "id" = 'tx_A_draft'`),
    { error: "23503" },
  );
  await tcase(
    "T14d",
    "member-of-org trigger protects the service path (bulkAssign class)",
    "app_service",
    B("u_memberB"),
    (q) =>
      q(
        `INSERT INTO "TaskAssignee" ("organizationId","taskId","userId") VALUES ('org_B','t_B','u_memberA')`,
      ),
    { error: "23514" },
  );

  // ---------------- Service role fails closed ----------------
  await tcase(
    "T15a",
    "app_service without app.org_id sees nothing on tenant tables",
    "app_service",
    null,
    async (q) => {
      const out = {};
      for (const t of [
        "Task",
        "Event",
        "Note",
        "Membership",
        "Organization",
        "Transaction",
        "TaskAssignee",
        "PollSlot",
        "Receipt",
        "User",
        "Job",
      ]) {
        out[t] = await count(q, `SELECT count(*) n FROM "${t}"`);
      }
      return out;
    },
    { check: (v) => Object.values(v).every((n) => n === 0) },
  );
  await tcase(
    "T15b",
    "app_service with app.org_id=A sees only org A",
    "app_service",
    { org: "org_A" },
    async (q) => ({
      tasks: await count(q, `SELECT count(*) n FROM "Task"`),
      orgB_tasks: await count(q, `SELECT count(*) n FROM "Task" WHERE "organizationId" = 'org_B'`),
      assignees: await count(q, `SELECT count(*) n FROM "TaskAssignee"`),
      users_visible: await count(q, `SELECT count(*) n FROM "User"`),
    }),
    { value: { tasks: 2, orgB_tasks: 0, assignees: 1, users_visible: 6 } },
  );
  await tcase(
    "T15c",
    "app_service cannot write into another org than app.org_id",
    "app_service",
    { org: "org_A" },
    (q) =>
      q(
        `INSERT INTO "Task" ("id","organizationId","title","rank","createdById","updatedAt") VALUES ('t_s','org_B','x','a9','u_memberB',now())`,
      ),
    { error: "42501" },
  );
  await tcase(
    "T15d",
    "service purge: deleting an org cascades through the last-owner trigger",
    "app_service",
    { org: "org_B" },
    async (q) => {
      const deleted = await rc(q, `DELETE FROM "Organization" WHERE "id" = 'org_B'`);
      return deleted;
    },
    { value: 1 },
  );

  // ---------------- OrgSecret only through the accessor ----------------
  await tcase(
    "T16a",
    "app_user cannot SELECT OrgSecret",
    "app_user",
    A("u_ownerA"),
    (q) => q(`SELECT * FROM "OrgSecret"`),
    { error: "42501" },
  );
  await tcase(
    "T16b",
    "app_service cannot SELECT OrgSecret directly",
    "app_service",
    { org: "org_A" },
    (q) => q(`SELECT * FROM "OrgSecret"`),
    { error: "42501" },
  );
  await tcase(
    "T16c",
    "app_user cannot SELECT OrgSecret",
    "app_user",
    A("u_ownerA"),
    (q) => q(`SELECT * FROM "OrgSecret"`),
    { error: "42501" },
  );
  await tcase(
    "T16d",
    "app_service reads its org's secret via app.secret_read",
    "app_service",
    { org: "org_A" },
    async (q) =>
      (await q(`SELECT "id" FROM app.secret_read('org_A','int_A_claude','API_KEY')`)).rows.map(
        (r) => r.id,
      ),
    { value: ["sec_A"] },
  );
  await tcase(
    "T16e",
    "secret_read for another org than app.org_id is refused",
    "app_service",
    { org: "org_A" },
    (q) => q(`SELECT * FROM app.secret_read('org_B','int_B_claude','API_KEY')`),
    { error: "42501" },
  );
  await tcase(
    "T16f",
    "secret_read without app.org_id is refused",
    "app_service",
    null,
    (q) => q(`SELECT * FROM app.secret_read('org_A','int_A_claude','API_KEY')`),
    { error: "42501" },
  );
  await tcase(
    "T16g",
    "app_user (even an OWNER) has no EXECUTE on secret_read",
    "app_user",
    A("u_ownerA"),
    (q) => q(`SELECT * FROM app.secret_read('org_A','int_A_claude','API_KEY')`),
    { error: "42501" },
  );
  await tcase(
    "T16h",
    "service path writes a secret for its own org",
    "app_service",
    { user: "u_adminA", org: "org_A" },
    async (q) =>
      (
        await q(
          `SELECT app.secret_write('org_A','int_A_email','API_KEY','\\x01','\\x02','\\x03','\\x04','\\x05','\\x06',1) AS id`,
        )
      ).rows[0].id !== null,
    { value: true },
  );
  await tcase(
    "T16i",
    "app_user (even an ADMIN) has no EXECUTE on secret_write",
    "app_user",
    A("u_adminA"),
    (q) =>
      q(
        `SELECT app.secret_write('org_A','int_A_email','API_KEY','\\x01','\\x02','\\x03','\\x04','\\x05','\\x06',1)`,
      ),
    { error: "42501" },
  );
  await tcase(
    "T16j",
    "secret_write for another org than app.org_id is refused",
    "app_service",
    { org: "org_A" },
    (q) =>
      q(
        `SELECT app.secret_write('org_B','int_B_email','API_KEY','\\x01','\\x02','\\x03','\\x04','\\x05','\\x06',1)`,
      ),
    { error: "42501" },
  );
  await tcase(
    "T16k",
    "service path deletes its own org's secret",
    "app_service",
    { org: "org_A" },
    async (q) =>
      (await q(`SELECT app.secret_delete('org_A','int_A_claude','API_KEY') AS ok`)).rows[0].ok,
    { value: true },
  );
  // Phase 1: OrgSecret's composite FK (organizationId, integrationId) ->
  // OrgIntegration refuses a write naming another org's integration id
  // outright, so org_B's row can be neither overwritten nor probed.
  await tcase(
    "T16l",
    "secret_write with another org's integration id is refused; org_B's row is untouched",
    "app_service",
    { org: "org_A" },
    async (q) => ({
      write: await tryq(
        q,
        `SELECT app.secret_write('org_A','int_B_claude','API_KEY','\\x01','\\x02','\\x03','\\x04','\\x05','\\x06',1)`,
      ),
      orgA_rows: (await q(`SELECT "id" FROM app.secret_read('org_A','int_B_claude','API_KEY')`))
        .rows.length,
    }),
    { value: { write: "23503", orgA_rows: 0 } },
  );
  await tcase(
    "T16l2",
    "org_B's secret still holds its original ciphertext",
    "owner",
    null,
    async (q) =>
      (await q(`SELECT encode("ciphertext", 'hex') c FROM "OrgSecret" WHERE "id" = 'sec_B'`))
        .rows[0].c,
    { value: "11" },
  );
  await tcase(
    "T16m",
    "app_user has no EXECUTE on secret_delete",
    "app_user",
    A("u_ownerA"),
    (q) => q(`SELECT app.secret_delete('org_A','int_A_claude','API_KEY')`),
    { error: "42501" },
  );

  // ---------------- Outbox contract ----------------
  await tcase(
    "T17a",
    "MEMBER enqueues (no direct INSERT), cannot read jobs; ADMIN can",
    "app_user",
    A("u_memberA"),
    async (q) => {
      const id = (
        await q(`SELECT app.enqueue_job('org_A','notify-email','notify-email:n1','{}') AS id`)
      ).rows[0].id;
      const memberSees = await count(q, `SELECT count(*) n FROM "Job"`);
      await q(`SELECT set_config('app.user_id','u_adminA',true)`);
      const adminSees = await count(q, `SELECT count(*) n FROM "Job"`);
      return { enqueued: id !== null, memberSees, adminSees };
    },
    { value: { enqueued: true, memberSees: 0, adminSees: 1 } },
  );
  await tcase(
    "T17b",
    "direct INSERT into Job is denied for app_user",
    "app_user",
    A("u_memberA"),
    (q) => q(`INSERT INTO "Job" ("organizationId","kind","dedupeKey") VALUES ('org_A','x','x')`),
    { error: "42501" },
  );
  await tcase(
    "T17c",
    "enqueue for another org is refused",
    "app_user",
    A("u_memberA"),
    (q) => q(`SELECT app.enqueue_job('org_B','gcal','gcal:e_B','{}')`),
    { error: "42501" },
  );
  await tcase(
    "T17d",
    "coalesce, claim, CAS, rerun-while-running, re-enqueue after DONE",
    "app_service",
    { org: "org_A" },
    async (q) => {
      const s = {};
      await q(
        `SELECT app.enqueue_job('org_A','gcal','gcal:e_A','{"v":1}', (now() AT TIME ZONE 'UTC')::timestamp - interval '1 minute')`,
      );
      await q(`SELECT app.enqueue_job('org_A','gcal','gcal:e_A','{"v":2}')`);
      s.rows_after_duplicate = await count(
        q,
        `SELECT count(*) n FROM "Job" WHERE "dedupeKey" = 'gcal:e_A'`,
      );
      const claimed = (await q(`SELECT * FROM app.claim_jobs('{"gcal": 120}'::jsonb, 10)`)).rows;
      s.claimed = claimed.length;
      s.payload_at_claim = claimed[0].payload.v;
      // Computed in SQL: node-pg parses TIMESTAMP WITHOUT TIME ZONE as local time.
      s.lease_seconds = Math.round(
        Number(
          (
            await q(
              `SELECT extract(epoch FROM "lockedUntil" - app.utc_now()) s FROM "Job" WHERE id=$1`,
              [claimed[0].id],
            )
          ).rows[0].s,
        ),
      );
      s.second_claim = (
        await q(`SELECT * FROM app.claim_jobs('{"gcal": 120}'::jsonb, 10)`)
      ).rows.length;
      await q(`SELECT app.enqueue_job('org_A','gcal','gcal:e_A','{"v":3}')`);
      s.rerun_flag = (
        await q(`SELECT "rerunRequested" r FROM "Job" WHERE "dedupeKey"='gcal:e_A'`)
      ).rows[0].r;
      s.wrong_token = (
        await q(`SELECT app.finish_job($1,'not-the-token','DONE') ok`, [claimed[0].id])
      ).rows[0].ok;
      s.right_token = (
        await q(`SELECT app.finish_job($1,$2,'DONE') ok`, [claimed[0].id, claimed[0].lockToken])
      ).rows[0].ok;
      s.status_after_rerun = (
        await q(`SELECT status FROM "Job" WHERE "id"=$1`, [claimed[0].id])
      ).rows[0].status;
      const again = (await q(`SELECT * FROM app.claim_jobs('{"gcal": 120}'::jsonb, 10)`)).rows;
      s.payload_on_rerun = again[0].payload.v;
      await q(`SELECT app.finish_job($1,$2,'DONE')`, [again[0].id, again[0].lockToken]);
      s.final_status = (
        await q(`SELECT status FROM "Job" WHERE "id"=$1`, [again[0].id])
      ).rows[0].status;
      await q(`SELECT app.enqueue_job('org_A','gcal','gcal:e_A','{"v":4}')`);
      s.rows_after_reenqueue = await count(
        q,
        `SELECT count(*) n FROM "Job" WHERE "dedupeKey" = 'gcal:e_A'`,
      );
      return s;
    },
    {
      check: (s) =>
        s.rows_after_duplicate === 1 &&
        s.claimed === 1 &&
        s.payload_at_claim === 2 &&
        s.lease_seconds >= 110 &&
        s.lease_seconds <= 125 &&
        s.second_claim === 0 &&
        s.rerun_flag === true &&
        s.wrong_token === false &&
        s.right_token === true &&
        s.status_after_rerun === "PENDING" &&
        s.payload_on_rerun === 3 &&
        s.final_status === "DONE" &&
        s.rows_after_reenqueue === 2,
    },
  );
  await tcase(
    "T17e",
    "once-key after DONE is refused; retry backoff; DEAD after maxAttempts; error truncated",
    "owner",
    null,
    async (q) => {
      const s = {};
      await q(
        `INSERT INTO "Job" ("organizationId","kind","dedupeKey","status") VALUES ('org_A','digest','digest:k1','DONE')`,
      );
      s.once_after_done = (
        await q(`SELECT app.enqueue_job('org_A','digest','digest:k1','{}', NULL, 8, true) id`)
      ).rows[0].id;
      await q(`SELECT app.enqueue_job('org_A','claude-parse','parse:1','{}', NULL, 2)`);
      let j = (await q(`SELECT * FROM app.claim_jobs('{"claude-parse": 600}'::jsonb, 1)`)).rows[0];
      await q(`SELECT app.finish_job($1,$2,'RETRY',$3)`, [j.id, j.lockToken, "x".repeat(2000)]);
      const r1 = (
        await q(
          `SELECT status, attempts, length("lastError") len, ("runAt" > (now() AT TIME ZONE 'UTC')) later FROM "Job" WHERE id=$1`,
          [j.id],
        )
      ).rows[0];
      s.after_retry = `${r1.status}/${r1.attempts}/${r1.len}/${r1.later}`;
      await q(
        `UPDATE "Job" SET "runAt" = (now() AT TIME ZONE 'UTC') - interval '1 second' WHERE id=$1`,
        [j.id],
      );
      j = (await q(`SELECT * FROM app.claim_jobs('{"claude-parse": 600}'::jsonb, 1)`)).rows[0];
      await q(`SELECT app.finish_job($1,$2,'RETRY','boom')`, [j.id, j.lockToken]);
      s.after_max = (await q(`SELECT status FROM "Job" WHERE id=$1`, [j.id])).rows[0].status;
      return s;
    },
    { value: { once_after_done: null, after_retry: "PENDING/1/500/true", after_max: "DEAD" } },
  );
  await tcase(
    "T17f",
    "expired lease is reclaimed with a new token; the old holder's CAS fails",
    "owner",
    null,
    async (q) => {
      await q(`SELECT app.enqueue_job('org_A','export','org-export:1','{}')`);
      const first = (await q(`SELECT * FROM app.claim_jobs('{"export": 300}'::jsonb, 1)`)).rows[0];
      await q(
        `UPDATE "Job" SET "lockedUntil" = (now() AT TIME ZONE 'UTC') - interval '1 second' WHERE id=$1`,
        [first.id],
      );
      const second = (await q(`SELECT * FROM app.claim_jobs('{"export": 300}'::jsonb, 1)`)).rows[0];
      const staleFinish = (
        await q(`SELECT app.finish_job($1,$2,'DONE') ok`, [first.id, first.lockToken])
      ).rows[0].ok;
      const freshFinish = (
        await q(`SELECT app.finish_job($1,$2,'DONE') ok`, [second.id, second.lockToken])
      ).rows[0].ok;
      return {
        sameJob: first.id === second.id,
        attempts: second.attempts,
        newToken: first.lockToken !== second.lockToken,
        staleFinish,
        freshFinish,
      };
    },
    {
      value: { sameJob: true, attempts: 2, newToken: true, staleFinish: false, freshFinish: true },
    },
  );
  await tcase(
    "T17g",
    "dedupe index is per org and NULLS NOT DISTINCT (Prisma cannot express it; its diff ignores it)",
    "owner",
    null,
    async (q) => {
      const r = (
        await q(`SELECT i.indnullsnotdistinct n, i.indisunique u, pg_get_indexdef(i.indexrelid) d FROM pg_index i
                         WHERE i.indexrelid = 'public."Job_organizationId_dedupeKey_active_key"'::regclass`)
      ).rows[0];
      return {
        nullsNotDistinct: r.n,
        unique: r.u,
        perOrg: r.d.includes('("organizationId", "dedupeKey")'),
        partial: r.d.includes("WHERE (status = ANY"),
      };
    },
    { value: { nullsNotDistinct: true, unique: true, perOrg: true, partial: true } },
  );
  await tcase(
    "T17h",
    "D2: a MEMBER's due-date change enqueues a new reminder key; cancel_job stays admin/service-only",
    "app_user",
    A("u_memberA"),
    async (q) => {
      const k1 = "task-reminder:t_A:2026-10-01T17:00:u_memberA";
      const k2 = "task-reminder:t_A:2026-10-03T17:00:u_memberA";
      await q(`UPDATE "Task" SET "dueDate" = '2026-10-01 17:00' WHERE "id" = 't_A'`);
      const id1 = (
        await q(
          `SELECT app.enqueue_job('org_A','task-reminder',$1,'{"taskId":"t_A"}','2026-09-30 17:00') id`,
          [k1],
        )
      ).rows[0].id;
      await q(`UPDATE "Task" SET "dueDate" = '2026-10-03 17:00' WHERE "id" = 't_A'`);
      const id2 = (
        await q(
          `SELECT app.enqueue_job('org_A','task-reminder',$1,'{"taskId":"t_A"}','2026-10-02 17:00') id`,
          [k2],
        )
      ).rows[0].id;
      const member_cancel = await tryq(q, `SELECT app.cancel_job('org_A', $1)`, [k1]);
      await q(`SELECT app.set_context('u_adminA','org_A')`);
      const pending = await count(
        q,
        `SELECT count(*) n FROM "Job" WHERE "kind" = 'task-reminder' AND "status" = 'PENDING'`,
      );
      return {
        first: !!id1,
        second: !!id2,
        distinct: id1 !== id2,
        member_cancel,
        pending_seen_by_admin: pending,
      };
    },
    {
      value: {
        first: true,
        second: true,
        distinct: true,
        member_cancel: "42501",
        pending_seen_by_admin: 2,
      },
    },
  );

  // ---------------- User and UserCredential ----------------
  await tcase(
    "T18a",
    "User visibility: self, co-members and former members of the current org only",
    "app_user",
    A("u_memberA"),
    async (q) => (await q(`SELECT "id" FROM "User" ORDER BY "id"`)).rows.map((r) => r.id),
    { value: ["u_adminA", "u_bothAB", "u_formerA", "u_memberA", "u_ownerA", "u_treasA"] },
  );
  await tcase(
    "T18b",
    "a task by a former member still joins to its author (Prisma required relation)",
    "app_user",
    A("u_memberA"),
    async (q) =>
      (
        await q(
          `SELECT u."name" FROM "Task" t JOIN "User" u ON u."id" = t."createdById" WHERE t."id" = 't_A2'`,
        )
      ).rows.map((r) => r.name),
    { value: ["Former A"] },
  );
  await tcase(
    "T18c",
    "app_user cannot read UserCredential",
    "app_user",
    A("u_memberA"),
    (q) => q(`SELECT "passwordHash" FROM "UserCredential"`),
    { error: "42501" },
  );
  await tcase(
    "T18d",
    "app_service cannot read UserCredential",
    "app_service",
    { org: "org_A" },
    (q) => q(`SELECT * FROM "UserCredential"`),
    { error: "42501" },
  );
  await tcase(
    "T18e",
    "app_user cannot change its own email or emailVerified (column grant)",
    "app_user",
    A("u_memberA"),
    (q) => q(`UPDATE "User" SET "emailVerified" = now() WHERE "id" = 'u_memberA'`),
    { error: "42501" },
  );
  await tcase(
    "T18f",
    "app_user can edit own profile columns, not someone else's",
    "app_user",
    A("u_memberA"),
    async (q) => ({
      own: await rc(q, `UPDATE "User" SET "name" = 'Member A2' WHERE "id" = 'u_memberA'`),
      other: await rc(q, `UPDATE "User" SET "name" = 'x' WHERE "id" = 'u_adminA'`),
    }),
    { value: { own: 1, other: 0 } },
  );
  await tcase(
    "T18g",
    "app_auth resolves an ICS token hash across all users",
    "app_auth",
    null,
    async (q) =>
      (
        await q(`SELECT "userId" FROM "UserCredential" WHERE "icsTokenHash" = 'abc123hash'`)
      ).rows.map((r) => r.userId),
    { value: ["u_memberA"] },
  );
  await tcase(
    "T18h",
    "app_auth has no access to tenant tables",
    "app_auth",
    null,
    (q) => q(`SELECT count(*) FROM "Task"`),
    { error: "42501" },
  );
  await tcase(
    "T18i",
    "D3: app_user sets its OWN ICS token hash and reads 'active since'",
    "app_user",
    A("u_adminA"),
    async (q) => {
      const before = (await q(`SELECT app.ics_token_created_at() t`)).rows[0].t;
      const set = (await q(`SELECT app.set_ics_token_hash($1) t`, [HASH("a")])).rows[0].t;
      const after = (await q(`SELECT app.ics_token_created_at() t`)).rows[0].t;
      return { before_null: before === null, set: set !== null, after_set: after !== null };
    },
    { value: { before_null: true, set: true, after_set: true } },
  );
  await tcase(
    "T18j",
    "D3: set_ics_token_hash without a user context is refused",
    "app_user",
    null,
    (q) => q(`SELECT app.set_ics_token_hash($1)`, [HASH("b")]),
    { error: "42501" },
  );
  await tcase(
    "T18k",
    "D3: set_ics_token_hash rejects anything but a sha256 hex digest",
    "app_user",
    A("u_adminA"),
    (q) => q(`SELECT app.set_ics_token_hash('abc123hash')`),
    { error: "22023" },
  );
  await tcase(
    "T18l",
    "D3: the ICS functions take app_user only (0C removed the app_legacy branch)",
    "app_user",
    { user: "u_memberA" },
    async (q) => ({
      set: (await q(`SELECT app.set_ics_token_hash($1) t`, [HASH("c")])).rows[0].t !== null,
      after: (await q(`SELECT app.ics_token_created_at() t`)).rows[0].t !== null,
    }),
    { value: { set: true, after: true } },
  );
  await tcase(
    "T18m",
    "D3: app_user without a user context is refused",
    "app_user",
    null,
    (q) => q(`SELECT app.set_ics_token_hash($1)`, [HASH("d")]),
    { error: "42501" },
  );
  await tcase(
    "T18n",
    "D3: app_service has no EXECUTE on the ICS functions",
    "app_service",
    { org: "org_A" },
    (q) => q(`SELECT app.set_ics_token_hash($1)`, [HASH("e")]),
    { error: "42501" },
  );
  await tcase(
    "T18o",
    "0A purge path: app_auth deletes only old, unverified, never-member, no-Account users",
    "app_auth",
    null,
    async (q) => {
      await q(`INSERT INTO "User" ("id","email","emailVerified","createdAt") VALUES
      ('u_sq_old','sq.old@example.edu',NULL, now() - interval '4 days'),
      ('u_sq_new','sq.new@example.edu',NULL, now()),
      ('u_ver_old','ver.old@example.edu', now(), now() - interval '4 days')`);
      await q(
        `UPDATE "User" SET "emailVerified" = NULL, "createdAt" = now() - interval '4 days' WHERE "id" IN ('u_memberB','u_formerA')`,
      );
      const daily = (await q(`SELECT app.purge_unverified_users() n`)).rows[0].n;
      const byEmail = (await q(`SELECT app.purge_unverified_users(' SQ.NEW@example.edu') n`))
        .rows[0].n;
      const left = (
        await q(
          `SELECT "id" FROM "User" WHERE "id" IN ('u_sq_old','u_sq_new','u_ver_old','u_memberB','u_formerA') ORDER BY 1`,
        )
      ).rows.map((r) => r.id);
      return { daily, byEmail, left };
    },
    { value: { daily: 1, byEmail: 1, left: ["u_formerA", "u_memberB", "u_ver_old"] } },
  );
  await tcase(
    "T18p",
    "0A purge path: request code cannot call the purge",
    "app_user",
    A("u_ownerA"),
    (q) => q(`SELECT app.purge_unverified_users()`),
    { error: "42501" },
  );

  // ---------------- Other per-table rules ----------------
  await tcase(
    "T19",
    "PRIVATE notes are visible only to their author",
    "app_user",
    A("u_memberA"),
    async (q) => {
      const member = (await q(`SELECT "id" FROM "Note" ORDER BY "id"`)).rows.map((r) => r.id);
      await q(`SELECT set_config('app.user_id','u_adminA',true)`);
      const author = (await q(`SELECT "id" FROM "Note" ORDER BY "id"`)).rows.map((r) => r.id);
      return { member, author };
    },
    { value: { member: ["n_A_org"], author: ["n_A_org", "n_A_priv"] } },
  );
  await tcase(
    "T19b",
    "Note edits follow canEditNote: author or OWNER/ADMIN",
    "app_user",
    A("u_memberA"),
    async (q) => {
      const member_other = await rc(q, `UPDATE "Note" SET "title" = 'x' WHERE "id" = 'n_A_org'`);
      await q(`INSERT INTO "Note" ("id","organizationId","title","contentJson","contentText","visibility","authorId","updatedById","updatedAt")
             VALUES ('n_mine','org_A','mine','{}','','ORGANIZATION','u_memberA','u_memberA',now())`);
      const own = await rc(q, `UPDATE "Note" SET "title" = 'mine2' WHERE "id" = 'n_mine'`);
      await q(`SELECT app.set_context('u_adminA','org_A')`);
      const admin_other = await rc(q, `UPDATE "Note" SET "title" = 'y' WHERE "id" = 'n_A_org'`);
      return { member_other, own, admin_other };
    },
    { value: { member_other: 0, own: 1, admin_other: 1 } },
  );

  await tcase(
    "T20a",
    "cannot notify a user outside the org",
    "app_user",
    A("u_memberA"),
    (q) =>
      q(
        `INSERT INTO "Notification" ("id","organizationId","userId","type","title") VALUES ('nx','org_A','u_memberB','TASK_ASSIGNED','x')`,
      ),
    { error: "42501" },
  );
  await tcase(
    "T20b",
    "can notify a co-member (no RETURNING), sees only own notifications",
    "app_user",
    A("u_memberA"),
    async (q) => ({
      inserted: await rc(
        q,
        `INSERT INTO "Notification" ("id","organizationId","userId","type","title") VALUES ('ny','org_A','u_adminA','TASK_ASSIGNED','x')`,
      ),
      visible: (await q(`SELECT "id" FROM "Notification" ORDER BY "id"`)).rows.map((r) => r.id),
    }),
    { value: { inserted: 1, visible: ["notif_memberA"] } },
  );
  await tcase(
    "T20c",
    "INSERT ... RETURNING a row the actor cannot SELECT fails (why enqueue/notify avoid RETURNING)",
    "app_user",
    A("u_memberA"),
    (q) =>
      q(
        `INSERT INTO "Notification" ("id","organizationId","userId","type","title") VALUES ('nz','org_A','u_adminA','TASK_ASSIGNED','x') RETURNING "id"`,
      ),
    { error: "42501" },
  );

  await tcase(
    "T20d",
    "N5: a MEMBER writes OrgAuditLog only through app.write_org_audit (actor and time fixed by the DB)",
    "app_user",
    A("u_memberA"),
    async (q) => {
      const id = (
        await q(`SELECT app.write_org_audit('org_A','task.update','Task','t_A','{"f":"title"}') id`)
      ).rows[0].id;
      await q(`SELECT app.set_context('u_adminA','org_A')`);
      const r = (
        await q(
          `SELECT "actorId", abs(extract(epoch FROM "createdAt" - app.utc_now())) < 5 recent FROM "OrgAuditLog" WHERE "id" = $1`,
          [id],
        )
      ).rows[0];
      return { actor: r.actorId, recent: r.recent };
    },
    { value: { actor: "u_memberA", recent: true } },
  );
  await tcase(
    "T20e",
    "N5: write_org_audit for another org is refused",
    "app_user",
    A("u_memberA"),
    (q) => q(`SELECT app.write_org_audit('org_B','task.update','Task','t_B','{}')`),
    { error: "42501" },
  );
  await tcase(
    "T20f",
    "N5: write_finance_audit checks the reference and the action format",
    "app_user",
    A("u_treasA"),
    async (q) => ({
      ok:
        (await q(`SELECT app.write_finance_audit('org_A','UPDATE','tx_A_draft',NULL,'{}') id`))
          .rows[0].id !== null,
      missing: await tryq(
        q,
        `SELECT app.write_finance_audit('org_A','UPDATE','tx_nope',NULL,'{}')`,
      ),
      bad_action: await tryq(
        q,
        `SELECT app.write_finance_audit('org_A','drop table;','tx_A_draft',NULL,'{}')`,
      ),
    }),
    { value: { ok: true, missing: "23503", bad_action: "22023" } },
  );
  await tcase(
    "T20g",
    "N5: service jobs write OrgAuditLog with no actor; FinanceAuditLog needs a user",
    "app_service",
    { org: "org_A" },
    async (q) => ({
      org_audit:
        (await q(`SELECT app.write_org_audit('org_A','job.purge.scheduled') id`)).rows[0].id !==
        null,
      finance_audit: await tryq(
        q,
        `SELECT app.write_finance_audit('org_A','UPDATE','tx_A_draft',NULL,'{}')`,
      ),
    }),
    { value: { org_audit: true, finance_audit: "42501" } },
  );
  await tcase(
    "T21a",
    "FinanceAuditLog UPDATE denied for app_user",
    "app_user",
    A("u_treasA"),
    (q) => q(`UPDATE "FinanceAuditLog" SET "action" = 'x'`),
    { error: "42501" },
  );
  await tcase(
    "T21b",
    "FinanceAuditLog DELETE denied on the service path too (migration 20260913223951)",
    "app_service",
    A("u_ownerA"),
    (q) => q(`DELETE FROM "FinanceAuditLog"`),
    { error: "42501" },
  );

  await tcase(
    "T22a",
    "submitter cannot self-approve",
    "app_user",
    A("u_memberA"),
    (q) =>
      q(
        `UPDATE "Transaction" SET "status" = 'APPROVED', "approvedById" = 'u_memberA' WHERE "id" = 'tx_A_sub'`,
      ),
    { error: "42501" },
  );
  await tcase(
    "T22b",
    "treasurer approves someone else's expense",
    "app_user",
    A("u_treasA"),
    (q) =>
      rc(
        q,
        `UPDATE "Transaction" SET "status" = 'APPROVED', "approvedById" = 'u_treasA' WHERE "id" = 'tx_A_sub'`,
      ),
    { value: 1 },
  );
  await tcase(
    "T22c",
    "treasurer cannot approve their own expense",
    "app_user",
    A("u_treasA"),
    (q) =>
      q(
        `UPDATE "Transaction" SET "status" = 'APPROVED', "approvedById" = 'u_treasA' WHERE "id" = 'tx_A_treas'`,
      ),
    { error: "42501" },
  );
  await tcase(
    "T22d",
    "no hard deletes of transactions",
    "app_user",
    A("u_ownerA"),
    (q) => q(`DELETE FROM "Transaction" WHERE "id" = 'tx_A_draft'`),
    { error: "42501" },
  );
  await tcase(
    "T22e",
    "MEMBER cannot create a budget category (finance-only writes)",
    "app_user",
    A("u_memberA"),
    (q) =>
      q(
        `INSERT INTO "BudgetCategory" ("id","organizationId","budgetPeriodId","name","allocatedCents") VALUES ('bc_x','org_A','bp_A','x',1)`,
      ),
    { error: "42501" },
  );
  await tcase(
    "T22f",
    "separation of duties, legitimate flow: submit, approve, reimburse, reconcile, unlock, reject",
    "app_user",
    A("u_memberA"),
    async (q) => {
      const s = {};
      s.submit = await rc(
        q,
        `UPDATE "Transaction" SET "status" = 'SUBMITTED' WHERE "id" = 'tx_A_draft'`,
      );
      await q(`SELECT app.set_context('u_treasA','org_A')`);
      s.approve = await rc(
        q,
        `UPDATE "Transaction" SET "status" = 'APPROVED', "approvedById" = 'u_treasA', "approvedAt" = now() WHERE "id" = 'tx_A_sub'`,
      );
      s.reimburse = await rc(
        q,
        `UPDATE "Transaction" SET "status" = 'REIMBURSED', "reimbursedAt" = now() WHERE "id" = 'tx_A_sub'`,
      );
      s.reconcile = await rc(
        q,
        `UPDATE "Transaction" SET "reconciledAt" = now(), "reconciledById" = 'u_treasA' WHERE "id" = 'tx_A_sub'`,
      );
      s.unlock = await rc(
        q,
        `UPDATE "Transaction" SET "reconciledAt" = NULL, "reconciledById" = NULL WHERE "id" = 'tx_A_sub'`,
      );
      s.reject = await rc(
        q,
        `UPDATE "Transaction" SET "status" = 'REJECTED', "rejectionReason" = 'dup' WHERE "id" = 'tx_A_draft'`,
      );
      await q(`SELECT app.set_context('u_ownerA','org_A')`);
      s.owner_approves_treasurer = await rc(
        q,
        `UPDATE "Transaction" SET "status" = 'APPROVED', "approvedById" = 'u_ownerA' WHERE "id" = 'tx_A_treas'`,
      );
      return s;
    },
    {
      value: {
        submit: 1,
        approve: 1,
        reimburse: 1,
        reconcile: 1,
        unlock: 1,
        reject: 1,
        owner_approves_treasurer: 1,
      },
    },
  );

  await tcase(
    "T23",
    "receipts follow canAccessTransaction",
    "app_user",
    A("u_memberA"),
    async (q) => {
      const member = await count(q, `SELECT count(*) n FROM "Receipt"`);
      await q(`SELECT set_config('app.user_id','u_treasA',true)`);
      const treasurer = await count(q, `SELECT count(*) n FROM "Receipt"`);
      return { member, treasurer };
    },
    { value: { member: 0, treasurer: 1 } },
  );

  // 0C closed the strangler window: app_legacy held FOR ALL USING(true)
  // policies on 23 tables, so row-level security was effectively off for
  // it. The role now holds nothing here, and nothing connects as it.
  await tcase(
    "T24",
    "app_legacy holds no policy, no table grant and no function EXECUTE in this database",
    "owner",
    null,
    async (q) => ({
      policies: await count(q, `SELECT count(*) n FROM pg_policies WHERE 'app_legacy' = ANY(roles)`),
      tables: await count(
        q,
        `SELECT count(*) n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
          WHERE ns.nspname = 'public' AND c.relkind IN ('r','p')
            AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_legacy')
            AND (has_any_column_privilege('app_legacy', c.oid, 'SELECT')
              OR has_any_column_privilege('app_legacy', c.oid, 'INSERT')
              OR has_any_column_privilege('app_legacy', c.oid, 'UPDATE')
              OR has_table_privilege('app_legacy', c.oid, 'DELETE'))`,
      ),
      functions: await count(
        q,
        `SELECT count(*) n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
          WHERE ns.nspname = 'app' AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_legacy')
            AND has_function_privilege('app_legacy', p.oid, 'EXECUTE')`,
      ),
    }),
    { value: { policies: 0, tables: 0, functions: 0 } },
  );

  await tcase(
    "T25",
    "rate limiter (serviceDb): third hit in a window with limit 2 is refused",
    "app_service",
    null,
    async (q) => {
      const r = [];
      for (let i = 0; i < 3; i++)
        r.push((await q(`SELECT allowed FROM app.rate_limit_hit('test:k',2,60)`)).rows[0].allowed);
      return r;
    },
    { value: [true, true, false] },
  );
  await tcase(
    "T25b",
    "rate limiter: app_user has no EXECUTE (N6)",
    "app_user",
    A("u_memberA"),
    (q) => q(`SELECT * FROM app.rate_limit_hit('signin:victim@example.edu',1,60)`),
    { error: "42501" },
  );

  await tcase(
    "T26a",
    "invite token lookup is a service-only definer function",
    "app_service",
    null,
    async (q) =>
      (await q(`SELECT "organizationId", "orgSlug" FROM app.invitation_by_token_hash('tokhash_A')`))
        .rows,
    { value: [{ organizationId: "org_A", orgSlug: "fx-a" }] },
  );
  await tcase(
    "T26b",
    "app_user cannot call the invite lookup",
    "app_user",
    A("u_memberA"),
    (q) => q(`SELECT * FROM app.invitation_by_token_hash('tokhash_A')`),
    { error: "42501" },
  );
  await tcase(
    "T26c",
    "org creation on the service path: bootstrap OWNER for the creator only",
    "app_service",
    { user: "u_memberB", org: "org_new" },
    async (q) => {
      await q(`INSERT INTO "Organization" ("id","name","slug") VALUES ('org_new','New','fx-new')`);
      await q(
        `INSERT INTO "Membership" ("id","userId","organizationId","role") VALUES ('m_new','u_memberB','org_new','OWNER')`,
      );
      return await count(q, `SELECT count(*) n FROM "Membership"`);
    },
    { value: 1 },
  );
  await tcase(
    "T26d",
    "service path cannot make someone else OWNER of a new org",
    "app_service",
    { user: "u_memberB", org: "org_new2" },
    async (q) => {
      await q(
        `INSERT INTO "Organization" ("id","name","slug") VALUES ('org_new2','New2','fx-new2')`,
      );
      await q(
        `INSERT INTO "Membership" ("id","userId","organizationId","role") VALUES ('m_new2','u_memberA','org_new2','OWNER')`,
      );
    },
    { error: "42501" },
  );

  await tcase(
    "T26e",
    "D4: app.member_tier() is the caller's Role in the member org, else NULL",
    "app_user",
    A("u_memberA"),
    async (q) => {
      const t = async (u, o) => {
        await q(`SELECT app.set_context($1,$2)`, [u, o]);
        return (await q(`SELECT app.member_tier() t`)).rows[0].t;
      };
      return {
        member: await t("u_memberA", "org_A"),
        owner: await t("u_ownerA", "org_A"),
        treasurer: await t("u_treasA", "org_A"),
        non_member_org: await t("u_memberA", "org_B"),
        no_org: await t("u_memberA", ""),
        no_user: await t("", "org_A"),
      };
    },
    {
      value: {
        member: "MEMBER",
        owner: "OWNER",
        treasurer: "TREASURER",
        non_member_org: null,
        no_org: null,
        no_user: null,
      },
    },
  );
  await tcase(
    "T26f",
    "D4: member_tier on the service path with a user; NULL without one",
    "app_service",
    { user: "u_adminA", org: "org_A" },
    async (q) => {
      const withUser = (await q(`SELECT app.member_tier() t`)).rows[0].t;
      await q(`SELECT app.set_context(NULL, 'org_A')`);
      return { withUser, withoutUser: (await q(`SELECT app.member_tier() t`)).rows[0].t };
    },
    { value: { withUser: "ADMIN", withoutUser: null } },
  );
  await tcase(
    "T31",
    "a runtime role cannot SET ROLE into another app role",
    "app_user",
    A("u_memberA"),
    (q) => q(`SET ROLE app_service`),
    { error: "42501" },
  );

  // Two OWNERs demote each other concurrently. The advisory lock in the
  // trigger serializes them; the second must fail instead of leaving zero owners.
  {
    const c1 = await connect("app_user");
    const c2 = await connect("app_user");
    let second;
    try {
      await clients.owner.query(`UPDATE "Membership" SET "role" = 'OWNER' WHERE "id" = 'm_adminA'`); // second owner, committed
      await c1.query("BEGIN");
      await c1.query("SELECT app.set_context('u_ownerA','org_A')");
      await c2.query("BEGIN");
      await c2.query("SELECT app.set_context('u_adminA','org_A')");
      await c1.query(
        `UPDATE "Membership" SET "role" = 'MEMBER' WHERE "userId" = 'u_adminA' AND "organizationId" = 'org_A'`,
      );
      const p2 = c2
        .query(
          `UPDATE "Membership" SET "role" = 'MEMBER' WHERE "userId" = 'u_ownerA' AND "organizationId" = 'org_A'`,
        )
        .then(
          () => "succeeded",
          (e) => e.code,
        );
      await new Promise((r) => setTimeout(r, 300)); // c2 is now blocked on the org lock
      await c1.query("COMMIT");
      second = await p2;
      await c2.query("ROLLBACK").catch(() => {});
      const owners = (
        await clients.owner.query(
          `SELECT count(*)::int n FROM "Membership" WHERE "organizationId"='org_A' AND role='OWNER'`,
        )
      ).rows[0].n;
      const pass = second === "42501" && owners === 1;
      record(
        pass,
        `T30 [app_user x2] concurrent mutual OWNER demotion: second tx -> ${second}, owners left = ${owners}`,
      );
    } finally {
      // restore fixture state
      await clients.owner.query(`UPDATE "Membership" SET "role" = 'ADMIN' WHERE "id" = 'm_adminA'`);
      await clients.owner.query(`UPDATE "Membership" SET "role" = 'OWNER' WHERE "id" = 'm_ownerA'`);
      await c1.end();
      await c2.end();
    }
  }

  // Why ENABLE and not FORCE: with a non-superuser owner (Neon), FORCE puts
  // the owner under RLS with no policy of its own, so the owner-run helpers
  // see zero Membership rows and every tenant check fails closed. (A local
  // superuser bypasses RLS even under FORCE, so this only proves anything
  // when OWNER_USER is a non-superuser such as sim_owner.)
  await tcase(
    "T32",
    "FORCE would blind the SECURITY DEFINER helpers (non-superuser owner)",
    "owner",
    A("u_memberA"),
    async (q) => {
      const sup = (await q(`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`)).rows[0]
        .rolsuper;
      if (sup)
        return {
          skipped:
            "owner is a superuser, which bypasses RLS even under FORCE; run pnpm test:rls without RLS_SUPERUSER_OWNER",
        };
      const before = (await q(`SELECT app.member_org_id() v`)).rows[0].v;
      await q(`ALTER TABLE "Membership" FORCE ROW LEVEL SECURITY`);
      const after = (await q(`SELECT app.member_org_id() v`)).rows[0].v;
      return { before, after };
    },
    { check: (v) => v.before === "org_A" && v.after === null },
  );

  // GUCs are bound to their transaction (N8): after COMMIT a reused pooled
  // connection sees no context, and a context leaked by a session-level
  // set_config(..., false) is dead in the next transaction.
  {
    const c = await connect("app_user");
    const n = async () => Number((await c.query(`SELECT count(*) n FROM "Task"`)).rows[0].n);
    try {
      await c.query("BEGIN");
      await c.query("SELECT app.set_context('u_memberA','org_A')");
      const inTx = await n();
      await c.query("COMMIT");
      const afterCommit = await n();
      await c.query("BEGIN");
      await c.query(`SELECT set_config('app.user_id','u_memberA',false), set_config('app.org_id','org_A',false),
                            set_config('app.ctx_tx', (extract(epoch FROM transaction_timestamp())*1000000)::bigint::text, false)`);
      const leakTx = await n();
      await c.query("COMMIT");
      const afterLeak = await n();
      const uid = (await c.query("SELECT app.user_id() u")).rows[0].u;
      const pass =
        inTx === 2 && afterCommit === 0 && leakTx === 2 && afterLeak === 0 && uid === null;
      record(
        pass,
        `T02b [app_user] GUCs after COMMIT and after a session-level leak -> ${JSON.stringify({ inTx, afterCommit, leakTx, afterLeak, uid })}`,
      );
    } finally {
      await c.end();
    }
  }

  // ---------------- Catalog manifest (drift guard) ----------------
  // app.security_manifest() (0B Section 9) is the single source of truth
  // for the catalog rules; CI asserts it is empty (T27a) and that it still
  // detects every class of mistake (T27b). T27j-n pin its scope: object
  // checks cover what a runtime role can reach (a Supabase project's auth,
  // storage and realtime schemas are out of it), role checks cover every
  // schema. T27c-f pin the reviewed lists.
  await tcase(
    "T27a",
    "app.security_manifest() reports no violations",
    "owner",
    null,
    async (q) =>
      (
        await q(
          `SELECT check_name || ' ' || object_name AS v FROM app.security_manifest() ORDER BY 1`,
        )
      ).rows.map((r) => r.v),
    { value: [] },
  );
  await tcase(
    "T27b",
    "the manifest detects each planted class of mistake (and passes an invoker view)",
    "owner",
    null,
    async (q) => {
      await q(`CREATE VIEW public.zz_view AS SELECT "id" FROM "Task"`);
      await q(`GRANT SELECT ON public.zz_view TO app_user`);
      await q(`CREATE VIEW public.zz_ok WITH (security_invoker = true) AS SELECT "id" FROM "Task"`);
      await q(`GRANT SELECT ON public.zz_ok TO app_user`);
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
      await q(
        `DO $$ BEGIN EXECUTE format('GRANT TEMPORARY ON DATABASE %I TO app_auth', current_database()); END $$`,
      );
      await q(`GRANT CREATE ON SCHEMA app TO app_service`);
      return (
        await q(
          `SELECT check_name || ' ' || object_name AS v FROM app.security_manifest() ORDER BY 1`,
        )
      ).rows.map((r) => r.v);
    },
    {
      value: [
        'dangerous_privilege public."Event":app_service:TRIGGER',
        'dangerous_privilege public."Note":app_auth:REFERENCES',
        'dangerous_privilege public."Task":app_user:TRUNCATE',
        "definer_search_path app.zz_def()",
        "matview_or_foreign_granted public.zz_mat",
        "policy_gap public.zz_part:app_user:SELECT",
        "policy_gap zz_s.t:app_user:SELECT",
        "public_execute public.zz_pub()",
        "rls_disabled public.zz_part",
        "rls_disabled zz_s.t",
        "schema_create app:app_service",
        "temp_privilege app_auth",
        "view_not_invoker public.zz_view",
      ],
    },
  );
  // Split out of T27b: planting a role membership needs ADMIN OPTION on
  // app_service, which a non-superuser owner has only when it created the
  // roles (a fresh cluster, as in CI). Otherwise SKIP, never PASS.
  await tcase(
    "T27b2",
    "the manifest detects a runtime role that is a member of another role",
    "owner",
    null,
    async (q) => {
      const can = (
        await q(`SELECT rolsuper OR pg_has_role(current_user, 'app_service', 'MEMBER WITH ADMIN OPTION') ok
                           FROM pg_roles WHERE rolname = current_user`)
      ).rows[0].ok;
      if (!can)
        return {
          skipped:
            "the owner has no ADMIN OPTION on app_service (roles pre-created by another role); covered in CI",
        };
      await q(`GRANT app_service TO app_user`);
      return (
        await q(
          `SELECT check_name || ' ' || object_name AS v FROM app.security_manifest() ORDER BY 1`,
        )
      ).rows.map((r) => r.v);
    },
    { value: ["role_membership app_user in app_service"] },
  );

  // The manifest's scope (20260927120000_security_manifest_reachable_schemas).
  // zz_supa stands in for a Supabase-managed schema (auth, storage,
  // realtime, ...): a table without RLS, a PUBLIC-executable function and a
  // definer function without the pinned search_path (like
  // pgbouncer.get_auth()), and no USAGE for any runtime role.
  const manifestRows = async (q, like) =>
    (
      await q(
        `SELECT check_name || ' ' || object_name AS v FROM app.security_manifest()
          WHERE $1::text IS NULL OR object_name LIKE $1 ORDER BY 1`,
        [like ?? null],
      )
    ).rows.map((r) => r.v);
  const plantSupabaseLike = async (q, schema) => {
    await q(`CREATE SCHEMA ${schema}`);
    await q(`CREATE TABLE ${schema}.t (id int)`);
    await q(`CREATE FUNCTION ${schema}.f() RETURNS int LANGUAGE sql AS 'SELECT 1'`);
    await q(`GRANT EXECUTE ON FUNCTION ${schema}.f() TO PUBLIC`);
    await q(
      `CREATE FUNCTION ${schema}.d() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = '' AS 'SELECT 1'`,
    );
  };
  await tcase(
    "T27j",
    "a schema no runtime role can USE is out of the object checks, and back in the moment one can",
    "owner",
    null,
    async (q) => {
      await plantSupabaseLike(q, "zz_supa");
      const s = {};
      s.no_usage = await manifestRows(q);
      await q(`GRANT USAGE ON SCHEMA zz_supa TO app_user`);
      s.app_user_usage = await manifestRows(q, "zz_supa.%");
      // USAGE through PUBLIC counts as well.
      await q(`REVOKE USAGE ON SCHEMA zz_supa FROM app_user`);
      await q(`GRANT USAGE ON SCHEMA zz_supa TO PUBLIC`);
      s.public_usage = await manifestRows(q, "zz_supa.%");
      return s;
    },
    {
      value: {
        no_usage: [],
        app_user_usage: [
          "definer_search_path zz_supa.d()",
          "public_execute zz_supa.f()",
          "rls_disabled zz_supa.t",
        ],
        public_usage: [
          "definer_search_path zz_supa.d()",
          "public_execute zz_supa.f()",
          "rls_disabled zz_supa.t",
        ],
      },
    },
  );
  await tcase(
    "T27k",
    "CREATE and TRUNCATE held by a runtime role are reported even in a schema no runtime role can USE",
    "owner",
    null,
    async (q) => {
      await plantSupabaseLike(q, "zz_supa");
      // CREATE needs no USAGE: a function planted in a schema on someone
      // else's search_path is picked up by the roles that can USE it.
      await q(`GRANT CREATE ON SCHEMA zz_supa TO app_auth`);
      await q(`GRANT TRUNCATE ON zz_supa.t TO app_user`);
      return await manifestRows(q);
    },
    {
      value: ["dangerous_privilege zz_supa.t:app_user:TRUNCATE", "schema_create zz_supa:app_auth"],
    },
  );
  // Why schema_create stays global: CREATE without USAGE is enough to plant
  // an object. Committed, because app_auth has to see the schema from its
  // own connection; dropped in the finally (the schema owner may drop what
  // app_auth created in it).
  {
    const o = clients.owner;
    const a = clients.app_auth;
    const v = {};
    try {
      await o.query(`CREATE SCHEMA zz_create`);
      await o.query(`GRANT CREATE ON SCHEMA zz_create TO app_auth`);
      v.usage = (await a.query(`SELECT has_schema_privilege('zz_create', 'USAGE') u`)).rows[0].u;
      v.plant = await a
        .query(`CREATE FUNCTION zz_create.planted() RETURNS int LANGUAGE sql AS 'SELECT 1'`)
        .then(
          () => "created",
          (e) => e.code,
        );
    } catch (e) {
      v.error = `${e.code} ${e.message}`;
    } finally {
      await o.query(`DROP SCHEMA IF EXISTS zz_create CASCADE`).catch(() => {});
    }
    record(
      JSON.stringify(v) === JSON.stringify({ usage: false, plant: "created" }),
      `T27k2 [owner+app_auth] CREATE on a schema without USAGE is enough to create in it -> ${JSON.stringify(v)}`,
    );
  }
  // Committed, because app_user has to see the objects from its own
  // connection; dropped in the finally.
  {
    const o = clients.owner;
    const u = clients.app_user;
    const v = {};
    try {
      await o.query(`CREATE SCHEMA zz_hidden`);
      await o.query(`CREATE TABLE zz_hidden.t (id int)`);
      await o.query(`INSERT INTO zz_hidden.t VALUES (1)`);
      await o.query(`GRANT SELECT ON zz_hidden.t TO app_user`);
      await o.query(`CREATE FUNCTION zz_hidden.f() RETURNS int LANGUAGE sql AS 'SELECT 1'`);
      await o.query(`GRANT EXECUTE ON FUNCTION zz_hidden.f() TO PUBLIC`);
      const planted = () => manifestRows((sql, p) => o.query(sql, p), "zz_hidden.%");
      v.planted = await planted();
      v.by_name = await u.query(`SELECT count(*)::int n FROM zz_hidden.t`).then(
        (r) => r.rows[0].n,
        (e) => e.code,
      );
      // An invoker view checks app_user's privileges on the table but never
      // its schema USAGE (the names were resolved when the view was made).
      await o.query(`CREATE VIEW public.zz_through WITH (security_invoker = true)
                       AS SELECT id, zz_hidden.f() AS f FROM zz_hidden.t`);
      await o.query(`GRANT SELECT ON public.zz_through TO app_user`);
      v.through_view = await u.query(`SELECT count(*)::int n FROM public.zz_through`).then(
        (r) => r.rows[0].n,
        (e) => e.code,
      );
      v.reached = await planted();
    } catch (e) {
      v.error = `${e.code} ${e.message}`;
    } finally {
      await o.query(`DROP VIEW IF EXISTS public.zz_through`).catch(() => {});
      await o.query(`DROP SCHEMA IF EXISTS zz_hidden CASCADE`).catch(() => {});
    }
    const expected = {
      planted: [],
      by_name: "42501",
      through_view: 1,
      reached: [
        "policy_gap zz_hidden.t:app_user:SELECT",
        "public_execute zz_hidden.f()",
        "rls_disabled zz_hidden.t",
      ],
    };
    record(
      JSON.stringify(v) === JSON.stringify(expected),
      `T27l [owner+app_user] what a reachable view uses is in scope, in any schema -> ${JSON.stringify(v)}`,
    );
  }
  {
    const admin = await connectAdmin();
    try {
      await tcase(
        "T27m",
        "an event-trigger function is in the definer check wherever it lives, and not in public_execute",
        "admin",
        null,
        async (q) => {
          const su = (await q(`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`)).rows[0]
            .rolsuper;
          if (!su)
            return { skipped: "the admin is not a superuser (CREATE EVENT TRIGGER needs one)" };
          await q(`CREATE SCHEMA zz_evt`);
          await q(`CREATE FUNCTION zz_evt.on_ddl() RETURNS event_trigger LANGUAGE plpgsql
                     SECURITY DEFINER AS $$ BEGIN END $$`);
          await q(`GRANT EXECUTE ON FUNCTION zz_evt.on_ddl() TO PUBLIC`);
          const s = {};
          s.plain_function = await manifestRows(q, "zz_evt.%");
          await q(
            `CREATE EVENT TRIGGER zz_on_ddl ON ddl_command_end EXECUTE FUNCTION zz_evt.on_ddl()`,
          );
          s.event_trigger = await manifestRows(q, "zz_evt.%");
          // The fix applied to Supabase's public.rls_auto_enable().
          await q(`ALTER FUNCTION zz_evt.on_ddl() SET search_path = pg_catalog, public, pg_temp`);
          s.fixed = await manifestRows(q, "zz_evt.%");
          return s;
        },
        {
          value: {
            plain_function: [],
            event_trigger: ["definer_search_path zz_evt.on_ddl()"],
            fixed: [],
          },
        },
        admin,
      );
    } finally {
      await admin.end();
    }
  }
  await tcase(
    "T27n",
    "app_service, the role /api/health asks, gets the same empty manifest",
    "app_service",
    null,
    async (q) => await manifestRows(q),
    { value: [] },
  );
  await tcase(
    "T27c",
    "SECURITY DEFINER functions are exactly the reviewed list (0B Section 4, Phases 1-8, A3 maintenance, B2 feed off)",
    "owner",
    null,
    async (q) =>
      (
        await q(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema') ORDER BY 1`)
      ).rows.map((r) => r.proname),
    {
      value: [
        "active_org_ids",
        "assert_member_of_parent_org",
        "assert_org_active_chart",
        "assert_org_member",
        "assert_same_org",
        "ballot_tally",
        // StoredBlob's only way in (file bytes when there's no Blob store).
        "blob_delete",
        "blob_get",
        "blob_list",
        "blob_put",
        // C4: reads "Task"/"TaskAssignee" without RLS so the task-visibility
        // policies cannot recurse into themselves. Answers only about
        // app.user_id().
        "can_read_task",
        "can_view_ballot_rows",
        "can_view_rows",
        "cancel_job",
        "claim_jobs",
        "clear_ics_token_hash",
        "enqueue_job",
        "event_defaults",
        "explode_ballot",
        "finish_job",
        "folder_in_same_org",
        "ics_token_created_at",
        "invitation_by_token_hash",
        "issue_org_creation_code",
        "list_org_creation_codes",
        "lock_org",
        "log_org_deletion",
        "member_busy_hours",
        "member_org_id",
        "member_role",
        "membership_history",
        "org_by_join_code",
        "org_has_members",
        "org_has_other_owner",
        "organization_defaults",
        "organization_slug_guard",
        "pending_invitations_for_me",
        "poll_org_id",
        // Question polls: the counts of an anonymous poll, whose other votes
        // RLS hides from members. Counts only, for the caller's member org.
        "poll_vote_counts",
        "prune_jobs",
        "prune_rate_limit_buckets",
        "purge_unverified_users",
        "rate_limit_hit",
        "redeem_org_creation_code",
        "refresh_contact_rollups",
        "refresh_lapsed",
        "resolve_org_slug",
        "secret_delete",
        "secret_read",
        "secret_write",
        "set_ics_token_hash",
        "slug_available",
        "user_has_role",
        "write_finance_audit",
        "write_org_audit",
      ],
    },
  );
  await tcase(
    "T27d",
    "no policy anywhere names a role outside the reviewed three",
    "owner",
    null,
    async (q) =>
      (
        await q(`SELECT DISTINCT unnest(roles)::text AS r FROM pg_policies
                  WHERE schemaname IN ('public','app')
                    AND NOT (roles <@ ARRAY['app_user','app_service','app_auth']::name[])
                  ORDER BY 1`)
      ).rows.map((r) => r.r),
    { value: [] },
  );
  await tcase(
    "T27h",
    "the manifest reports a write policy that tests only organizationId, unless the table is allowlisted",
    "owner",
    null,
    async (q) => {
      const tenantOnly = async () =>
        (
          await q(
            `SELECT object_name FROM app.security_manifest() WHERE check_name = 'tenant_only_write' ORDER BY 1`,
          )
        ).rows.map((r) => r.object_name);
      const s = {};
      s.clean = await tenantOnly();
      await q(`CREATE TABLE public.zz_tenant (id int, "organizationId" text)`);
      await q(`ALTER TABLE public.zz_tenant ENABLE ROW LEVEL SECURITY`);
      await q(`GRANT INSERT, UPDATE ON public.zz_tenant TO app_user`);
      // A tenant check with no role predicate: every member of the org may
      // write it. This is what Label shipped with.
      await q(`CREATE POLICY app_user_insert ON public.zz_tenant FOR INSERT TO app_user
                 WITH CHECK ("organizationId" = (SELECT app.member_org_id()))`);
      await q(`CREATE POLICY app_user_update ON public.zz_tenant FOR UPDATE TO app_user
                 USING ("organizationId" = (SELECT app.member_org_id())
                        AND (SELECT app.is_org_admin()))`);
      s.planted = await tenantOnly();
      // Adding the role predicate clears it; the allowlist is the only other
      // way, and it lives in the migration that defines the function.
      await q(`DROP POLICY app_user_insert ON public.zz_tenant`);
      await q(`CREATE POLICY app_user_insert ON public.zz_tenant FOR INSERT TO app_user
                 WITH CHECK ("organizationId" = (SELECT app.member_org_id())
                             AND (SELECT app.is_org_admin()))`);
      s.fixed = await tenantOnly();
      return s;
    },
    { value: { clean: [], planted: ["zz_tenant:INSERT"], fixed: [] } },
  );
  await tcase(
    "T27i",
    "the allowlisted tenant-only writes are exactly the reviewed set",
    "owner",
    null,
    async (q) =>
      (
        await q(`SELECT p.tablename || ':' || p.cmd AS v FROM pg_policies p
                  WHERE p.schemaname = 'public'
                    AND p.roles && ARRAY['app_user']::name[]
                    AND p.cmd IN ('INSERT','UPDATE','DELETE')
                    AND coalesce(p.qual,'') || coalesce(p.with_check,'') NOT LIKE '%is_org_admin%'
                    AND coalesce(p.qual,'') || coalesce(p.with_check,'') NOT LIKE '%is_org_owner%'
                    AND coalesce(p.qual,'') || coalesce(p.with_check,'') NOT LIKE '%is_finance%'
                  ORDER BY 1`)
      ).rows.map((r) => r.v),
    {
      // Members legitimately write all of these; Label and Project:INSERT
      // /DELETE left the list in 20260924130000_b9_tenant_write_backstop,
      // and Task:UPDATE / Task:DELETE left it in
      // 20260924140000_c4_task_visibility: their USING clauses now carry the
      // task-visibility predicate, which names is_org_admin, so a member can
      // no longer target a private task they cannot read. Task:INSERT stays
      // tenant-only (it pins createdById and a new task is always readable
      // by its creator).
      value: [
        "AvailabilityPoll:DELETE",
        "AvailabilityPoll:INSERT",
        "AvailabilityPoll:UPDATE",
        "EventAttendee:DELETE",
        "EventAttendee:INSERT",
        "EventAttendee:UPDATE",
        "MemberPrefs:INSERT",
        "MemberPrefs:UPDATE",
        "Note:INSERT",
        "NoteFolder:INSERT",
        "Notification:INSERT",
        "Notification:UPDATE",
        "OrgFile:INSERT",
        "Pin:DELETE",
        "Pin:INSERT",
        "Pin:UPDATE",
        "Poll:INSERT",
        "PollResponse:DELETE",
        "PollResponse:INSERT",
        "PollResponse:UPDATE",
        "PollSlot:DELETE",
        "PollSlot:INSERT",
        "PollSlot:UPDATE",
        "PollVote:DELETE",
        "PollVote:INSERT",
        "Project:UPDATE",
        "RecentVisit:DELETE",
        "RecentVisit:INSERT",
        "RecentVisit:UPDATE",
        "Task:INSERT",
        "TaskActivity:INSERT",
        "TaskAssignee:DELETE",
        "TaskAssignee:INSERT",
        "TaskAssignee:UPDATE",
        "TaskComment:INSERT",
        "TaskLabel:DELETE",
        "TaskLabel:INSERT",
        "TaskLabel:UPDATE",
        "TaskMention:DELETE",
        "TaskMention:INSERT",
        "TaskMention:UPDATE",
        "User:UPDATE",
        "UserAvailability:INSERT",
        "UserAvailability:UPDATE",
        "WeeklyUpdate:INSERT",
        "WeeklyUpdate:UPDATE",
      ],
    },
  );
  await tcase(
    "T27e",
    "tables with no grants to any runtime role (definer-only)",
    "owner",
    null,
    async (q) =>
      (
        await q(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
               WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname <> '_prisma_migrations'
                 AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['app_user','app_service','app_auth']) r(role)
                                 WHERE has_any_column_privilege(r.role, c.oid, 'SELECT'))
               ORDER BY 1`)
      ).rows.map((r) => r.relname),
    {
      value: [
        "OrgCreationCode",
        "OrgDeletionLog",
        "OrgSecret",
        "OrgSlugHistory",
        "RateLimitBucket",
        "StoredBlob",
      ],
    },
  );
  {
    // The reviewed EXECUTE matrix for schema app. u=app_user s=app_service a=app_auth.
    const expected = {
      // 0B
      active_org_ids: "s",
      assert_member_of_parent_org: "",
      assert_same_org: "",
      caller_org: "us",
      cancel_job: "us",
      claim_jobs: "s",
      ctx_valid: "usa",
      enqueue_job: "usa",
      finish_job: "s",
      ics_token_created_at: "u",
      immutable_columns: "",
      invitation_by_token_hash: "s",
      is_finance: "us",
      is_org_admin: "us",
      is_org_owner: "us",
      lock_org: "us",
      member_org_id: "us",
      member_role: "us",
      member_tier: "us",
      membership_guard: "",
      membership_history: "",
      org_has_members: "us",
      org_has_other_owner: "us",
      org_id: "usa",
      organization_guard: "",
      org_settings_guard: "",
      pending_invitations_for_me: "u",
      poll_org_id: "s",
      purge_unverified_users: "a",
      rate_limit_hit: "sa",
      secret_delete: "s",
      secret_read: "s",
      secret_write: "s",
      security_manifest: "s",
      set_context: "us",
      set_ics_token_hash: "u",
      transaction_guard: "",
      user_has_role: "us",
      user_id: "usa",
      utc_now: "usa",
      write_finance_audit: "us",
      write_org_audit: "us",
      // Phase 1: slug_available also serves service-path org creation; the
      // org-creation-code and deletion functions are service-only; the
      // trigger functions and org defaults have no grants.
      slug_available: "us",
      resolve_org_slug: "us",
      reserved_slugs: "",
      ensure_org_defaults: "",
      organization_defaults: "",
      organization_slug_guard: "",
      issue_org_creation_code: "s",
      list_org_creation_codes: "s",
      redeem_org_creation_code: "s",
      log_org_deletion: "s",
      // Phase 3
      assert_org_active_chart: "",
      // Phase 4a
      term_of: "us",
      event_defaults: "",
      assert_org_member: "",
      // Notes folders: trigger only.
      folder_in_same_org: "",
      // File bytes in Postgres: the storage layer on the service pool only.
      blob_put: "s",
      blob_get: "s",
      blob_delete: "s",
      blob_list: "s",
      // Phase 4b: the tier-taking functions check the org GUC themselves
      can_view_rows: "us",
      can_view_ballot_rows: "us",
      ballot_tally: "us",
      explode_ballot: "us",
      refresh_contact_rollups: "us",
      refresh_lapsed: "us",
      // A3 platform maintenance: the daily `maintenance` job (service only)
      prune_rate_limit_buckets: "s",
      prune_jobs: "s",
      // B2 profiles: the calendar card's "Turn off feed" (own row only)
      clear_ics_token_hash: "u",
      // C4 task visibility: the policy predicate, and the trigger that keeps
      // a subtask's flag equal to its parent's (trigger functions get no
      // grant; only the table owner fires them).
      can_read_task: "us",
      task_visibility_inherit: "",
      // Onboarding: "Join with invite code" (verified callers only)
      org_by_join_code: "u",
      // Another member's busy hours: never the rules, and only as the org allows
      member_busy_hours: "u",
      // Question poll results (counts only), for members of the poll's org
      poll_vote_counts: "u",
    };
    await tcase(
      "T27f",
      "EXECUTE on every app function matches the reviewed matrix (no PUBLIC)",
      "owner",
      null,
      async (q) => {
        const rows = (
          await q(`SELECT p.proname,
          (CASE WHEN has_function_privilege('app_user', p.oid, 'EXECUTE') THEN 'u' ELSE '' END ||
           CASE WHEN has_function_privilege('app_service', p.oid, 'EXECUTE') THEN 's' ELSE '' END ||
           CASE WHEN has_function_privilege('app_auth', p.oid, 'EXECUTE') THEN 'a' ELSE '' END) AS g,
          has_function_privilege('public', p.oid, 'EXECUTE') AS pub
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app' ORDER BY 1`)
        ).rows;
        const diffs = [];
        for (const r of rows) {
          if (r.pub) diffs.push(`${r.proname}: PUBLIC`);
          if (!(r.proname in expected))
            diffs.push(`${r.proname}: not in the reviewed matrix (${r.g})`);
          else if (expected[r.proname] !== r.g)
            diffs.push(`${r.proname}: ${r.g} != ${expected[r.proname]}`);
        }
        for (const k of Object.keys(expected))
          if (!rows.some((r) => r.proname === k)) diffs.push(`${k}: missing`);
        return diffs;
      },
      { value: [] },
    );
  }

  await tcase(
    "T28",
    "runtime roles: not superuser, no BYPASSRLS, own nothing",
    "owner",
    null,
    async (q) =>
      (
        await q(`SELECT r.rolname, r.rolsuper, r.rolbypassrls,
                     (SELECT count(*)::int FROM pg_class c WHERE c.relowner = r.oid) owned
                FROM pg_roles r WHERE r.rolname IN ('app_user','app_service','app_auth') ORDER BY 1`)
      ).rows.every((r) => !r.rolsuper && !r.rolbypassrls && r.owned === 0),
    { value: true },
  );

  // Documented limitation, asserted so nobody mistakes RLS for an
  // injection defence: raw SQL can forge its own GUCs.
  await tcase(
    "T29",
    "KNOWN LIMITATION: SQL that runs as app_user can forge app.user_id (injection = bypass)",
    "app_user",
    A("u_memberA"),
    async (q) => {
      await q(
        `SELECT set_config('app.user_id','u_ownerB',true), set_config('app.org_id','org_B',true)`,
      );
      return await count(q, `SELECT count(*) n FROM "Task" WHERE "organizationId" = 'org_B'`);
    },
    { value: 1 },
  );
});
