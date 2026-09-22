-- Fixtures for the RLS suites (tests.mjs, attacks.mjs, phases.mjs), applied
-- by run.mjs right after `prisma migrate deploy` and local-roles.sql.
--
-- Inserted as the table owner, which RLS does not apply to (ENABLE, not
-- FORCE) and which the privilege triggers exempt. The Membership history,
-- org-defaults, same-org and member-of-org triggers still fire, so
-- OrgMemberHistory, OrgSettings and the built-in DatabaseDefinitions are
-- populated exactly as in production.
--
-- Two orgs (A and B) with every role, a former member of A (u_formerA left
-- but keeps authorship of rows), and a user in both orgs (u_bothAB). The
-- rows of the original 0B fixture keep their ids and counts, so the ported
-- 0B cases keep their expected values; later-phase rows are added on top.
SET timezone = 'UTC';

INSERT INTO "User" ("id", "email", "name", "emailVerified") VALUES
  ('u_ownerA',  'owner.a@example.edu',  'Owner A',  CURRENT_TIMESTAMP),
  ('u_adminA',  'admin.a@example.edu',  'Admin A',  CURRENT_TIMESTAMP),
  ('u_memberA', 'member.a@example.edu', 'Member A', CURRENT_TIMESTAMP),
  ('u_treasA',  'treas.a@example.edu',  'Treasurer A', CURRENT_TIMESTAMP),
  ('u_formerA', 'former.a@example.edu', 'Former A', CURRENT_TIMESTAMP),
  ('u_ownerB',  'owner.b@example.edu',  'Owner B',  CURRENT_TIMESTAMP),
  ('u_memberB', 'member.b@example.edu', 'Member B', CURRENT_TIMESTAMP),
  ('u_invitee', 'invitee@example.edu',  'Invitee',  CURRENT_TIMESTAMP),
  ('u_bothAB',  'both@example.edu',     'Member of A and B', CURRENT_TIMESTAMP);

INSERT INTO "UserCredential" ("userId", "passwordHash", "icsTokenHash", "updatedAt") VALUES
  ('u_memberA', '$2b$10$fixturefixturefixturefixtureuO', 'abc123hash', CURRENT_TIMESTAMP);

-- The organization_defaults trigger creates each org's OrgSettings row and
-- its five built-in DatabaseDefinitions.
INSERT INTO "Organization" ("id", "name", "slug", "timezone") VALUES
  ('org_A', 'Org A', 'fx-a', 'America/New_York'),
  ('org_B', 'Org B', 'fx-b', 'UTC');

INSERT INTO "Membership" ("id", "userId", "organizationId", "role") VALUES
  ('m_ownerA',  'u_ownerA',  'org_A', 'OWNER'),
  ('m_adminA',  'u_adminA',  'org_A', 'ADMIN'),
  ('m_memberA', 'u_memberA', 'org_A', 'MEMBER'),
  ('m_treasA',  'u_treasA',  'org_A', 'TREASURER'),
  ('m_formerA', 'u_formerA', 'org_A', 'MEMBER'),
  ('m_ownerB',  'u_ownerB',  'org_B', 'OWNER'),
  ('m_memberB', 'u_memberB', 'org_B', 'MEMBER'),
  ('m_bothA',   'u_bothAB',  'org_A', 'MEMBER'),
  ('m_bothB',   'u_bothAB',  'org_B', 'MEMBER');

INSERT INTO "Project" ("id", "organizationId", "name") VALUES
  ('p_A', 'org_A', 'Project A'), ('p_B', 'org_B', 'Project B');

INSERT INTO "Task" ("id", "organizationId", "projectId", "title", "rank", "createdById", "ownerId", "updatedAt") VALUES
  ('t_A',  'org_A', 'p_A', 'Task A', 'a0', 'u_memberA', 'u_memberA', CURRENT_TIMESTAMP),
  ('t_A2', 'org_A', NULL,  'Task A2 by former member', 'a1', 'u_formerA', NULL, CURRENT_TIMESTAMP),
  ('t_B',  'org_B', 'p_B', 'Task B', 'a0', 'u_memberB', 'u_memberB', CURRENT_TIMESTAMP);

INSERT INTO "Label" ("id", "organizationId", "name", "color") VALUES
  ('l_A', 'org_A', 'Label A', '#ef4444'), ('l_B', 'org_B', 'Label B', '#3b82f6');

