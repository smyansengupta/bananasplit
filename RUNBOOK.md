# Deployment & Operations Runbook

The app deploys to Vercel. Its production database is a dedicated Supabase
project (Postgres 17, us-east-1), set up by hand with steps 1-4 below. This
doc is what whoever deploys it needs, plus what to do when something breaks.
Neon, which the app was first prepared for, still works: see "Alternative:
Neon" at the end of "First deploy".

## First deploy

Steps 1-4 are the database, in this order. Run the SQL in the Supabase
dashboard's SQL editor, which connects as `postgres`: the project's owner
role, not a superuser, and the role the migrations expect to run as (it
owns every table, so it bypasses RLS and the app never connects as it).

1. **A Supabase project for the portal alone.** Create a new project; never
   use the club website's project (the website data source an org syncs
   from), so the portal's tables, roles and grants never sit beside another
   app's. Keep the database password set at creation in the password
   manager: the migration URL uses it. Then **turn off the Data API** in the
   project settings. The portal never uses PostgREST or supabase-js, and
   with the Data API on, anything ever granted to `anon` or `authenticated`
   is reachable from the internet with the project's public key.
2. **Set up the database, in order.**
   1. **Before the first migration, stop Supabase's default grants.**
      Supabase's default privileges grant every table, sequence and function
      `postgres` creates in `public` to its API roles `anon`,
      `authenticated` and `service_role` (which has BYPASSRLS). The
      migrations create everything as `postgres`, so without this every
      portal table would be granted to them:
      ```sql
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role;
      ```
   2. **Migrate through the session pooler**, as `postgres.<project-ref>` on
      port 5432 (the "Session pooler" string in the dashboard's Connect
      panel), from a trusted machine:
      ```bash
      read -s MIGRATE_DATABASE_URL   # paste the URL; it stays out of shell history
      export MIGRATE_DATABASE_URL    # postgresql://postgres.<project-ref>:<db password>@<pooler host>:5432/postgres
      pnpm prisma migrate deploy
      ```
      Session mode, not the transaction pooler on 6543:
      `prisma migrate deploy` holds a session-level advisory lock for the
      whole run. The 0B
      migration (`20260922000400_0b_rls_roles_policies_triggers`) creates
      `app_user`, `app_service` and `app_auth` `NOLOGIN`, with their `UTC` /
      `15s` / `15s` session defaults. Later deploys migrate from the Vercel
      build (step 3).
   3. **After the migrations, revoke what the API roles still hold** in the
      portal's two schemas (anything granted before 2.1 took effect, or by
      another role's default privileges). Safe to re-run after any
      migration:
      ```sql
      REVOKE ALL ON ALL TABLES    IN SCHEMA public, app FROM anon, authenticated, service_role;
      REVOKE ALL ON ALL SEQUENCES IN SCHEMA public, app FROM anon, authenticated, service_role;
      REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public, app FROM anon, authenticated, service_role;
      ```
   4. **Pin down `public.rls_auto_enable()`.** Supabase ships this
      `SECURITY DEFINER` event-trigger function, owned by `postgres`; its
      `ensure_rls` event trigger turns RLS on for every new table in
      `public`. Keep the trigger, it is a useful net. But the function lives
      in `public`, which the runtime roles can reach, it runs as `postgres`
      whenever anyone's DDL fires the trigger (a runtime role's included),
      and it ships with PUBLIC `EXECUTE` and without the pinned search_path
      that every definer function here has. It was the only
      security-manifest finding in a reachable schema (`public_execute`,
      `definer_search_path`):
      ```sql
      REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
      ALTER FUNCTION public.rls_auto_enable() SET search_path = pg_catalog, public, pg_temp;
      ```
      Then check the trigger still works (the `SELECT` must say `t`):
      ```sql
      CREATE TABLE public.zz_rls_probe (id int);
      SELECT relrowsecurity FROM pg_class WHERE oid = 'public.zz_rls_probe'::regclass;
      DROP TABLE public.zz_rls_probe;
      ```
      A project without `rls_auto_enable()` skips this step.
   5. **Give the runtime roles logins.** Generate one password per role
      (`openssl rand -hex 32`; hex needs no URL-encoding). They live in the
      password manager and in Vercel only: never in git, a migration or a
      script. Send the server a SCRAM-SHA-256 verifier computed on your
      machine rather than the plaintext, which travels as SQL text and can
      end up in the server's statement log. psql does this through the
      session pooler: `\password` hashes on the client and sends only the
      verifier.
      ```
      ALTER ROLE app_user LOGIN;
      \password app_user
      ```
      and the same for `app_service` and `app_auth`. Otherwise run
      `ALTER ROLE app_user LOGIN PASSWORD 'SCRAM-SHA-256$4096:...'` with a
      verifier generated locally; if you must type a plaintext password, do
      it in the dashboard's SQL editor and nowhere else.
   6. **`app_legacy`.** The 0B migration also creates `app_legacy`, and
      `20260924120000_0c_drop_app_legacy` revokes everything from it but
      drops it only when this is the cluster's single application database.
      If `SELECT 1 FROM pg_roles WHERE rolname = 'app_legacy'` still returns
      a row, run `DROP ROLE app_legacy;` (the same applies to any cluster
      upgraded from before 0C, once every database on it has run 0C).
