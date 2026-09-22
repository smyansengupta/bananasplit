-- =====================================================================
-- Phase 1: Settings + multi-tenant integrations
-- =====================================================================
-- Organization timezone, logo and soft-delete columns; OrgSettings (with
-- every later-phase settings column, so feature builders need no schema
-- change); OrgIntegration and the composite FK that turns 0B's OrgSecret
-- stub into the real table; OrgSlugHistory, OrgCreationCode, OrgExport and
-- OrgDeletionLog; Receipt.organizationId (PR 1R). Then the security layer:
-- org defaults trigger, slug reservation, the cross-org definer functions,
-- per-command policies and grants.
-- 0B's organization_guard already makes slug, deletedAt and
-- deleteScheduledFor OWNER-only (it reads columns through to_jsonb).
-- =====================================================================

-- CreateEnum
CREATE TYPE "BallotVisibility" AS ENUM ('OWNER_ONLY', 'OWNER_AND_ADMINS', 'NOBODY');

-- CreateEnum
CREATE TYPE "MemberVisibility" AS ENUM ('MEMBERS', 'ADMINS', 'OWNER', 'HIDDEN');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('CLAUDE', 'GOOGLE_CALENDAR', 'EMAIL_RESEND', 'SUPABASE_SOURCE', 'NETLIFY_BUILD_HOOK');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('CONNECTED', 'ERROR', 'NEEDS_REAUTH', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "SlugRetireReason" AS ENUM ('RENAMED', 'DELETED');

-- CreateEnum
CREATE TYPE "OrgExportStatus" AS ENUM ('PENDING', 'RUNNING', 'READY', 'FAILED', 'EXPIRED');

-- DropForeignKey
ALTER TABLE "Receipt" DROP CONSTRAINT "Receipt_transactionId_fkey";

-- AlterTable

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "deleteScheduledFor" TIMESTAMP(3),
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "logo" JSONB,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC';

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN     "organizationId" TEXT;

-- Hand-added (PR 1R): backfill from the parent Transaction, then NOT NULL.
UPDATE "Receipt" r SET "organizationId" = t."organizationId" FROM "Transaction" t WHERE t."id" = r."transactionId";
ALTER TABLE "Receipt" ALTER COLUMN "organizationId" SET NOT NULL;

-- CreateTable
CREATE TABLE "OrgSettings" (
    "organizationId" TEXT NOT NULL,
    "ballotIndividualVisibility" "BallotVisibility" NOT NULL DEFAULT 'OWNER_ONLY',
    "ballotResultsVisibleToMembers" BOOLEAN NOT NULL DEFAULT true,
    "ballotMinCellSize" INTEGER NOT NULL DEFAULT 3,
    "showMemberEmailsToMembers" BOOLEAN NOT NULL DEFAULT false,
    "publicEventsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "platformMailFallback" BOOLEAN NOT NULL DEFAULT false,
    "contactEmailVisibility" "MemberVisibility" NOT NULL DEFAULT 'ADMINS',
    "stampMilestones" INTEGER[] DEFAULT ARRAY[3, 5, 8]::INTEGER[],
    "lapsedAfterSessions" INTEGER NOT NULL DEFAULT 3,
    "reportsRefreshSeconds" INTEGER NOT NULL DEFAULT 300,
    "reportsDataVersion" INTEGER NOT NULL DEFAULT 0,
    "taskRequireOwner" BOOLEAN NOT NULL DEFAULT false,
    "taskRequireDueDate" BOOLEAN NOT NULL DEFAULT false,
    "reminderLeadDaysDefault" INTEGER NOT NULL DEFAULT 1,
    "bootstrapTemplate" TEXT,
    "bootstrappedAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgSettings_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "OrgIntegration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "config" JSONB NOT NULL DEFAULT '{}',
    "secretLast4" TEXT,
    "secretFingerprint" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "connectedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgSlugHistory" (
    "slug" TEXT NOT NULL,
    "organizationId" TEXT,
    "reason" "SlugRetireReason" NOT NULL,
    "retiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgSlugHistory_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "OrgCreationCode" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "codeHash" TEXT NOT NULL,
    "createdByEmail" TEXT NOT NULL,
    "note" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedByUserId" TEXT,
    "usedOrgId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgCreationCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgExport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestedById" TEXT,
    "status" "OrgExportStatus" NOT NULL DEFAULT 'PENDING',
    "blobKey" TEXT,
    "error" TEXT,
    "cursor" JSONB,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "lastDownloadedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "OrgExport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgDeletionLog" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "organizationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deletedById" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "purgedAt" TIMESTAMP(3),

    CONSTRAINT "OrgDeletionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgIntegration_organizationId_provider_key" ON "OrgIntegration"("organizationId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "OrgIntegration_organizationId_id_key" ON "OrgIntegration"("organizationId", "id");

-- CreateIndex
CREATE INDEX "OrgSlugHistory_organizationId_idx" ON "OrgSlugHistory"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgCreationCode_codeHash_key" ON "OrgCreationCode"("codeHash");

-- CreateIndex
CREATE INDEX "OrgExport_organizationId_createdAt_idx" ON "OrgExport"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Receipt_organizationId_idx" ON "Receipt"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_organizationId_id_key" ON "Transaction"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_organizationId_transactionId_fkey" FOREIGN KEY ("organizationId", "transactionId") REFERENCES "Transaction"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgSecret" ADD CONSTRAINT "OrgSecret_organizationId_integrationId_fkey" FOREIGN KEY ("organizationId", "integrationId") REFERENCES "OrgIntegration"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgSettings" ADD CONSTRAINT "OrgSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgIntegration" ADD CONSTRAINT "OrgIntegration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgIntegration" ADD CONSTRAINT "OrgIntegration_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgSlugHistory" ADD CONSTRAINT "OrgSlugHistory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgExport" ADD CONSTRAINT "OrgExport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgExport" ADD CONSTRAINT "OrgExport_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- =====================================================================
-- Phase 1 security layer (hand-written). Same contract as 0B: ENABLE RLS,
-- per-command policies for app_user and app_service, explicit grants, no
-- default table grants. app_legacy gets nothing on the new tables.
-- =====================================================================

-- ---- Org defaults: every org gets its OrgSettings row, on every path ----
-- (service-path org creation, the legacy onboarding action, the seed and
-- tests). app_user never inserts OrgSettings. ensure_org_defaults is
-- SECURITY INVOKER with no runtime grants: it runs as the owner, either from
-- the definer trigger below or from a migration backfill. Phase 4a extends it
-- with the built-in DatabaseDefinitions.
CREATE OR REPLACE FUNCTION app.ensure_org_defaults(p_org text) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  INSERT INTO public."OrgSettings" ("organizationId", "updatedAt")
  VALUES (p_org, app.utc_now())
  ON CONFLICT ("organizationId") DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION app.organization_defaults() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM app.ensure_org_defaults(NEW."id");
  RETURN NEW;
END $$;

CREATE TRIGGER organization_defaults AFTER INSERT ON "Organization"
  FOR EACH ROW EXECUTE FUNCTION app.organization_defaults();

-- Backfill: orgs that exist now (CBC in production) keep their mail on the
-- platform sender until they connect a verified sender of their own.
INSERT INTO "OrgSettings" ("organizationId", "platformMailFallback", "updatedAt")
SELECT o."id", true, app.utc_now() FROM "Organization" o
ON CONFLICT ("organizationId") DO NOTHING;

-- ---- Slugs: reserved words and permanent reservation of retired slugs ----
-- The one list of reserved words. src/lib/slug.ts RESERVED_SLUGS mirrors it
-- and prisma/rls asserts the two are equal.
CREATE OR REPLACE FUNCTION app.reserved_slugs() RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT ARRAY['admin', 'api', 'app', 'invite', 'new', 'onboarding', 'platform', 'poll',
               'public', 'settings', 'sign-in', 'sign-up']::text[]
$$;

-- Replaces 0B's body (same signature, definer settings and grant): false for
-- a reserved word, a live or soft-deleted org's slug, or any slug in
-- OrgSlugHistory (retired slugs are reserved forever, even after a purge).
CREATE OR REPLACE FUNCTION app.slug_available(p_slug text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT p_slug IS NOT NULL
     AND NOT (lower(p_slug) = ANY (app.reserved_slugs()))
     AND NOT EXISTS (SELECT 1 FROM public."Organization" o WHERE o."slug" = p_slug)
     AND NOT EXISTS (SELECT 1 FROM public."OrgSlugHistory" h WHERE h."slug" = p_slug)
$$;

-- Enforces the reservation in the database for every path (app_legacy's
-- onboarding included): a slug may not be a reserved word or another org's
-- retired slug. On a rename, the old slug is recorded as RENAMED (it keeps
-- redirecting to this org with a 307 until the org is purged). SECURITY
-- DEFINER because OrgSlugHistory has no table grants. The rename itself is
-- OWNER-only through app.organization_guard.
CREATE OR REPLACE FUNCTION app.organization_slug_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."slug" IS NOT DISTINCT FROM OLD."slug" THEN
    RETURN NEW;
  END IF;
  IF lower(NEW."slug") = ANY (app.reserved_slugs())
     OR EXISTS (SELECT 1 FROM public."OrgSlugHistory" h
                 WHERE h."slug" = NEW."slug" AND h."organizationId" IS DISTINCT FROM NEW."id") THEN
    RAISE EXCEPTION 'slug is not available' USING ERRCODE = '23505';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    INSERT INTO public."OrgSlugHistory" ("slug", "organizationId", "reason", "retiredAt")
    VALUES (OLD."slug", NEW."id", 'RENAMED', app.utc_now())
    ON CONFLICT ("slug") DO UPDATE SET "organizationId" = EXCLUDED."organizationId",
      "reason" = EXCLUDED."reason", "retiredAt" = EXCLUDED."retiredAt";
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER organization_slug_guard BEFORE INSERT OR UPDATE OF "slug" ON "Organization"
  FOR EACH ROW EXECUTE FUNCTION app.organization_slug_guard();

-- Slug -> org for [orgSlug]/layout and the public routes, before any org
-- GUC exists. A live slug wins; a retired slug that still points at a live
-- org returns that org's canonical slug with isRetired = true (the caller
-- answers 307, no-store). Soft-deleted and purged orgs resolve to nothing.
CREATE OR REPLACE FUNCTION app.resolve_org_slug(p_slug text)
RETURNS TABLE ("organizationId" text, "canonicalSlug" text, "isRetired" boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT r.id, r.slug, r.retired FROM (
    SELECT o."id" AS id, o."slug" AS slug, false AS retired, 0 AS pri
      FROM public."Organization" o
     WHERE o."slug" = p_slug AND o."deletedAt" IS NULL
    UNION ALL
    SELECT o."id", o."slug", true, 1
      FROM public."OrgSlugHistory" h JOIN public."Organization" o ON o."id" = h."organizationId"
     WHERE h."slug" = p_slug AND o."deletedAt" IS NULL
  ) r
  ORDER BY r.pri
  LIMIT 1
$$;

-- ---- Org-creation codes (ORG_CREATION_MODE=invite) ---------------------
-- No table grants. A platform admin (PLATFORM_ADMIN_EMAILS, checked in app
-- code) issues and lists codes on the service path; org creation redeems
-- one inside withSystemOrgTx(newOrgId, { userId }).
CREATE OR REPLACE FUNCTION app.issue_org_creation_code(
  p_code_hash text, p_created_by_email text, p_note text, p_expires_at timestamp
) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_id text;
BEGIN
  IF session_user <> 'app_service' AND session_user <> current_user THEN
    RAISE EXCEPTION 'issue_org_creation_code: not permitted' USING ERRCODE = '42501';
  END IF;
  IF p_code_hash IS NULL OR p_code_hash !~ '^[0-9a-f]{64}$' OR p_created_by_email IS NULL
     OR p_expires_at IS NULL OR p_expires_at <= app.utc_now() THEN
    RAISE EXCEPTION 'issue_org_creation_code: invalid arguments' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public."OrgCreationCode" ("codeHash", "createdByEmail", "note", "expiresAt", "createdAt")
  VALUES (p_code_hash, lower(btrim(p_created_by_email)), left(p_note, 200), p_expires_at, app.utc_now())
  RETURNING "id" INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION app.list_org_creation_codes(p_limit integer DEFAULT 100)
RETURNS TABLE ("id" text, "createdByEmail" text, "note" text, "expiresAt" timestamp(3),
               "usedAt" timestamp(3), "usedByUserId" text, "usedOrgId" text, "createdAt" timestamp(3))
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF session_user <> 'app_service' AND session_user <> current_user THEN
    RAISE EXCEPTION 'list_org_creation_codes: not permitted' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT c."id", c."createdByEmail", c."note", c."expiresAt", c."usedAt", c."usedByUserId", c."usedOrgId", c."createdAt"
    FROM public."OrgCreationCode" c
   ORDER BY c."createdAt" DESC
   LIMIT least(greatest(coalesce(p_limit, 100), 1), 500);
END $$;

-- Marks a code used by the creating user for the org being created (the
-- service GUCs), atomically. False when the code is unknown, used or expired.
CREATE OR REPLACE FUNCTION app.redeem_org_creation_code(p_code_hash text, p_user_id text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF session_user = 'app_service' THEN
    IF app.org_id() IS NULL OR p_user_id IS NULL OR p_user_id IS DISTINCT FROM app.user_id() THEN
      RAISE EXCEPTION 'redeem_org_creation_code: not permitted' USING ERRCODE = '42501';
    END IF;
  ELSIF session_user <> current_user THEN
    RAISE EXCEPTION 'redeem_org_creation_code: not permitted' USING ERRCODE = '42501';
  END IF;
  UPDATE public."OrgCreationCode"
     SET "usedAt" = app.utc_now(), "usedByUserId" = p_user_id, "usedOrgId" = app.org_id()
   WHERE "codeHash" = p_code_hash AND "usedAt" IS NULL AND "expiresAt" > app.utc_now();
  RETURN FOUND;
END $$;

-- ---- Org purge record ----------------------------------------------------
-- Called by the org-purge job in its final service transaction, right
-- before the Organization DELETE: reserves the org's current slug forever
-- (reason DELETED, no redirect) and writes OrgDeletionLog, which has no FK
-- so it outlives the org. Returns the log row id.
CREATE OR REPLACE FUNCTION app.log_org_deletion(p_org text, p_deleted_by text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_id text := (gen_random_uuid())::text;
  v_org record;
BEGIN
  IF session_user = 'app_service' THEN
    IF app.org_id() IS NULL OR p_org IS DISTINCT FROM app.org_id() THEN
      RAISE EXCEPTION 'log_org_deletion: not permitted' USING ERRCODE = '42501';
    END IF;
  ELSIF session_user <> current_user THEN
    RAISE EXCEPTION 'log_org_deletion: not permitted' USING ERRCODE = '42501';
  END IF;
  SELECT o."id", o."slug", o."name", o."deletedAt" INTO v_org FROM public."Organization" o WHERE o."id" = p_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'log_org_deletion: not permitted' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public."OrgSlugHistory" ("slug", "organizationId", "reason", "retiredAt")
  VALUES (v_org."slug", NULL, 'DELETED', app.utc_now())
  ON CONFLICT ("slug") DO UPDATE SET "organizationId" = NULL, "reason" = 'DELETED', "retiredAt" = EXCLUDED."retiredAt";
  INSERT INTO public."OrgDeletionLog" ("id", "organizationId", "slug", "name", "deletedById", "requestedAt", "purgedAt")
  VALUES (v_id, v_org."id", v_org."slug", v_org."name", p_deleted_by,
          coalesce(v_org."deletedAt", app.utc_now()), app.utc_now());
  RETURN v_id;
END $$;

-- ---- Row-level security -------------------------------------------------
ALTER TABLE "OrgSettings"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrgIntegration"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrgSlugHistory"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrgCreationCode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrgExport"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrgDeletionLog"  ENABLE ROW LEVEL SECURITY;

-- OrgSettings: members read; OWNER/ADMIN update; the row itself is created
-- by the organization_defaults trigger, so app_user has no INSERT or DELETE.
CREATE POLICY app_user_select ON "OrgSettings" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_update ON "OrgSettings" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_service_select ON "OrgSettings" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "OrgSettings" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "OrgSettings" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "OrgSettings" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

-- OrgIntegration: OWNER/ADMIN only (members have no use for status, last4
-- or lastError); removal is OWNER-only.
CREATE POLICY app_user_select ON "OrgIntegration" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_insert ON "OrgIntegration" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_update ON "OrgIntegration" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_delete ON "OrgIntegration" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_owner()));
CREATE POLICY app_service_select ON "OrgIntegration" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "OrgIntegration" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "OrgIntegration" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "OrgIntegration" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

-- OrgExport: the OWNER requests and reads; the export job updates it on the
-- service path. No app_user UPDATE or DELETE.
CREATE POLICY app_user_select ON "OrgExport" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_owner()));
CREATE POLICY app_user_insert ON "OrgExport" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_owner())
              AND "requestedById" = (SELECT app.user_id()));
CREATE POLICY app_service_select ON "OrgExport" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "OrgExport" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "OrgExport" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "OrgExport" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

-- OrgSlugHistory, OrgCreationCode, OrgDeletionLog: RLS enabled, NO policies
-- and NO grants. Reached only through the definer functions above.

-- Receipt (PR 1R): direct organizationId policies replace 0B's EXISTS-only
-- ones. The row rule is still canAccessTransaction (receipts-actions.ts):
-- the submitter, an OWNER or a TREASURER. The composite FK keeps
-- Receipt.organizationId equal to its Transaction's.
DROP POLICY app_user_select ON "Receipt";
DROP POLICY app_user_insert ON "Receipt";
DROP POLICY app_user_delete ON "Receipt";
DROP POLICY app_service_select ON "Receipt";
DROP POLICY app_service_insert ON "Receipt";
DROP POLICY app_service_delete ON "Receipt";
CREATE POLICY app_user_select ON "Receipt" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND EXISTS (SELECT 1 FROM "Transaction" t WHERE t."id" = "Receipt"."transactionId"
                     AND (t."submittedById" = (SELECT app.user_id()) OR (SELECT app.is_finance()))));
