# Architecture

## Data layer: roles, RLS and the transaction wrappers

The runtime never connects as the table owner. Four runtime roles, all
`NOBYPASSRLS` non-owners (created `NOLOGIN` by migration
`20260922000400_0b_rls_roles_policies_triggers`; production pre-creates them
with `LOGIN PASSWORD`, see RUNBOOK):

| Role | Client (`src/server/db`) | Used by |
|---|---|---|
| `app_user` | `appDb` | request code, only through the wrappers below |
| `app_service` | `serviceDb` | jobs, crons, the secrets accessor, the enumerated no-context paths |
| `app_auth` | `authDb` | the Auth.js adapter, credentials sign-in, sign-up, ICS token lookup, the rate limiter |
| `app_legacy` | `legacyDb` (= `@/lib/prisma`) | TEMPORARY: modules not yet moved to `withOrgAction`; dropped when none remain |

URLs come from `src/server/db/urls.ts`: explicit `DATABASE_URL_APP` /
`_SERVICE` / `_AUTH` / `_LEGACY`, or derived from `DATABASE_URL` plus the four
role passwords (Neon previews). There is no fallback to the owner URL.

**Transaction-bound context.** Every unit of work is one interactive
transaction whose first statement is `SELECT app.set_context(user, org)`: it
sets `app.user_id` / `app.org_id` transaction-locally, stamps them with the
current transaction (`app.ctx_tx`) so a context leaked onto a pooled
connection is dead in the next transaction, and returns the caller's `Role`.
Policies compare `organizationId` with `app.member_org_id()` (the org only if
the user is a member of it), so the database enforces membership, not just
org equality. The wrappers in `src/server/db/context.ts`:

- `withOrgAction(handler)` for Server Actions, `(organizationId, ...args)`;
- `withOrgTx(orgId, fn)` for page reads (retries once if the transaction
  cannot start);
- `withUserTx(userId, fn)` for the user's own cross-org rows;
- `withSystemOrgTx(orgId, { userId? }, fn)` for the fail-closed service path;
- `getOrgContextBySlug(slug)`, React `cache()`-deduped, for the org layout.

`ctx = { user, organizationId, role, db, afterCommit }`. No network I/O inside
a transaction: use `ctx.afterCommit(fn)` or enqueue a job
(`app.enqueue_job`, same transaction). A `redirect()`/`notFound()` from the
handler commits and is rethrown after commit; any other throw rolls back.
Database errors that escape map to generic `AppError`s (`src/server/db/errors.ts`).

**Rules for every new table** (checked by `pnpm test:rls`): `ENABLE ROW LEVEL
SECURITY`, per-command policies for `app_user` and `app_service` (the service
ones require `app.org_id() IS NOT NULL`), and explicit GRANTs, all in the
migration that creates the table; add it to the reviewed grant matrix in
`prisma/rls/phases.mjs`; `app.security_manifest()` must stay empty. Child
tables carry `organizationId` with a composite FK to the parent's
`(organizationId, id)`.

**Known limitation.** RLS contains logic bugs, not SQL injection: SQL that
runs as a runtime role can call `set_config()` itself and forge the context
(test T29). The injection control is the ban on `$queryRawUnsafe`,
`$executeRawUnsafe` and `Prisma.raw` in request code.

**Tests.** `pnpm test:rls` creates a throwaway database owned by a
non-superuser role (like `neondb_owner`), applies every migration,
`prisma/rls/local-roles.sql` and `prisma/rls/fixtures.sql`, and runs the
regression suite (`tests.mjs`), the executed attack suite (`attacks.mjs`) and
the Phase 1-9 suite with the catalog checks (`phases.mjs`).

## Tenancy model

CBC Portal is multi-tenant at the **organization** level: one deployment can
host many clubs, and every piece of data (tasks, notes, events, transactions,
labels, projects...) belongs to exactly one `Organization` via an
`organizationId` foreign key. There is no schema-per-tenant or
database-per-tenant split — it's a single shared Postgres database. Tenant
scoping is enforced **in the database** with Postgres Row-Level Security under
non-owner runtime roles (see "Data layer" below); the app-level guards stay as
the friendlier first check.

