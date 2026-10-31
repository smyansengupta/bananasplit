-- Forms, second pass (docs/features/forms.md):
--   1. A form is a draft until it's published (Form.publishedAt): nobody can
--      answer a draft. Forms that already exist were live, so they count as
--      published from when they were made.
--   2. Form.design: how the answer page looks (accent, cover, button
--      wording, thank-you text), and Form.receipt: email the person a copy
--      of their answers.
--   3. Question polls move into Forms. Each poll that is NOT anonymous
--      becomes a quick poll form: a one-question form with its own database,
--      one row per voter with what they chose, and a response per row, so
--      it's sortable, exportable and reviewable like any form. The poll keeps
--      its rows (Poll.formId points at its form, and its page forwards there).
--
--      Anonymous polls are deliberately NOT copied. Their promise ("nobody
--      sees who voted for what") is kept by the database itself: PollVote's
--      policies never show a member another member's vote. A database row is
--      readable as a whole by whoever can open the database, so the same
--      promise could not hold there. Those polls stay on the poll tables and
--      are listed and managed as quick polls in Forms.

-- AlterTable
ALTER TABLE "Form" ADD COLUMN "publishedAt" TIMESTAMP(3),
ADD COLUMN "design" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "receipt" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Poll" ADD COLUMN "formId" TEXT;

-- ---------------------------------------------------------------------------
-- Hand-written: backfill, checks, and the poll copy.
-- ---------------------------------------------------------------------------

UPDATE "Form" SET "publishedAt" = "createdAt" WHERE "publishedAt" IS NULL;

ALTER TABLE "Form" ADD CONSTRAINT "Form_design_object"
  CHECK (jsonb_typeof("design") = 'object' AND octet_length("design"::text) <= 4000);
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_formId_length"
  CHECK ("formId" IS NULL OR char_length("formId") <= 64);

DO $$
DECLARE
  p RECORD;
  v RECORD;
  colors text[] := ARRAY['gray', 'yellow', 'orange', 'red', 'pink', 'purple', 'blue', 'green'];
  h text;
  form_id text;
  folder_id text;
  db_id text;
  primary_id text;
  field_id text;
  question_id text;
  rec_id text;
  title text;
  db_key text;
  choices jsonb;
  options jsonb;
BEGIN
  FOR p IN
    SELECT * FROM "Poll" WHERE NOT "anonymous" AND "formId" IS NULL ORDER BY "createdAt"
  LOOP
    h := md5(p."id");
    form_id := 'pf' || substr(md5(p."id" || ':form'), 1, 23);
    folder_id := 'pd' || substr(md5(p."id" || ':folder'), 1, 23);
    db_id := 'pb' || substr(md5(p."id" || ':db'), 1, 23);
    primary_id := 'pp' || substr(md5(p."id" || ':primary'), 1, 23);
    field_id := 'pc' || substr(md5(p."id" || ':choice'), 1, 23);
    question_id := substr(h, 1, 10);
    title := left(coalesce(nullif(btrim(p."question"), ''), 'Quick poll'), 200);
    db_key := 'form-' || coalesce(
      nullif(left(btrim(regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g'), '-'), 40), ''),
      'poll'
    ) || '-' || substr(h, 1, 6);

    SELECT
      coalesce(jsonb_agg(jsonb_build_object(
        'id', o."id",
        'label', o."label",
        'color', colors[1 + ((o.rn) % array_length(colors, 1))]
      ) ORDER BY o.rn), '[]'::jsonb),
      coalesce(jsonb_agg(jsonb_build_object('id', o."id", 'label', left(o."label", 80)) ORDER BY o.rn), '[]'::jsonb)
    INTO choices, options
    FROM (
      SELECT po."id", po."label",
             row_number() OVER (ORDER BY po."sortOrder", po."createdAt") AS rn
      FROM "PollOption" po
      WHERE po."pollId" = p."id"
    ) o;

    INSERT INTO "NoteFolder" ("id", "organizationId", "name", "createdById", "createdAt", "updatedAt")
    VALUES (folder_id, p."organizationId", left(title, 80), p."createdById", p."createdAt", p."createdAt");

    INSERT INTO "DatabaseDefinition"
      ("id", "organizationId", "key", "name", "icon", "kind", "memberVisibility", "allowEdits",
       "sortOrder", "description", "createdById", "createdAt", "updatedAt")
    VALUES
      (db_id, p."organizationId", db_key, left(title, 60), 'ClipboardList', 'CUSTOM', 'ADMINS', true,
       coalesce((SELECT max("sortOrder") FROM "DatabaseDefinition" WHERE "organizationId" = p."organizationId"), 0) + 1,
       'Responses to a form', p."createdById", p."createdAt", p."createdAt");

    INSERT INTO "DatabaseField" ("id", "organizationId", "databaseId", "name", "type", "options", "isPrimary", "sortOrder", "createdAt", "updatedAt")
    VALUES
      (primary_id, p."organizationId", db_id, 'Response', 'TEXT', '{}'::jsonb, true, 0, p."createdAt", p."createdAt"),
      (field_id, p."organizationId", db_id, left(title, 60),
       (CASE WHEN p."multiple" THEN 'MULTI_SELECT' ELSE 'SELECT' END)::"DatabaseFieldType",
       jsonb_build_object('choices', choices), false, 1, p."createdAt", p."createdAt");

    INSERT INTO "Form"
      ("id", "organizationId", "databaseId", "kind", "title", "description", "slug", "questions",
       "access", "onePerPerson", "anonymous", "hideResultsUntilClosed", "closesAt", "closedAt",
       "notifyOwner", "review", "folderId", "createdById", "createdAt", "updatedAt", "publishedAt")
    VALUES
      (form_id, p."organizationId", db_id, 'QUICK_POLL', title, left(p."description", 2000),
       substr(md5(p."id" || ':slug'), 1, 12),
       jsonb_build_array(jsonb_build_object(
         'id', question_id,
         'type', CASE WHEN p."multiple" THEN 'checkboxes' ELSE 'choice' END,
         'title', left(title, 300),
         'required', true,
         'options', options,
         'allowOther', p."allowMemberOptions",
         'fieldId', field_id
       )),
       'MEMBERS', true, false, p."hideResultsUntilClosed", p."closesAt", p."closedAt",
       false, false, folder_id, p."createdById", p."createdAt", p."updatedAt", p."createdAt");

    -- One row per voter: their name, and what they chose.
    FOR v IN
      SELECT pv."userId",
             min(pv."createdAt") AS at,
             array_agg(pv."optionId" ORDER BY pv."createdAt") AS picked,
             coalesce(nullif(btrim(u."name"), ''), 'Member') AS who
      FROM "PollVote" pv
      JOIN "User" u ON u."id" = pv."userId"
      WHERE pv."pollId" = p."id"
      GROUP BY pv."userId", u."name"
    LOOP
      rec_id := 'pr' || substr(md5(p."id" || ':' || v."userId"), 1, 23);
      INSERT INTO "DatabaseRecord" ("id", "organizationId", "databaseId", "values", "createdById", "createdAt", "updatedAt")
      VALUES (
        rec_id, p."organizationId", db_id,
        jsonb_build_object(
          primary_id, left(v.who, 200),
          field_id, CASE WHEN p."multiple" THEN to_jsonb(v.picked) ELSE to_jsonb(v.picked[1]) END
        ),
        v."userId", v.at, v.at
      );
      INSERT INTO "FormResponse" ("id", "organizationId", "formId", "recordId", "userId", "status", "createdAt", "updatedAt")
      VALUES ('ps' || substr(md5(p."id" || ':r:' || v."userId"), 1, 23), p."organizationId", form_id, rec_id, v."userId", 'NEW', v.at, v.at);
    END LOOP;

    UPDATE "Poll" SET "formId" = form_id WHERE "id" = p."id";
  END LOOP;
END $$;
