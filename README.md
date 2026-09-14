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
   (`npx auth secret`). `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` need a real
   Google Cloud OAuth client (spec section 11, item 1) — request only
   `openid email profile`. Until that exists, placeholder values let the app
   boot; Google sign-in itself won't work, but every seeded user (see below)
   can sign in with email/password instead, so you don't need real Google
   credentials for local development. See `.env.example` for what each
   variable is for.

3. **Set up the database** (from Phase 0.3 onward)

   ```bash
   pnpm prisma migrate dev
   pnpm db:seed
   ```

   Every seeded user (e.g. `alice@example.edu`, see `prisma/seed.ts` for the full roster and
   roles) can sign in at `/sign-in` with password `password123`.

4. **Run the dev server**

   ```bash
   pnpm dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command             | Purpose                          |
| ------------------- | -------------------------------- |
| `pnpm dev`          | Start the dev server             |
| `pnpm build`        | Production build                 |
| `pnpm lint`         | ESLint                           |
| `pnpm typecheck`    | `tsc --noEmit`                   |
| `pnpm format`       | Format with Prettier             |
| `pnpm format:check` | Check formatting without writing |
| `pnpm test`         | Unit/integration tests (Vitest)  |
| `pnpm test:e2e`     | End-to-end browser tests (Playwright) |

## Documentation

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — conventions for making a change.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the multi-tenant model and
  how authorization is enforced.
- [`docs/EBOARD-HANDBOOK.md`](docs/EBOARD-HANDBOOK.md) — for the club's
  e-board, not developers: treasurer handoff, ongoing habits, continuity.
- [`RUNBOOK.md`](RUNBOOK.md) — deploying for the first time and restoring
  from backup.

## Project status

Following the phased build-out in the project spec. Phases 0–6 (foundation
through hardening: notifications, an authorization audit, accessibility
fixes, performance work, E2E tests, and deployment/docs prep) are done.
Per the spec's own sequencing, Phase 7 (stretch: Google Calendar sync,
real-time collaborative editing) is intentionally not started — v1 is meant
to run with a real e-board for a month first.
