# CBC Portal

A multi-tenant workspace for student club executive boards: task management, notes, meeting
scheduling, and finance tracking.

## Stack

Next.js (App Router) + React + TypeScript, Postgres via Prisma, Auth.js (Google OAuth), Tailwind
CSS + shadcn/ui. See the project spec for the full rationale.

## Local setup

1. **Install dependencies**

   ```bash
   pnpm install
   ```

2. **Configure environment variables**

   ```bash
   cp .env.example .env
   ```

   Fill in `DATABASE_URL` (a local or Neon Postgres instance) and, once you reach Phase 1,
   `AUTH_SECRET` / `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`. See `.env.example` for what each
   variable is for.

3. **Set up the database** (from Phase 0.3 onward)

   ```bash
   pnpm prisma migrate dev
   pnpm db:seed
   ```

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

## Project status

Following the phased build-out in the project spec. Currently: Phase 0 — Foundation.
