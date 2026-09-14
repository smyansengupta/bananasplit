# Architecture

## Tenancy model

CBC Portal is multi-tenant at the **organization** level: one deployment can
host many clubs, and every piece of data (tasks, notes, events, transactions,
labels, projects...) belongs to exactly one `Organization` via an
`organizationId` foreign key. There is no schema-per-tenant or
database-per-tenant split — it's a single shared Postgres database with
row-level tenant scoping enforced entirely in application code (Postgres
Row-Level Security is not used; every query is trusted to filter correctly).

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