3. **Vercel.** Import this repo and set the database variables in the
   **Production scope only**:

   | Variable | Value |
   |---|---|
   | `MIGRATE_DATABASE_URL` | the owner's session-pooler URL from 2.2. `vercel.json`'s `buildCommand` (`prisma migrate deploy && next build`) migrates with it on every production deploy. |
   | `DATABASE_URL_APP` | `postgresql://app_user.<project-ref>:<password>@<pooler host>:6543/postgres` |
   | `DATABASE_URL_SERVICE` | the same with `app_service.<project-ref>` and its password |
   | `DATABASE_URL_AUTH` | the same with `app_auth.<project-ref>` and its password |

   The runtime URLs use the transaction pooler (port 6543) and must be set
   explicitly: Supavisor expects `role.<project-ref>` usernames, and the
   derive-from-`DATABASE_URL` path in `src/server/db/urls.ts` only swaps in
   the bare role name. Leave `DATABASE_URL`, `DATABASE_URL_UNPOOLED` and
   `APP_DB_PASSWORD` / `SERVICE_DB_PASSWORD` / `AUTH_DB_PASSWORD` unset:
   nothing needs them once these four are set. **None of the database
   variables may appear in the Preview scope** (see "Vercel previews"
   below). Then fill in the rest of `.env.example` under Project Settings →
   Environment Variables, Production and Preview separately where values
   differ (e.g. `NEXT_PUBLIC_APP_URL`): at least `SECRETS_KEK_V1`,
   `SECRETS_KEK_CURRENT`, `SECRETS_FINGERPRINT_KEY`, `CRON_SECRET` and
   `PLATFORM_ADMIN_EMAILS`. Locally none of this applies:
   `pnpm db:local-roles` gives the roles the password `test`.
4. **Verify the database, then deploy.** In the SQL editor, both of these
   must return no rows:
   ```sql
   SELECT * FROM app.security_manifest();

   -- anything the API roles can still use in the portal's schemas
   SELECT r.rolname, c.oid::regclass::text AS object
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, pg_roles r
    WHERE n.nspname IN ('public', 'app') AND r.rolname IN ('anon', 'authenticated', 'service_role')
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
      AND (has_table_privilege(r.oid, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
           OR (c.relkind = 'S' AND has_sequence_privilege(r.oid, c.oid, 'USAGE, SELECT, UPDATE')))
   UNION ALL
   SELECT r.rolname, p.oid::regprocedure::text
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace, pg_roles r
    WHERE n.nspname IN ('public', 'app') AND r.rolname IN ('anon', 'authenticated', 'service_role')
      AND has_function_privilege(r.oid, p.oid, 'EXECUTE');
   ```
   Store the passwords as `APP_DB_PASSWORD`, `SERVICE_DB_PASSWORD` and
   `AUTH_DB_PASSWORD` in Vercel (Production scope;
   previews get their own values). The runtime URLs are derived from
   `DATABASE_URL` with the role swapped in (`src/server/db/urls.ts`). Without
   this step the migration creates the roles `NOLOGIN` and the app cannot
   connect. Also set `SECRETS_KEK_V1`, `SECRETS_KEK_CURRENT`,
   `SECRETS_FINGERPRINT_KEY`, `CRON_SECRET` and `PLATFORM_ADMIN_EMAILS`
   (see `.env.example`). Locally, `pnpm db:local-roles` gives the roles the
   password `test`.
   A cluster upgraded from before `20260924120000_0c_drop_app_legacy` also
   has an `app_legacy` role. That migration revokes everything from it in the
   database it runs on, and drops the role only when that is the cluster's
   single application database; otherwise drop it by hand (`DROP ROLE
   app_legacy`) once every database has run the migration.