INSERT INTO "TaskAssignee" ("organizationId", "taskId", "userId") VALUES
  ('org_A', 't_A', 'u_memberA'), ('org_B', 't_B', 'u_memberB');
INSERT INTO "TaskLabel" ("organizationId", "taskId", "labelId") VALUES ('org_A', 't_A', 'l_A');

-- Terms are explicit so the Phase 4b rollups do not depend on the run date.
INSERT INTO "Event" ("id", "organizationId", "title", "startsAt", "endsAt", "createdById", "visibility", "kind", "term", "updatedAt") VALUES
  ('e_A',  'org_A', 'Event A', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + interval '1 hour', 'u_memberA', 'INTERNAL', 'OTHER', 'fall-2026', CURRENT_TIMESTAMP),
  ('e_A2', 'org_A', 'Event A2 by admin', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + interval '1 hour', 'u_adminA', 'INTERNAL', 'BOARD_MEETING', 'fall-2026', CURRENT_TIMESTAMP),
  ('e_B',  'org_B', 'Event B', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + interval '1 hour', 'u_memberB', 'INTERNAL', 'OTHER', 'fall-2026', CURRENT_TIMESTAMP),
  -- A PUBLIC workshop in org A, created by an admin (Phase 4a/7).
  ('e_A_pub', 'org_A', 'Public workshop A', CURRENT_TIMESTAMP + interval '2 days', CURRENT_TIMESTAMP + interval '2 days 2 hours', 'u_adminA', 'PUBLIC', 'WORKSHOP', 'fall-2026', CURRENT_TIMESTAMP);

INSERT INTO "EventAttendee" ("organizationId", "eventId", "userId") VALUES
  ('org_A', 'e_A', 'u_memberA'), ('org_B', 'e_B', 'u_memberB');

INSERT INTO "Note" ("id", "organizationId", "title", "contentJson", "contentText", "visibility", "authorId", "updatedById", "updatedAt") VALUES
  ('n_A_org',  'org_A', 'Org note by former member', '{}', 'x', 'ORGANIZATION', 'u_formerA', 'u_formerA', CURRENT_TIMESTAMP),
  ('n_A_priv', 'org_A', 'Private admin note',        '{}', 'x', 'PRIVATE',      'u_adminA',  'u_adminA',  CURRENT_TIMESTAMP),
  ('n_B',      'org_B', 'Note B',                    '{}', 'x', 'ORGANIZATION', 'u_memberB', 'u_memberB', CURRENT_TIMESTAMP);

INSERT INTO "AvailabilityPoll" ("id", "organizationId", "title", "timezone", "durationMinutes", "createdById") VALUES
  ('poll_A', 'org_A', 'Poll A', 'America/New_York', 60, 'u_memberA'),
  ('poll_B', 'org_B', 'Poll B', 'America/New_York', 60, 'u_memberB');
INSERT INTO "PollSlot" ("id", "organizationId", "pollId", "startsAt", "endsAt") VALUES
  ('s_A', 'org_A', 'poll_A', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + interval '1 hour'),
  ('s_B', 'org_B', 'poll_B', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + interval '1 hour');

INSERT INTO "BudgetPeriod" ("id", "organizationId", "label", "startsOn", "endsOn", "isActive") VALUES
  ('bp_A', 'org_A', 'Fall A', '2026-09-01', '2026-12-31', true),
  ('bp_B', 'org_B', 'Fall B', '2026-09-01', '2026-12-31', true);
INSERT INTO "BudgetCategory" ("id", "organizationId", "budgetPeriodId", "name", "allocatedCents") VALUES
  ('bc_A', 'org_A', 'bp_A', 'Food A', 10000),
  ('bc_B', 'org_B', 'bp_B', 'Food B', 10000);

