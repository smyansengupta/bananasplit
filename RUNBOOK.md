# Deployment & Operations Runbook

This app has **not been deployed yet** — Phase 6.6 prepared the configuration
(build-step migrations, env vars, Sentry, an uptime endpoint) without creating
any real Vercel/Neon/Sentry accounts. This doc is what whoever deploys it
needs, plus what to do when something breaks.

## First deploy

1. **Neon** — create a project, enable the **Vercel integration** (Neon
   dashboard → Integrations) rather than pasting a connection string by hand.
   This is what gives you a **fresh DB branch per Vercel preview deployment**
   automatically — preview PRs never touch production data.
2. **Vercel** — import this repo. The Neon integration injects `DATABASE_URL`
   per-environment; fill in the rest of `.env.example` under Project Settings
   → Environment Variables (Production and Preview separately where values
   differ, e.g. `NEXT_PUBLIC_APP_URL`).
3. **Database roles (before the first deploy that includes migration
   `20260922000400_0b_rls_roles_policies_triggers`)** — the app never
   connects as the table owner. As `neondb_owner`, in the SQL editor of the
   production parent branch (never through the Neon Console or API, which add
   `neon_superuser` membership), create the four runtime roles with
   generated passwords:
   ```sql
   CREATE ROLE app_user    LOGIN PASSWORD '<generated>' NOSUPERUSER NOBYPASSRLS NOINHERIT;
   CREATE ROLE app_service LOGIN PASSWORD '<generated>' NOSUPERUSER NOBYPASSRLS NOINHERIT;
   CREATE ROLE app_auth    LOGIN PASSWORD '<generated>' NOSUPERUSER NOBYPASSRLS NOINHERIT;
   CREATE ROLE app_legacy  LOGIN PASSWORD '<generated>' NOSUPERUSER NOBYPASSRLS NOINHERIT;
   ```
   Store the passwords as `APP_DB_PASSWORD`, `SERVICE_DB_PASSWORD`,
   `AUTH_DB_PASSWORD` and `LEGACY_DB_PASSWORD` in Vercel (Production scope;
   previews get their own values). The runtime URLs are derived from
   `DATABASE_URL` with the role swapped in (`src/server/db/urls.ts`). Without
   this step the migration creates the roles `NOLOGIN` and the app cannot
   connect. Also set `SECRETS_KEK_V1`, `SECRETS_KEK_CURRENT`,
   `SECRETS_FINGERPRINT_KEY`, `CRON_SECRET` and `PLATFORM_ADMIN_EMAILS`
   (see `.env.example`). Locally, `pnpm db:local-roles` gives the roles the
   password `test`.
4. **First migration** — `vercel.json`'s `buildCommand` runs
   `prisma migrate deploy && next build`, so migrations apply automatically on
   every deploy, including the first one. Nothing manual required.
5. **Auth** — create the Google OAuth client (see spec §11, human step 1:
   `openid email profile` scopes only, no Calendar scope) and add the
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
   `200 {"status":"ok"}` only when all four runtime URLs log in as their
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

## Security switches (Phase 0A)

- **Org creation lock.** In production (`VERCEL_ENV=production`, or
  `NODE_ENV=production` off Vercel) only a verified address listed in
  `PLATFORM_ADMIN_EMAILS` (comma-separated) can create an organization.
  Everyone else joins by invitation. Previews and local dev are unrestricted.
  The President creates the CBC org once through `/onboarding`.
- **Email verification.** Password sign-ups must verify their address before
  they can create or join an org, so the platform sender (`RESEND_API_KEY`,
  `EMAIL_FROM` on a verified domain) must work on day one. The link goes out
  through the outbox (a `verify-email` job). Without a key, outside
  production, the mail sink writes it to the server log and `.data/mail/`.
  Google sign-ins count as verified when Google says the address is.
- **Google account linking.** A Google sign-in links to an existing account
  with the same verified address; an unverified password account squatting on
  that address is deleted first (or loses its password if it already joined
  an org). Google sign-ins whose address Google has not verified are refused.
- **Content Security Policy.** `/app`, `/poll`, `/invite` and the auth pages
  get a per-request nonce policy (`src/proxy.ts`); every other route gets a
  static policy (`next.config.ts`). Production starts in report-only mode.
  After a week of preview use, read the `[csp]` lines that
  `/api/csp-report` logs; when there are none that matter, set
  `CSP_MODE=enforce` in the Production scope and redeploy (the static policy
  is fixed at build time).
- **Receipts** are capped at 4 MB per file (Vercel's request body limit);
  the browser shrinks larger photos before uploading.

## Restoring from backup

Neon takes continuous WAL-based backups and supports **point-in-time
restore** via branching — you do not need a separate pg_dump backup job for
day-to-day safety, though keeping periodic dumps offsite is still cheap
insurance (see below).

### Point-in-time restore (Neon branching) — preferred

1. Neon dashboard → your project → **Branches** → **Create branch** → choose
   "Restore to point in time" and pick a timestamp before the incident.
2. This creates a **new branch**, not a destructive rewrite of `main` — the
   bad state is still there on the original branch if you need to compare.
3. Verify the restored branch looks right (spot-check a few tables via the
   Neon SQL editor, or `psql` against its connection string).
4. In Vercel, update `DATABASE_URL` (Production env var) to the restored
   branch's connection string, then redeploy (or just redeploy — Vercel picks
   up the new env var on the next build).
5. Once confirmed stable, either promote the restored branch to be the new
   `main`, or leave it as-is and keep pointing `DATABASE_URL` at it — Neon
   branches are full Postgres instances, not read replicas.

### From a manual pg_dump

If you also keep periodic `pg_dump` archives (recommended for anything you
don't want dependent on one vendor's continuous-backup retention window):

```bash
# Restore into a fresh Neon branch/database, never over production directly.
pg_restore --clean --if-exists --no-owner --dbname="$RESTORE_TARGET_URL" backup.dump
```

Then run `prisma migrate deploy` against that target if the dump predates
migrations that have since shipped, before pointing the app at it.

### After any restore

- Check `FinanceAuditLog` and `Notification` row counts look plausible for
  the restore point — these are the two tables most likely to reveal a
  restore landed at the wrong timestamp (they're append-only and
  high-frequency).
- Confirm `_prisma_migrations` matches what `prisma migrate status` expects
  locally; run `prisma migrate deploy` again if not — it's idempotent.
- Rotate `AUTH_SECRET` and any tokens if the incident involved a compromise,
  not just data loss (a restore doesn't undo a leaked secret).

## Treasurer handoff

See [`docs/EBOARD-HANDBOOK.md`](docs/EBOARD-HANDBOOK.md) (spec 6.7 / §11
human step 10) for the end-of-year ritual: who reconciles the final budget
period, who verifies the closing balance, and how `OWNER`/`TREASURER` roles
get reassigned.
