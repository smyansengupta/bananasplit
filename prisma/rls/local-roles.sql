-- LOCAL AND CI ONLY. Gives the three runtime roles LOGIN with the password
-- 'test' so the app (DATABASE_URL_APP/_SERVICE/_AUTH in .env) and
-- pnpm test:rls can connect. The 0B migration creates the roles NOLOGIN;
-- production pre-creates them with generated passwords instead (RUNBOOK).
-- Roles are cluster-global: run this once per Postgres cluster, as a role
-- that may alter them (locally the postgres superuser):
--   psql -U postgres -d postgres -f prisma/rls/local-roles.sql
-- or `pnpm db:local-roles`. Never apply it to a shared or hosted database.
ALTER ROLE app_user    LOGIN PASSWORD 'test';
ALTER ROLE app_service LOGIN PASSWORD 'test';
ALTER ROLE app_auth    LOGIN PASSWORD 'test';