A user's relationship to an org is a `Membership` row carrying a `Role`
(`OWNER`, `ADMIN`, `TREASURER`, `MEMBER`). A user can belong to multiple
orgs (e.g. someone in two clubs); the "active org" the UI shows is tracked
in a cookie (`src/lib/active-org-cookie.ts`) and every route is namespaced
under `/app/[orgSlug]/...`.

### The guard chain

Every Server Action and route handler that touches tenant data starts by
resolving **who's asking** and **whether they belong to this org**:

- `requireUser()` — resolves the session; throws if unauthenticated.
- `requireOrgMembership(organizationId)` — the above, plus looks up the
  caller's `Membership` for that specific org. Throws `NotFoundError` (not
  `ForbiddenError`) for a non-member, deliberately — a request can't be used
  to probe whether an org exists.
- `requireRole(organizationId, minRole)` / `requireFinanceAccess(organizationId)`
  — membership plus a role floor, for org-management and money actions
  respectively. `TREASURER` is a lateral grant (finance authority) rather
  than a rung on the `MEMBER < ADMIN < OWNER` management ladder — see the
  comment on `ORG_ROLE_RANK` in `src/lib/auth/guards.ts`.
- `withOrgContext` (`src/lib/auth/with-org-context.ts`) wraps most Server
  Actions so `organizationId` + membership are resolved once, consistently,
  before the action body runs.

**This first check is necessary but not sufficient.** The harder bug class —
found and fixed during the Phase 6 authorization audit — is a *second*
lookup inside an already-guarded action: a resource ID that's client-supplied
(a task ID for a "move before this task" reorder, a receipt ID, a category
ID) gets looked up **without** also filtering that lookup by
`organizationId`. The outer guard confirms the caller belongs to *some* org;
it says nothing about whether the specific row they just passed in belongs to
*that* org. Two real instances of this were caught by grep-auditing every
`where: { id: ... }` in every action file and tracing whether an
org-scoped existence check actually covered it:

1. `reorderTask`'s `beforeId`/`afterId` neighbor lookups (`tasks/actions.ts`)
   originally used `prisma.task.findUnique({ where: { id } })` — any task ID
   from *any* org would be accepted and have its `rank` used. Fixed to
   `findFirst({ where: { id, organizationId } })`.
2. Label management (`settings/labels/actions.ts`) had no role check at all
   beyond bare org membership — any `MEMBER` could call `createLabel` /
   `updateLabel` / `deleteLabel` directly, even though the Settings UI only
   showed the controls to admins.

The rule of thumb this produced: **every `where` clause that accepts a
client-supplied ID must include `organizationId` in that same query**, not
just somewhere earlier in the call stack. Regression tests for both bugs
live in `tasks/actions.test.ts` and `settings/labels/actions.test.ts`.

### Money, audit logs, and the one place tenancy isn't just app-code

`FinanceAuditLog` is append-only by design (spec 5.9): the app never issues
an `UPDATE` or `DELETE` against it, and the migration
(`20260913223951_lock_finance_audit_log`) additionally revokes `UPDATE`/
`DELETE` at the Postgres role level. In this dev environment the connecting
role is a superuser, so that revoke has no practical effect locally — it's
real protection only once a properly-scoped, non-superuser production role
exists. This is the one spot where tenancy-adjacent enforcement is meant to
live below the application layer, everywhere else it's guard functions and
scoped queries.

### Public, unauthenticated surfaces

Three routes are deliberately reachable without a session, because they're
meant to be shared outside the org: the guest poll response page
(`/poll/[pollId]`), the invite-accept page (`/invite/[token]`), and the
per-user `.ics` calendar feed (`/api/calendar/feed/[token]`). Each is gated
by an unguessable token instead of a membership check, and each is
rate-limited (`src/lib/rate-limit.ts`) since they're public and don't cost an
email to hit repeatedly. The rate limiter itself is in-memory/per-process —
correct for this single-instance dev setup and a traditional always-on host,
**not** correct across multiple serverless instances (each would track its
own count); a production deploy on multi-instance infra needs a shared store
(Upstash Redis is the standard pairing) behind the same
`checkRateLimit(key, limit, windowMs)` interface.
