# CBC Portal

A multi-tenant workspace for student club executive boards: task management, notes, meeting
scheduling, and finance tracking.

## Stack

Next.js (App Router) + React + TypeScript, Postgres via Prisma, Auth.js (Google OAuth + email/
password), Tailwind CSS + shadcn/ui. See the project spec for the full rationale.

Sign-in supports both Google OAuth and email/password (bcrypt-hashed, `/sign-up` to register).
Email/password is a deliberate addition beyond the original spec, which scoped v1 to Google-only.

## Local setup

1. **Install dependencies**

   ```bash
   pnpm install
   ```

2. **Configure environment variables**

   ```bash
   cp .env.example .env
   ```

   Fill in `DATABASE_URL` (a local or Neon Postgres instance) and `AUTH_SECRET`
   (`npx auth secret`). The app also connects at runtime as three non-owner,
   row-level-security-scoped roles (`app_user` / `app_service` / `app_auth`,
   see `docs/ARCHITECTURE.md`) instead of the owner; locally, set
   `APP_DB_PASSWORD`, `SERVICE_DB_PASSWORD` and `AUTH_DB_PASSWORD` to `test` —
   `pnpm db:local-roles` (next step) gives the roles that same password.
   Generate `SECRETS_KEK_V1` and `SECRETS_FINGERPRINT_KEY` too (base64 of 32
   random bytes each: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`),
   which the secrets-at-rest keyring (integrations settings, `/api/health`)
   needs. `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` need a real
   Google Cloud OAuth client (spec section 11, item 1) — request only
   `openid email profile`. Until that exists, placeholder values let the app
   boot; Google sign-in itself won't work, but every seeded user (see below)
   can sign in with email/password instead, so you don't need real Google
   credentials for local development. See `.env.example` for what each
   variable is for.

3. **Set up the database** (from Phase 0.3 onward)

   ```bash
   pnpm prisma migrate deploy
   pnpm db:local-roles
   pnpm db:seed
   ```

   `migrate deploy` applies the committed migrations without prompting.
   (`pnpm db:migrate`, i.e. `prisma migrate dev`, is for authoring a new
   migration when you change `prisma/schema.prisma` — see CONTRIBUTING.md —
   and can hang on an interactive prompt if run here instead.) `db:local-roles`
   gives the `app_user` / `app_service` / `app_auth` roles (created `NOLOGIN`
   by the migrations) the local password set above; see RUNBOOK.md for how
   production provisions them instead. Every seeded user (e.g.
   `alice@example.edu`, see `prisma/seed.ts` for the full roster and roles)
   can sign in at `/sign-in` with password `password123`.

4. **Run the dev server**

   ```bash
   pnpm dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command                   | Purpose                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------- |
| `pnpm dev`                | Start the dev server                                                                  |
| `pnpm build`              | Production build                                                                      |
| `pnpm start`              | Start a production build (after `pnpm build`)                                         |
| `pnpm lint`               | ESLint                                                                                |
| `pnpm typecheck`          | `next typegen && tsc --noEmit`                                                        |
| `pnpm format`             | Format with Prettier                                                                  |
| `pnpm format:check`       | Check formatting without writing                                                      |
| `pnpm test`               | Unit/integration tests (Vitest)                                                       |
| `pnpm test:rls`           | Row-level-security regression + attack suite (spins up its own throwaway Postgres DB) |
| `pnpm test:e2e`           | End-to-end browser tests (Playwright)                                                 |
| `pnpm db:migrate`         | `prisma migrate dev` — author/apply a migration while changing `prisma/schema.prisma` |
| `pnpm db:seed`            | Seed the local database (`prisma/seed.ts`)                                            |
| `pnpm db:local-roles`     | Give the RLS runtime roles a local login password                                     |
| `pnpm db:studio`          | Prisma Studio                                                                         |
| `pnpm jobs:drain`         | Run due background jobs locally (mail, reminders, syncs, maintenance)                 |
| `pnpm secrets:rotate-kek` | Rewrap stored secrets under a new key-encryption key (see RUNBOOK.md)                 |

## Documentation

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — conventions for making a change.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the multi-tenant model and
  how authorization is enforced.
- [`docs/features/`](docs/features/) — one doc per feature area (calendar,
  tasks, org chart, databases, reports, settings, themes, onboarding,
  profiles, platform services).
- [`docs/EBOARD-HANDBOOK.md`](docs/EBOARD-HANDBOOK.md) — for the club's
  e-board, not developers: treasurer handoff, ongoing habits, continuity.
- [`RUNBOOK.md`](RUNBOOK.md) — deploying for the first time and restoring
  from backup.

## Project status

Following the phased build-out in the project spec. Phases 0–6 (foundation
through hardening: notifications, an authorization audit, accessibility
fixes, performance work, E2E tests, and deployment/docs prep) are done.
Phase 7's Google Calendar sync ([`src/server/google-calendar/`](src/server/google-calendar/)),
the public events feed ([`src/server/public-events/`](src/server/public-events/),
`/api/public/[orgSlug]/events`), and optional notices to event attendees are
built too — see [`docs/features/calendar.md`](docs/features/calendar.md).
Real-time collaborative editing is not: per the spec's own sequencing it
stays intentionally deferred until v1 has run with a real e-board for a
month.
