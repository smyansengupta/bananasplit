-- Forms: a form's questions and settings (Form), and each response's review
-- (FormResponse). Answers live in the form's own club database: each
-- question is a DatabaseField, each response a DatabaseRecord. People answer
-- at /f/{slug}, signed in or not; the public submit runs on the service
-- path after the app checks the form is open and the person may answer.
-- Question polls (Poll) are unchanged: members-only polls with live counts
-- and anonymity enforced here stay on them, and Forms lists them.
-- See docs/features/forms.md.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'FORM_RESPONSE';

-- CreateEnum
CREATE TYPE "FormKind" AS ENUM ('FORM', 'QUICK_POLL');

-- CreateEnum
CREATE TYPE "FormAccess" AS ENUM ('ANYONE', 'MEMBERS', 'SIGNED_IN');

-- CreateEnum
CREATE TYPE "FormResponseStatus" AS ENUM ('NEW', 'ACCEPTED', 'WAITLISTED', 'DECLINED');

-- CreateTable
CREATE TABLE "Form" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "databaseId" TEXT NOT NULL,
    "kind" "FormKind" NOT NULL DEFAULT 'FORM',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "slug" TEXT NOT NULL,
    "questions" JSONB NOT NULL DEFAULT '[]',
    "access" "FormAccess" NOT NULL DEFAULT 'ANYONE',
    "onePerPerson" BOOLEAN NOT NULL DEFAULT false,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "hideResultsUntilClosed" BOOLEAN NOT NULL DEFAULT false,
    "responseCap" INTEGER,
    "closesAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "notifyOwner" BOOLEAN NOT NULL DEFAULT true,
    "review" BOOLEAN NOT NULL DEFAULT false,
    "folderId" TEXT,
    "createdById" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Form_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormResponse" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT,
    "status" "FormResponseStatus" NOT NULL DEFAULT 'NEW',
    "rating" INTEGER,
    "notes" TEXT,
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Form_slug_key" ON "Form"("slug");

-- CreateIndex
CREATE INDEX "Form_organizationId_deletedAt_createdAt_idx" ON "Form"("organizationId", "deletedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Form_organizationId_id_key" ON "Form"("organizationId", "id");

-- CreateIndex
CREATE INDEX "FormResponse_organizationId_formId_status_createdAt_idx" ON "FormResponse"("organizationId", "formId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "FormResponse_formId_userId_idx" ON "FormResponse"("formId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "FormResponse_organizationId_id_key" ON "FormResponse"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FormResponse_organizationId_recordId_key" ON "FormResponse"("organizationId", "recordId");

-- AddForeignKey
ALTER TABLE "Form" ADD CONSTRAINT "Form_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Form" ADD CONSTRAINT "Form_organizationId_databaseId_fkey" FOREIGN KEY ("organizationId", "databaseId") REFERENCES "DatabaseDefinition"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormResponse" ADD CONSTRAINT "FormResponse_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormResponse" ADD CONSTRAINT "FormResponse_organizationId_formId_fkey" FOREIGN KEY ("organizationId", "formId") REFERENCES "Form"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormResponse" ADD CONSTRAINT "FormResponse_organizationId_recordId_fkey" FOREIGN KEY ("organizationId", "recordId") REFERENCES "DatabaseRecord"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- Hand-written: checks, RLS, grants and the public lookup.
-- ---------------------------------------------------------------------------

ALTER TABLE "Form" ADD CONSTRAINT "Form_title_length"
  CHECK (char_length(btrim("title")) >= 1 AND char_length("title") <= 200);
ALTER TABLE "Form" ADD CONSTRAINT "Form_description_length"
  CHECK ("description" IS NULL OR char_length("description") <= 2000);
ALTER TABLE "Form" ADD CONSTRAINT "Form_slug_shape"
  CHECK ("slug" ~ '^[a-z0-9-]{4,64}$');
ALTER TABLE "Form" ADD CONSTRAINT "Form_response_cap"
  CHECK ("responseCap" IS NULL OR "responseCap" BETWEEN 1 AND 10000);
ALTER TABLE "FormResponse" ADD CONSTRAINT "FormResponse_rating_range"
  CHECK ("rating" IS NULL OR "rating" BETWEEN 1 AND 5);
ALTER TABLE "FormResponse" ADD CONSTRAINT "FormResponse_notes_length"
  CHECK ("notes" IS NULL OR char_length("notes") <= 4000);

-- Form: every member reads the org's forms (to open a members-only one);
-- owners and admins make, change and delete them. Respondents never write
-- here: a submit is a service-path insert.
ALTER TABLE "Form" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "Form" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "Form" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin())
              AND "createdById" = (SELECT app.user_id()));
CREATE POLICY app_user_update ON "Form" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_delete ON "Form" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_service_select ON "Form" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "Form" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

-- FormResponse: who answered, and the officers' status, rating and private
-- notes. Owners and admins only; the service path records new responses.
ALTER TABLE "FormResponse" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "FormResponse" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_update ON "FormResponse" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_delete ON "FormResponse" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_service_select ON "FormResponse" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "FormResponse" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "Form", "FormResponse" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Form" TO app_user;
GRANT SELECT, UPDATE ON "Form" TO app_service;
GRANT SELECT, UPDATE, DELETE ON "FormResponse" TO app_user;
GRANT SELECT, INSERT ON "FormResponse" TO app_service;

-- The public page finds its form by slug without an org context, the way
-- app.rsvp_page does for sign-up pages: only live forms, only their ids.
CREATE OR REPLACE FUNCTION app.form_page(p_slug text)
RETURNS TABLE ("organizationId" text, "formId" text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT f."organizationId", f."id" FROM public."Form" f
   WHERE f."slug" = p_slug AND f."deletedAt" IS NULL
$$;
REVOKE ALL ON FUNCTION app.form_page(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.form_page(text) TO app_service;

-- A file answered on a form (a resume, a photo) is stored in the club's
-- Files on the service path, in the folder the form was given when it was
-- made, credited to the form's creator. The storage counter trigger counts
-- it like any upload.
CREATE POLICY app_service_insert ON "OrgFile" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
GRANT INSERT ON "OrgFile" TO app_service;