INSERT INTO "Transaction" ("id", "organizationId", "budgetPeriodId", "categoryId", "direction", "kind", "amountCents",
  "description", "occurredAt", "status", "submittedById", "updatedAt") VALUES
  ('tx_A_draft', 'org_A', 'bp_A', 'bc_A', 'OUT', 'EXPENSE', 1200, 'Pizza (draft)', CURRENT_TIMESTAMP, 'DRAFT', 'u_memberA', CURRENT_TIMESTAMP),
  ('tx_A_sub',   'org_A', 'bp_A', 'bc_A', 'OUT', 'EXPENSE', 1500, 'Snacks (submitted)', CURRENT_TIMESTAMP, 'SUBMITTED', 'u_memberA', CURRENT_TIMESTAMP),
  ('tx_A_treas', 'org_A', 'bp_A', 'bc_A', 'OUT', 'EXPENSE', 900,  'Treasurer own expense', CURRENT_TIMESTAMP, 'SUBMITTED', 'u_treasA', CURRENT_TIMESTAMP),
  ('tx_A_admin', 'org_A', 'bp_A', 'bc_A', 'OUT', 'EXPENSE', 700,  'Admin expense', CURRENT_TIMESTAMP, 'SUBMITTED', 'u_adminA', CURRENT_TIMESTAMP);

INSERT INTO "Receipt" ("id", "organizationId", "transactionId", "blobKey", "filename", "mimeType", "sizeBytes", "uploadedById") VALUES
  ('r_A_admin', 'org_A', 'tx_A_admin', 'receipts/org_A/tx_A_admin/r1.pdf', 'r1.pdf', 'application/pdf', 1000, 'u_adminA');

INSERT INTO "FinanceAuditLog" ("id", "organizationId", "actorId", "transactionId", "action", "diffJson") VALUES
  ('fal_A', 'org_A', 'u_memberA', 'tx_A_draft', 'CREATE', '{}');

INSERT INTO "Invitation" ("id", "organizationId", "email", "role", "token", "expiresAt", "invitedById") VALUES
  ('inv_A', 'org_A', 'invitee@example.edu', 'MEMBER', 'tokhash_A', CURRENT_TIMESTAMP + interval '7 days', 'u_adminA');

INSERT INTO "Notification" ("id", "organizationId", "userId", "type", "title") VALUES
  ('notif_memberA', 'org_A', 'u_memberA', 'TASK_ASSIGNED', 'You were assigned'),
  ('notif_adminA',  'org_A', 'u_adminA',  'TASK_ASSIGNED', 'Admin notification');

-- ---- Phase 1: integrations and secrets ----------------------------------
INSERT INTO "OrgIntegration" ("id", "organizationId", "provider", "status", "secretLast4", "lastError", "updatedAt") VALUES
  ('int_A_claude', 'org_A', 'CLAUDE',          'CONNECTED', 'k9Qz', NULL, CURRENT_TIMESTAMP),
  ('int_A_email',  'org_A', 'EMAIL_RESEND',    'DISCONNECTED', NULL, NULL, CURRENT_TIMESTAMP),
  ('int_A_supa',   'org_A', 'SUPABASE_SOURCE', 'ERROR', 'pw12', 'connection refused', CURRENT_TIMESTAMP),
  ('int_B_claude', 'org_B', 'CLAUDE',          'CONNECTED', 'b7Xy', NULL, CURRENT_TIMESTAMP);

INSERT INTO "OrgSecret" ("id", "organizationId", "integrationId", "kind", "ciphertext", "iv", "authTag",
  "wrappedDek", "dekIv", "dekTag", "kekVersion") VALUES
  ('sec_A', 'org_A', 'int_A_claude', 'API_KEY', '\x01', '\x02', '\x03', '\x04', '\x05', '\x06', 1),
  ('sec_B', 'org_B', 'int_B_claude', 'API_KEY', '\x11', '\x12', '\x13', '\x14', '\x15', '\x16', 1);

INSERT INTO "OrgExport" ("id", "organizationId", "requestedById", "status") VALUES
  ('exp_A', 'org_A', 'u_ownerA', 'READY');

