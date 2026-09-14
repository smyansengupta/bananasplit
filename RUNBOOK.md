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
3. **First migration** — `vercel.json`'s `buildCommand` runs
   `prisma migrate deploy && next build`, so migrations apply automatically on
   every deploy, including the first one. Nothing manual required.
4. **Auth** — create the Google OAuth client (see spec §11, human step 1:
   `openid email profile` scopes only, no Calendar scope) and add the
   Vercel-assigned domain(s) to its authorized redirect URIs.
5. **Sentry** — create a project (Next.js platform), set
   `NEXT_PUBLIC_SENTRY_DSN` in Vercel. Optionally set `SENTRY_AUTH_TOKEN` /
   `SENTRY_ORG` / `SENTRY_PROJECT` too, so the build step uploads source maps
   (readable stack traces instead of minified ones). Leaving these unset is
   safe — the SDK just doesn't report anything.
6. **Uptime check** — point any external monitor (UptimeRobot, Better Stack,
   Pingdom, a cron-triggered curl, etc.) at `GET /api/health`. It runs
   `SELECT 1` against the DB and returns `503` on failure, `200` on success —
   no auth required, reveals nothing beyond up/down.
7. **Seed the first org** — per spec §11 human step 15, create the real
   club's organization and assign `OWNER` directly in the database (there's
   no "first user becomes owner" bootstrap by design — every org is created
   through the normal onboarding flow, which makes its creator the owner).

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
