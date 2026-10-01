-- File bytes in Postgres, for a deployment with no Vercel Blob store
-- (src/server/storage/database-driver.ts). Club pictures, avatars, receipts
-- and Notes files then work with nothing to set up; with a Blob store the
-- database keeps only what was written before the store existed.
--
-- Like RateLimitBucket and OrgSecret: RLS on, no policies, no table grants.
-- The only way in is the four SECURITY DEFINER functions below, which only
-- app_service may run. Request code reaches them through the storage layer
-- (one allowlisted importer of serviceDb), after the route or action
-- checked the permission of the row that references the key.

-- CreateTable
CREATE TABLE "StoredBlob" (
    "store" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "body" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredBlob_pkey" PRIMARY KEY ("store","key")
);

ALTER TABLE "StoredBlob"
  ADD CONSTRAINT "StoredBlob_store_check" CHECK ("store" IN ('public', 'private')),
  ADD CONSTRAINT "StoredBlob_key_check" CHECK (char_length("key") BETWEEN 1 AND 1024 AND "key" !~ '(^/|\.\.|\s)'),
  ADD CONSTRAINT "StoredBlob_content_type_check" CHECK (char_length("contentType") BETWEEN 1 AND 200),
  ADD CONSTRAINT "StoredBlob_size_check" CHECK ("size" = octet_length("body") AND "size" <= 26214400);

-- ENABLE, not FORCE: with a non-superuser owner, FORCE would blind the
-- definer functions below too (the T32 note in prisma/rls/tests.mjs).
ALTER TABLE "StoredBlob" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "StoredBlob" FROM PUBLIC, app_user, app_service, app_auth;

-- put: inserts once; NULL when the key already exists (keys are immutable,
-- like Vercel Blob with allowOverwrite: false).
CREATE OR REPLACE FUNCTION app.blob_put(p_store text, p_key text, p_content_type text, p_body bytea)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  INSERT INTO public."StoredBlob" ("store", "key", "contentType", "size", "body")
  VALUES (p_store, p_key, p_content_type, octet_length(p_body), p_body)
  ON CONFLICT ("store", "key") DO NOTHING
  RETURNING true;
$$;

CREATE OR REPLACE FUNCTION app.blob_get(p_store text, p_key text)
RETURNS TABLE ("contentType" text, "body" bytea)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT b."contentType", b."body" FROM public."StoredBlob" b
  WHERE b."store" = p_store AND b."key" = p_key;
$$;

CREATE OR REPLACE FUNCTION app.blob_delete(p_store text, p_keys text[])
RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH gone AS (
    DELETE FROM public."StoredBlob" b
    WHERE b."store" = p_store AND b."key" = ANY (p_keys)
    RETURNING 1
  )
  SELECT count(*)::integer FROM gone;
$$;

-- list: keys under a prefix, in key order, after the cursor (the last key
-- of the previous page). At most 1000 per page.
CREATE OR REPLACE FUNCTION app.blob_list(p_store text, p_prefix text, p_after text, p_limit integer)
RETURNS TABLE ("key" text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT b."key" FROM public."StoredBlob" b
  WHERE b."store" = p_store
    AND starts_with(b."key", p_prefix)
    AND (p_after IS NULL OR b."key" > p_after)
  ORDER BY b."key"
  LIMIT LEAST(GREATEST(coalesce(p_limit, 1000), 1), 1000);
$$;

REVOKE ALL ON FUNCTION app.blob_put(text, text, text, bytea), app.blob_get(text, text),
  app.blob_delete(text, text[]), app.blob_list(text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.blob_put(text, text, text, bytea), app.blob_get(text, text),
  app.blob_delete(text, text[]), app.blob_list(text, text, text, integer) TO app_service;