4. **First migration** — `vercel.json`'s `buildCommand` runs
   `prisma migrate deploy && next build`, so migrations apply automatically on
   every deploy, including the first one. Nothing manual required.
5. **Auth** — sign-in is email/password only for now ("Continue with
   Google" is hidden in the UI), so the Google sign-in client is optional
   until the button comes back. When it does: create the Google OAuth client
   (see spec §11, human step 1: `openid email profile` scopes only, no
   Calendar scope), set `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`, and add the
   Vercel-assigned domain(s) to its authorized redirect URIs. Google
   Calendar sync uses a **second, separate** OAuth client
   (`GOOGLE_CALENDAR_CLIENT_ID` / `_SECRET`, Calendar API enabled, scopes
   `calendar.events.owned` and `calendar.calendarlist.readonly`, a published
   and verified consent screen); the sign-in client never asks for Calendar
   access. Setup and the public events feed: `docs/features/calendar.md`.
6. **Sentry** — create a project (Next.js platform), set
   `NEXT_PUBLIC_SENTRY_DSN` in Vercel. Optionally set `SENTRY_AUTH_TOKEN` /
   `SENTRY_ORG` / `SENTRY_PROJECT` too, so the build step uploads source maps
   (readable stack traces instead of minified ones). Leaving these unset is
   safe — the SDK just doesn't report anything.
7. **Health check (gate every deploy on it)** — `GET /api/health` returns
   `200 {"status":"ok"}` only when all three runtime URLs log in as their
   roles (not superuser, no BYPASSRLS, owning nothing) with the `UTC` /
   `15s` / `15s` session defaults, `app.security_manifest()` is empty, and the
   environment checks pass (production: `RESEND_API_KEY` plus `EMAIL_FROM` on
   the app's domain, or `EMAIL_DELIVERY=off`; `CRON_SECRET`; the secrets
   keyring and `SECRETS_FINGERPRINT_KEY`; an https `NEXT_PUBLIC_APP_URL`.
   Previews: the `app.fixture_only` marker, no live mail, the preview Blob
   stores and KEK). Anything else is `503`. To see which check failed:
   `curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/health`.
   Point the uptime monitor at the plain URL; it reveals nothing beyond
   up/down.
8. **Background jobs** — mail, reminders, syncs and maintenance run from the
   job outbox (`/api/cron/jobs`, fail-closed on `CRON_SECRET`). `vercel.json`
   has a daily backstop cron (Hobby allows only daily crons). Then either:
   - **Pro**: change the `/api/cron/jobs` schedule in `vercel.json` to
     `*/5 * * * *`; or
   - **Hobby**: set the repository secrets `JOBS_DRAIN_URL`
     (`https://<production host>/api/cron/jobs`) and `CRON_SECRET`; the
     `Jobs pinger` workflow then drains every 15 minutes.
   Fast jobs (email) also drain right after the request that enqueued them,
   so mail does not wait for the cron. Previews drain nothing unless their
   database is marked fixture-only. Locally: `pnpm jobs:drain` (or
   `--watch`); mail lands in `.data/mail/` unless `RESEND_API_KEY` is set.
   Stuck or failed jobs are visible to org admins in the `Job` table
   (`status` `DEAD`, sanitized `lastError`); fix the cause, then re-enqueue.
9. **Secrets keyring** — generate `SECRETS_KEK_V1` and
   `SECRETS_FINGERPRINT_KEY` (base64 of 32 random bytes each:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`)
   and keep a copy offline: losing the KEK makes every stored integration key
   unreadable (admins would have to re-enter them). Previews get their own
   keyring (`SECRETS_KEK_ENV=preview`, and `PREVIEW_KEK_FINGERPRINT` in the
   Preview scope, which `/api/health` compares). **Rotation**: add
   `SECRETS_KEK_V2`, set `SECRETS_KEK_CURRENT=2`, deploy, run
   `MIGRATE_DATABASE_URL=<owner url> pnpm secrets:rotate-kek` (use
   `--dry-run` first), and remove `SECRETS_KEK_V1` once a dry run reports 0
   left.
10. **Seed the first org** — per spec §11 human step 15, create the real
   club's organization and assign `OWNER` directly in the database (there's
   no "first user becomes owner" bootstrap by design — every org is created
   through the normal onboarding flow, which makes its creator the owner).
   **Never run `pnpm db:seed` against production.** The seed is local,
   preview and CI data: it deletes and recreates the orgs it seeds,
   including `claude-builders-club`, and creates users whose password is
   `password123`. It refuses only when `VERCEL_ENV=production`, so a local
   shell holding the production URL is not stopped.

### Vercel previews

The Neon integration gave every preview its own database branch. This
Supabase setup has no per-preview database, so:

- **Never put a production database variable in the Preview scope**
  (`MIGRATE_DATABASE_URL`, `DATABASE_URL`, `DATABASE_URL_UNPOOLED`,
  `DATABASE_URL_APP` / `_SERVICE` / `_AUTH`, the `*_DB_PASSWORD`s). Preview
  builds run `prisma migrate deploy` too, so an unmerged branch's migrations
  would be applied to production, and the preview would serve production
  data to anyone with its link.
- **Option A: a preview database.** A second Supabase project used only by
  previews (never production's, never the website's), set up with steps 1-2
  like production, with its own URLs and passwords in the Preview scope
  only. Seed it with fixture data (`pnpm db:seed` exists for this) and mark
  it fixture-only:
  ```sql
  ALTER DATABASE postgres SET app.fixture_only = 'on';
  ```
  On a preview, `/api/health` answers 503 and the job drain refuses to run
  unless `app_service` sees that marker (`previewChecks` in
  `src/server/health.ts`, `drainRefusal` in `src/server/jobs/drain.ts`); if
  the `ALTER DATABASE` is refused, `ALTER ROLE app_service SET
  app.fixture_only = 'on';` works for both. New connections pick it up;
  pooled ones once they reconnect. Previews also need their own Blob stores,
  KEK and `CRON_SECRET`, and no live mail (steps 7 and 9). Every preview
  shares this one database, so a PR that adds a migration applies it there
  for all of them: reseed or recreate the project when an abandoned branch
  leaves it out of step.
- **Option B: no preview database.** Leave every database variable out of
  the Preview scope. Preview builds then stop at `prisma migrate deploy`,
  which has no URL: a loud, safe failure. To skip preview builds instead,
  use Vercel's Ignored Build Step (Project Settings → Git).

### Alternative: Neon

The app still runs on Neon. Enable Neon's **Vercel integration** (Neon
dashboard → Integrations) rather than pasting a connection string: it
injects `DATABASE_URL` and `DATABASE_URL_UNPOOLED` per environment and gives
every preview its own database branch. Before the first deploy that
includes the 0B migration, as `neondb_owner` in the SQL editor of the
production parent branch (never through the Neon Console or API, which add
`neon_superuser` membership, and `app.security_manifest()` reports any role
membership), create the runtime roles with generated passwords:
```sql
CREATE ROLE app_user    LOGIN PASSWORD '<generated>' NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE app_service LOGIN PASSWORD '<generated>' NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE app_auth    LOGIN PASSWORD '<generated>' NOSUPERUSER NOBYPASSRLS NOINHERIT;
```
Store the passwords as `APP_DB_PASSWORD`, `SERVICE_DB_PASSWORD` and
`AUTH_DB_PASSWORD` (Production scope; previews get their own values): the
runtime URLs are then derived from `DATABASE_URL` with the role swapped in
(`src/server/db/urls.ts`), and migrations use `DATABASE_URL_UNPOOLED`.
Without the roles, the migration creates them `NOLOGIN` and the app cannot
connect. Steps 1 to 2.5 and step 3's database variables are
Supabase-specific; 2.6, the rest of step 3, and step 4 apply as written.

## Live collaboration (optional, off by default)

Live editing of notes needs a WebSocket server that Vercel cannot host.
Until one is running, leave it off: notes use the autosave editor. Choices
and trade-offs: `docs/features/collaboration.md`. With the bundled server:

1. **Secret** — `openssl rand -base64 48`; keep a copy offline. It signs the
   editors' tokens and the server-to-server calls, so treat it like
   `AUTH_SECRET`.
2. **Collaboration host** (any always-on Node 22+ host with WebSockets and
   TLS) — deploy this repo, `pnpm install --frozen-lockfile`, run
   `pnpm collab:start` with `COLLAB_SECRET`, `COLLAB_PORT` (or the
   platform's `PORT`) and `COLLAB_APP_URL` set to the app's origin. Give it
   a `wss://` hostname and check `https://<collab host>/` answers 200.
3. **Vercel, Production scope** — `COLLAB_ENABLED=true`,
   `COLLAB_SERVER_URL=wss://<collab host>`, the same `COLLAB_SECRET`, then
   redeploy (migration `20260926120000_note_yjs_state` applies in the build
   step). Leave the Preview scope without `COLLAB_ENABLED`.
4. **Check** — open a note in two browsers: the status says "Live" and each
   sees the other's caret. Add the collaboration host to the uptime monitor.

**If it is down**, notes open in the autosave editor after a few seconds;
live editors that were already connected keep their edits in the tab and
save them when it comes back. Restarting it is safe at any time (it saves
open notes on SIGTERM; editors reconnect).

**Rotating the secret** — set the new `COLLAB_SECRET` on both sides and
restart both (Vercel redeploy, then the collaboration server). Editors open
in between reconnect once they get a token signed with the new value (within
five minutes). **Turning it off** — remove `COLLAB_ENABLED` and redeploy;
nothing else changes (`Note.yjsState` is kept, and autosaves keep it in
step, so turning it on again later is safe).

## Security switches (Phase 0A)

- **Org creation lock.** In production (`VERCEL_ENV=production`, or
  `NODE_ENV=production` off Vercel) only a verified address listed in
  `PLATFORM_ADMIN_EMAILS` (comma-separated) can create an organization
  until `PLATFORM_ORG_CREATION_ENABLED=true` is set; then
  `ORG_CREATION_MODE` (`admins`, `invite` with codes from
  `/app/platform/org-codes`, or `open`) decides. Everyone else joins by
  invitation. Previews and local dev are unrestricted. The President creates
  the CBC org once through `/onboarding`. See docs/features/settings.md.
- **Email verification.** Password sign-ups must verify their address before
  they can create or join an org, so the platform sender (`RESEND_API_KEY`,
  `EMAIL_FROM` on a verified domain) must work on day one. The link goes out
  through the outbox (a `verify-email` job). Without a key, outside
  production, the mail sink writes it to the server log and `.data/mail/`.
  Google sign-ins count as verified when Google says the address is.
- **Google account linking.** (Applies once Google sign-in is back in the
  UI; it is hidden for now.) A Google sign-in links to an existing account
  with the same verified address; an unverified password account squatting on
  that address is deleted first (or loses its password if it already joined
  an org). Google sign-ins whose address Google has not verified are refused.
  While the button is hidden, an account that only ever signed in with Google
  has no password (and there is no reset flow yet), so it cannot sign in
  from `/sign-in`; `/sign-up` refuses the address as already taken.
- **Content Security Policy.** `/app`, `/poll`, `/invite` and the auth pages
  get a per-request nonce policy (`src/proxy.ts`); every other route gets a
  static policy (`next.config.ts`). Both are **enforced** by default, in
  every environment. To trial a policy change, set `CSP_MODE=report-only`
  and redeploy (the static policy is fixed at build time), read the `[csp]`
  lines that `/api/csp-report` logs for a week, then remove the variable.
  Leaving it set is a standing weakness, so treat it as temporary.
- **Receipts** are capped at 4 MB per file (Vercel's request body limit);
  the browser shrinks larger photos before uploading.

## Restoring from backup

### Supabase backups

Supabase takes the backups; what you get depends on the plan (daily
backups on paid plans, with point-in-time recovery as an add-on). Check
**Database → Backups** in the dashboard now, not during an incident: which
backups this project has, how far back they go, and whether a restore
replaces the project's database in place or goes to a new project. If that
page lists nothing, the `pg_dump` archives below are the only backup.

1. **Before restoring over production, dump its current state** (below).
   Unlike a Neon branch, an in-place restore replaces the bad state, and
   the dump is then the only copy left to compare against or to recover
   rows written after the restore point.
2. Restore from the Backups page, to a daily backup or a point in time
   before the incident.
3. If the restore went to a new project, go through First deploy steps 1-2
   for it (the Data API, the grants, `rls_auto_enable()`, the role logins),
   then point `MIGRATE_DATABASE_URL` and `DATABASE_URL_APP` / `_SERVICE` /
   `_AUTH` at its project ref and redeploy.
4. Run "After any restore" below.

### From a manual pg_dump

If you also keep periodic `pg_dump` archives (recommended for anything you
don't want dependent on one vendor's backup retention window), dump only the
portal's schemas: Supabase's own (`auth`, `storage`, `realtime`, ...)
belong to the project. Use the owner's session-pooler URL and a `pg_dump`
at least as new as the server (17):

```bash
pg_dump --format=custom --schema=public --schema=app \
  --dbname="$MIGRATE_DATABASE_URL" --file=backup.dump

# Restore into a fresh Supabase project, never over production directly.
pg_restore --clean --if-exists --no-owner --dbname="$RESTORE_TARGET_URL" backup.dump
```

Roles are not in the dump, and the grants in it name them: set the target
up with First deploy steps 1 and 2 first (the Data API off, the
default-privilege revoke, the migrations, which create the roles, and the
role logins), then restore, then repeat 2.3 and 2.4. `pg_restore` may
report errors for objects Supabase already created in `public` (such as
`rls_auto_enable()`); read them, and expect nothing else. Run `prisma
migrate deploy` against the target if the dump predates migrations that
have since shipped, before pointing the app at it.

### Neon (the alternative)

Neon takes continuous WAL-based backups and restores to a point in time by
branching: Neon dashboard → your project → **Branches** → **Create branch**
→ "Restore to point in time", before the incident. That creates a **new
branch** and leaves the bad state on the original for comparison. Verify
it, point `DATABASE_URL` (Production) at it and redeploy, then either
promote it to `main` or keep pointing at it: Neon branches are full Postgres
instances, not read replicas.

### After any restore

- Check `FinanceAuditLog` and `Notification` row counts look plausible for
  the restore point — these are the two tables most likely to reveal a
  restore landed at the wrong timestamp (they're append-only and
  high-frequency).
- Confirm `_prisma_migrations` matches what `prisma migrate status` expects
  locally; run `prisma migrate deploy` again if not — it's idempotent.
- Run First deploy step 4's two queries (both must return no rows: a
  restore can bring back grants to the API roles or a changed function),
  then check `/api/health` with the `CRON_SECRET` bearer: it catches runtime
  roles that lost their logins or session defaults.
- Rotate `AUTH_SECRET` and any tokens if the incident involved a compromise,
  not just data loss (a restore doesn't undo a leaked secret).

## Treasurer handoff

See [`docs/EBOARD-HANDBOOK.md`](docs/EBOARD-HANDBOOK.md) (spec 6.7 / §11
human step 10) for the end-of-year ritual: who reconciles the final budget
period, who verifies the closing balance, and how `OWNER`/`TREASURER` roles
get reassigned.
