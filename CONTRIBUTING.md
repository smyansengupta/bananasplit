# Contributing

This is a small student-club codebase, not an open-source project with a
formal review process — this doc is mainly for whoever picks it up next.

## Local setup

See the README for install/env/seed steps. Short version:

```bash
pnpm install
cp .env.example .env   # fill in DATABASE_URL and AUTH_SECRET at minimum
pnpm prisma migrate dev
pnpm db:seed
pnpm dev
```

## Making a change

1. **Schema changes go through a migration, always.** Edit
   `prisma/schema.prisma`, then run `pnpm prisma migrate dev` to generate and
   apply the migration, and `pnpm prisma generate` (usually automatic) to
   refresh the generated client under `src/generated/prisma`. Never hand-edit
   the database and never edit an already-applied migration file — write a
   new one.
2. **Prisma enum imports**: in a `"use client"` file, import enums from
   `@/generated/prisma/enums`, not `@/generated/prisma/client` — the full
   client import breaks Turbopack's client bundling. Server-only files can
   import from `@/generated/prisma/client`.
3. **Every tenant-scoped query must filter by `organizationId` in the same
   query**, not just rely on an outer membership check. A resource ID that's
   client-supplied (task ID, transaction ID, etc.) can belong to a different
   org than the caller's session — always include `organizationId` in the
   `where` clause that looks it up, even if a guard already ran. See the
   authorization audit notes in `docs/ARCHITECTURE.md` for the two real bugs
   this exact pattern caught.
4. **Server Actions**: gate with `withOrgContext` / `requireOrgMembership` /
   `requireFinanceAccess` from `src/lib/auth/`. Don't write a new ad-hoc guard.
5. **Money is always integer cents.** Never store or compute with floats for
   currency; see `src/lib/finance/money.ts`.

## Tests

```bash
pnpm test           # vitest — unit/integration tests, mocked or a real local DB
pnpm test:e2e       # playwright — full browser flows against a real dev server + DB
```

- Unit tests mock `prisma`. Integration tests that need real Postgres
  behavior (e.g. `dashboard.integration.test.ts`) probe for a live DB at
  import time and skip themselves (`describe.skipIf`) if one isn't reachable
  — they're a no-op in CI, real in local dev.
- `pnpm test:e2e` starts its own dev server on port 3100 (see
  `playwright.config.ts`) so it doesn't collide with one you're already
  running on 3000. Each spec creates its own org/users with timestamped
  emails, so runs don't collide with seeded data or each other.
- Add a migration-backed regression test (mocked or real-DB, whichever
  matches the existing tests in that file) for any authorization or
  cross-tenant fix — that's exactly the class of bug that's easy to
  reintroduce silently.

## Before committing

```bash
pnpm typecheck
pnpm lint
pnpm test
```

`pnpm test:e2e` is slower (spins up a real server + browser); run it before
anything touching auth, the kanban board, notes, calendar/polls, or finance —
i.e. anything the two E2E flows actually exercise.
