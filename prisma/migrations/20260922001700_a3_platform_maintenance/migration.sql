-- Platform maintenance for the outbox and the rate limiter (builder A3).
-- No schema change: two SECURITY DEFINER functions for the daily
-- `maintenance` job (src/server/jobs/handlers/maintenance.ts), because no
-- runtime role holds DELETE on "Job" or any grant on "RateLimitBucket".
--
-- Both follow the 0B definer rules: search_path pinned to
-- pg_catalog, public, pg_temp; EXECUTE for app_service only (never PUBLIC);
-- bounded arguments, so a caller cannot use them to wipe live state:
--   app.prune_rate_limit_buckets(seconds)  deletes buckets whose window
--       started more than `seconds` ago; at least 2 days, and the TS limiter
--       caps windows at 30 days (the job passes 40 days), so no live window
--       is ever reset.
--   app.prune_jobs(days)  deletes finished jobs (DONE, DEAD, CANCELLED)
--       completed more than `days` ago; at least 7 days. PENDING and RUNNING
--       jobs are never touched.
-- Both return the number of rows deleted.

CREATE OR REPLACE FUNCTION app.prune_rate_limit_buckets(p_older_than_seconds integer)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_older_than_seconds IS NULL OR p_older_than_seconds < 172800 THEN
    RAISE EXCEPTION 'prune_rate_limit_buckets: retention must be at least 2 days' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public."RateLimitBucket" b
   WHERE b."windowStart" < app.utc_now() - make_interval(secs => p_older_than_seconds);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

CREATE OR REPLACE FUNCTION app.prune_jobs(p_older_than_days integer)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_older_than_days IS NULL OR p_older_than_days < 7 THEN
    RAISE EXCEPTION 'prune_jobs: retention must be at least 7 days' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public."Job" j
   WHERE j."status" IN ('DONE', 'DEAD', 'CANCELLED')
     AND j."completedAt" IS NOT NULL
     AND j."completedAt" < app.utc_now() - make_interval(days => p_older_than_days);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

REVOKE EXECUTE ON FUNCTION app.prune_rate_limit_buckets(integer), app.prune_jobs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.prune_rate_limit_buckets(integer), app.prune_jobs(integer) TO app_service;