-- ---- Phase 3: org chart (v1 published, v2 draft in A; v1 published in B)
INSERT INTO "OrgChartVersion" ("id", "organizationId", "number", "status", "source", "createdById", "publishedById", "publishedAt", "updatedAt") VALUES
  ('ocv_A1', 'org_A', 1, 'PUBLISHED', 'SEED',   'u_ownerA', 'u_ownerA', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ocv_A2', 'org_A', 2, 'DRAFT',     'MANUAL', 'u_adminA', NULL, NULL, CURRENT_TIMESTAMP),
  ('ocv_B1', 'org_B', 1, 'PUBLISHED', 'SEED',   'u_ownerB', 'u_ownerB', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "OrgChartPosition" ("id", "organizationId", "versionId", "key", "title", "userId", "reportsToId", "rank") VALUES
  ('pos_A1_pres', 'org_A', 'ocv_A1', 'president', 'President', 'u_ownerA', NULL, 'a0'),
  ('pos_A1_vp',   'org_A', 'ocv_A1', 'vp-ops', 'VP Ops', 'u_adminA', 'pos_A1_pres', 'a1'),
  ('pos_A2_pres', 'org_A', 'ocv_A2', 'president', 'President', 'u_ownerA', NULL, 'a0'),
  ('pos_B1_pres', 'org_B', 'ocv_B1', 'president', 'President', 'u_ownerB', NULL, 'a0');
UPDATE "Organization" SET "activeOrgChartVersionId" = 'ocv_A1' WHERE "id" = 'org_A';
UPDATE "Organization" SET "activeOrgChartVersionId" = 'ocv_B1' WHERE "id" = 'org_B';

-- ---- Phase 4b: website data ------------------------------------------------
INSERT INTO "Contact" ("id", "organizationId", "displayName", "emailMasked", "emailDomain", "userId", "updatedAt") VALUES
  ('c_A1', 'org_A', 'Dana Student', 'd***@husky.neu.edu', 'husky.neu.edu', NULL, CURRENT_TIMESTAMP),
  ('c_A2', 'org_A', 'Member A',     'm***@example.edu',   'example.edu',   'u_memberA', CURRENT_TIMESTAMP),
  ('c_B1', 'org_B', 'Blake B',      'b***@example.edu',   'example.edu',   NULL, CURRENT_TIMESTAMP);
INSERT INTO "ContactEmail" ("id", "organizationId", "contactId", "emailNormalized", "isPrimary") VALUES
  ('ce_A1', 'org_A', 'c_A1', 'dana@husky.neu.edu', true),
  ('ce_A1b', 'org_A', 'c_A1', 'dana@northeastern.edu', false),
  ('ce_B1', 'org_B', 'c_B1', 'blake@example.edu', true);
INSERT INTO "Attendance" ("id", "organizationId", "eventId", "contactId", "term", "checkedInAt", "method", "source", "externalId") VALUES
  ('att_A_suite', 'org_A', 'e_A_pub', 'c_A1', 'fall-2026', CURRENT_TIMESTAMP, 'MANUAL', 'SUITE', NULL),
  ('att_A_sync',  'org_A', 'e_A',     'c_A1', 'fall-2026', CURRENT_TIMESTAMP - interval '7 days', 'QR', 'SUPABASE_SYNC', 'ck_1'),
  ('att_A_sync2', 'org_A', 'e_A',     'c_A2', 'fall-2026', CURRENT_TIMESTAMP - interval '7 days', 'QR', 'SUPABASE_SYNC', 'ck_2'),
  ('att_B',       'org_B', 'e_B',     'c_B1', 'fall-2026', CURRENT_TIMESTAMP, 'FORM', 'SUITE', NULL);
INSERT INTO "Signup" ("id", "organizationId", "contactId", "term", "channel", "signedUpAt", "recordSource", "externalId", "updatedAt") VALUES
  ('su_A_suite', 'org_A', 'c_A2', 'fall-2026', 'MANUAL', CURRENT_TIMESTAMP - interval '10 days', 'SUITE', NULL, CURRENT_TIMESTAMP),
  ('su_A_sync',  'org_A', 'c_A1', 'fall-2026', 'WEB', CURRENT_TIMESTAMP - interval '12 days', 'SUPABASE_SYNC', 'sg_1', CURRENT_TIMESTAMP),
  ('su_B',       'org_B', 'c_B1', 'fall-2026', 'WEB', CURRENT_TIMESTAMP - interval '3 days', 'SUITE', NULL, CURRENT_TIMESTAMP);
INSERT INTO "BallotDefinition" ("id", "organizationId", "slug", "title", "definition", "linkedEventId") VALUES
  ('bd_A', 'org_A', 'fall-topics', 'Fall workshop topics',
   '{"questions":[{"key":"topics","label":"Topics","type":"slots","options":[{"key":"agents","label":"Agents"},{"key":"rag","label":"RAG"},{"key":"evals","label":"Evals"}]},{"key":"day","label":"Day","type":"single","options":[{"key":"tue","label":"Tue"},{"key":"thu","label":"Thu"}]},{"key":"notes","label":"Notes","type":"text"}]}',
   'e_A_pub'),
  ('bd_B', 'org_B', 'b-poll', 'B poll', '{"questions":[{"key":"q","type":"single"}]}', NULL);
INSERT INTO "Ballot" ("id", "organizationId", "ballotDefinitionId", "pollSlug", "answers", "castAt", "voterContactId", "source", "externalId") VALUES
  ('bal_A1', 'org_A', 'bd_A', 'fall-topics', '{"topics":["agents","rag","evals"],"day":"tue","notes":"more pizza"}', CURRENT_TIMESTAMP, 'c_A1', 'SUPABASE_SYNC', 'b_1'),
  ('bal_A2', 'org_A', 'bd_A', 'fall-topics', '{"topics":["rag","agents"],"day":"tue"}', CURRENT_TIMESTAMP, NULL, 'SUPABASE_SYNC', 'b_2'),
  ('bal_A3', 'org_A', 'bd_A', 'fall-topics', '{"topics":["agents"],"day":"thu"}', CURRENT_TIMESTAMP, NULL, 'SUITE', NULL),
  ('bal_B1', 'org_B', 'bd_B', 'b-poll', '{"q":"x"}', CURRENT_TIMESTAMP, 'c_B1', 'SUITE', NULL);
SELECT app.explode_ballot('org_A', 'bal_A1'), app.explode_ballot('org_A', 'bal_A2'),
       app.explode_ballot('org_A', 'bal_A3'), app.explode_ballot('org_B', 'bal_B1');
INSERT INTO "DataSourceSyncState" ("id", "organizationId", "integrationId", "stream", "watermark", "updatedAt") VALUES
  ('dss_A', 'org_A', 'int_A_supa', 'checkins', '{"ts":"2026-09-01T00:00:00Z","id":"ck_2"}', CURRENT_TIMESTAMP);
INSERT INTO "EventLinkLog" ("id", "organizationId", "eventId", "source", "externalId", "method") VALUES
  ('ell_A', 'org_A', 'e_A', 'SUPABASE', 'sess_1', 'EXACT');
SELECT app.refresh_contact_rollups('org_A', NULL), app.refresh_contact_rollups('org_B', NULL);

-- ---- Phase 6: tasks -------------------------------------------------------
INSERT INTO "TaskComment" ("id", "organizationId", "taskId", "authorId", "body") VALUES
  ('tc_A_member', 'org_A', 't_A', 'u_memberA', 'On it.'),
  ('tc_A_admin',  'org_A', 't_A', 'u_adminA',  'Thanks @[Member A](user:u_memberA)'),
  ('tc_B',        'org_B', 't_B', 'u_memberB', 'B comment');
INSERT INTO "TaskMention" ("id", "organizationId", "taskId", "sourceKey", "mentionedUserId", "mentionedById") VALUES
  ('tm_A', 'org_A', 't_A', 'tc_A_admin', 'u_memberA', 'u_adminA');
INSERT INTO "TaskActivity" ("id", "organizationId", "taskId", "actorId", "type", "diffJson") VALUES
  ('ta_A', 'org_A', 't_A', 'u_memberA', 'CREATED', '{}'),
  ('ta_B', 'org_B', 't_B', 'u_memberB', 'CREATED', '{}');
INSERT INTO "WeeklyUpdate" ("id", "organizationId", "userId", "weekStart", "done", "next", "blocked", "updatedAt") VALUES
  ('wu_A_member', 'org_A', 'u_memberA', '2026-09-14', '["Shipped t_A"]', '["Next thing"]', '[]', CURRENT_TIMESTAMP),
  ('wu_A_admin',  'org_A', 'u_adminA',  '2026-09-14', '[]', '[]', '["Waiting on room booking"]', CURRENT_TIMESTAMP),
  ('wu_B',        'org_B', 'u_memberB', '2026-09-14', '[]', '[]', '[]', CURRENT_TIMESTAMP);

-- ---- Phase 8: theme ---------------------------------------------------------
INSERT INTO "OrgTheme" ("organizationId", "preset", "mode", "light", "tokens", "updatedAt") VALUES
  ('org_A', 'cbc-light', 'LIGHT',
   '{"primary":"#a34a2a","accent":"#d97757","background":"#faf9f5","surface":"#ffffff","text":"#141413"}', '{}', CURRENT_TIMESTAMP);

-- u_formerA leaves org A but keeps authorship of t_A2 and n_A_org.
DELETE FROM "Membership" WHERE "id" = 'm_formerA';