CREATE POLICY app_user_insert ON "Receipt" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id())
              AND "uploadedById" = (SELECT app.user_id())
              AND EXISTS (SELECT 1 FROM "Transaction" t WHERE t."id" = "Receipt"."transactionId"
                          AND (t."submittedById" = (SELECT app.user_id()) OR (SELECT app.is_finance()))));
CREATE POLICY app_user_delete ON "Receipt" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND EXISTS (SELECT 1 FROM "Transaction" t WHERE t."id" = "Receipt"."transactionId"
                     AND (t."submittedById" = (SELECT app.user_id()) OR (SELECT app.is_finance()))));
CREATE POLICY app_service_select ON "Receipt" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "Receipt" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "Receipt" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

-- ---- Grants ---------------------------------------------------------------
REVOKE ALL ON "OrgSettings", "OrgIntegration", "OrgSlugHistory", "OrgCreationCode", "OrgExport", "OrgDeletionLog"
  FROM PUBLIC, app_user, app_service, app_auth, app_legacy;
GRANT SELECT, UPDATE ON "OrgSettings" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "OrgIntegration" TO app_user;
GRANT SELECT, INSERT ON "OrgExport" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "OrgSettings", "OrgIntegration", "OrgExport" TO app_service;

REVOKE EXECUTE ON FUNCTION app.ensure_org_defaults(text), app.organization_defaults(), app.reserved_slugs(),
  app.organization_slug_guard(), app.resolve_org_slug(text),
  app.issue_org_creation_code(text, text, text, timestamp), app.list_org_creation_codes(integer),
  app.redeem_org_creation_code(text, text), app.log_org_deletion(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_org_slug(text) TO app_user, app_service;
GRANT EXECUTE ON FUNCTION app.slug_available(text) TO app_service;
GRANT EXECUTE ON FUNCTION app.issue_org_creation_code(text, text, text, timestamp), app.list_org_creation_codes(integer),
  app.redeem_org_creation_code(text, text), app.log_org_deletion(text, text) TO app_service;
