# Architecture

## Data layer: roles, RLS and the transaction wrappers

The runtime never connects as the table owner. Three runtime roles, all
`NOBYPASSRLS` non-owners (created `NOLOGIN` by migration
`20260922000400_0b_rls_roles_policies_triggers`; production pre-creates them
with `LOGIN PASSWORD`, see RUNBOOK):

| Role | Client (`src/server/db`) | Used by |
|---|---|---|
| `app_user` | `appDb` | request code, only through the wrappers below |
| `app_service` | `serviceDb` | jobs, crons, the secrets accessor, the enumerated no-context paths |
| `app_auth` | `authDb` | the Auth.js adapter, credentials sign-in, sign-up, ICS token lookup, the rate limiter |

URLs come from `src/server/db/urls.ts`: explicit `DATABASE_URL_APP` /
`_SERVICE` / `_AUTH`, or derived from `DATABASE_URL` plus the three role
passwords (Neon previews). There is no fallback to the owner URL.

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

**Write policies need a role predicate.** An `app_user` INSERT/UPDATE/DELETE
policy that tests only `organizationId` is a tenant check, not a permission
check: every member of the org may do it and the app layer is the only
control. `app.security_manifest()`'s `tenant_only_write` check reports any
such policy unless its `table:command` is on the allowlist inside the
function (migration `20260924130000_b9_tenant_write_backstop`), which names
the places members legitimately write — tasks and their collaborators,
labels on a task, comments, mentions, activity, Sunday updates, availability
polls and their slots and responses, event attendees, notifications and a
user's own row. Everything else gets `AND (SELECT app.is_org_admin())` (or
`is_org_owner`, `is_finance`) beside the tenant test. Adding an entry to the
allowlist is a security review item.

**Known limitation.** RLS contains logic bugs, not SQL injection: SQL that
runs as a runtime role can call `set_config()` itself and forge the context
(test T29). The injection control is the ban on `$queryRawUnsafe`,
`$executeRawUnsafe` and `Prisma.raw` (and on `set_config` in any SQL string),
enforced by ESLint (see "Lint" below).

**Tests.** `pnpm test:rls` creates a throwaway database owned by a
non-superuser role (like `neondb_owner`), applies every migration,
`prisma/rls/local-roles.sql` and `prisma/rls/fixtures.sql`, and runs the
regression suite (`tests.mjs`), the executed attack suite (`attacks.mjs`) and
the Phase 1-9 suite with the catalog checks (`phases.mjs`).

## Platform services

Shared services every feature uses. Each module's header comment is the
detailed contract; this is the map.

| Need | Use | Never |
|---|---|---|
| Background work, email, anything network-bound after a write | `enqueueJob(ctx.db, {orgId, kind, key, payload, runAt?, once?})` (`src/server/jobs/`) | network I/O inside a transaction |
| Cache invalidation | `invalidate([tags.x(orgId)])` (`src/server/cache/`) | `updateTag`/`revalidateTag` directly; tag string literals |
| Integration secrets | `setSecret`, `getSecret`, `removeSecret`, `testIntegration` (`src/server/secrets/`) | the `app.secret_*` functions directly; secrets in a DTO or log |
| Files | `putBlob`, `getBlob`, `deleteBlobs`, `deleteOrgBlobs` (`src/server/storage/`); `readUpload` in upload routes | Server Actions for uploads; client file names in keys |
| Images | `storeImage(kind, scopeId, preset, bytes)` (`src/server/images/`) | serving an upload without re-encoding it |
| Email | `notifyUser`/`notifyUsers`/`notifyOrgOwners` (`src/server/notifications.ts`); `getOrgMailer`/`getPlatformMailer` inside job handlers | awaiting Resend in a Server Action |
| Permissions | `can(ctx, perm)`, `requirePermission(ctx, perm)` (`src/lib/auth/permissions.ts`) | inline `role === OWNER` checks |
| Rate limits | `checkRateLimit(rateLimitKey(scope, ...parts), limit, windowSec)` (`src/lib/rate-limit.ts`) | in-memory counters |
| Events (calendar and Sessions) | `createEvent`/`updateEvent`/`deleteEvent`, `publicEventsWhere()` (`src/server/events/service.ts`) | writing `Event` directly |
| Members, avatars | `getOrgMembersForPicker`, `userPublicSelect` (`src/server/members.ts`); `<UserAvatar>` | selecting `User.email` for pickers |
| Org chart | `getPublishedOrgChart`, `getReportingSubtree` (`src/server/org-chart/queries.ts`) | |
| CSV | `toCsv`/`csvCell` (`src/lib/csv.ts`) | hand-rolled escaping |
| Database view links | `dbViewHref(slug, dbKey, params)`, `parseDbViewParams` (`src/lib/databases/href.ts`) | hand-built query strings |

**The outbox (jobs).** `enqueueJob` calls `app.enqueue_job` with the
caller's own client, so the job exists only if the caller's transaction
commits. The dedupe key is `${kind}:${key}` and is per org: a second enqueue
of a PENDING key merges into it, of a RUNNING key re-runs it once more after
it finishes; `once: true` refuses a key that already finished (daily
digests). Every kind is a row in `src/server/jobs/registry.ts` (payload
schema, maxRuntime, lease, tier, after() eligibility, handler); a kind
without a handler is accepted and waits PENDING until its phase adds one.
The runner (`drain.ts`) claims in one short statement, runs the handler with
no transaction open and an AbortSignal at maxRuntime, then finishes with a
compare-and-set on the lock token; a throw retries with backoff
(`PermanentJobError` goes straight to DEAD) and every stored error is
sanitized. Handlers are idempotent (Notification.emailSentAt, Resend
idempotency keys, row versions). Drains run: in the enqueuing request's
`after()` for fast kinds; from `/api/cron/jobs` (Vercel Cron, the GitHub
pinger, or a kick for heavy kinds, fail-closed on `CRON_SECRET`); and locally
with `pnpm jobs:drain [--watch]`. On a preview the drain refuses unless the
database carries `app.fixture_only = 'on'`; with `EMAIL_DELIVERY=off` email
kinds are held.

**Email.** Every send from app code is a job: `notify-email` (the email copy
of a Notification; checks the recipient's preference, claims `emailSentAt`
before sending and releases it on failure), `invite-email` (mints the accept
link at send time, because only the token's hash is stored),
`reimbursement-email`, `verify-email` (platform, from `app_auth`) and the
generic `email` kind (templated org mail such as the treasurer digest).
Routing: the org's own verified Resend sender, else the platform sender "on
behalf of" the org while `OrgSettings.platformMailFallback` is on, else
in-app only. Templates escape every value and link absolutely to
`NEXT_PUBLIC_APP_URL`. Without a Resend key (and on previews) mail goes to the
console and `.data/mail/`. `@/lib/email` remains as thin wrappers that send
immediately through the platform sender; new code should not use it.

**Secrets.** AES-256-GCM envelope encryption: a fresh data key per secret,
wrapped by the current KEK (`SECRETS_KEK_V{n}`, `SECRETS_KEK_CURRENT`), with
additional authenticated data binding the ciphertext to its org, integration,
provider and kind. The ciphertext lives in `OrgSecret`, reachable only
through `app.secret_read/write/delete` on the service role. Set, replace and
test need ADMIN+, remove needs OWNER; every change writes `OrgAuditLog` in the
same transaction and alerts every OWNER. Decryption and network tests run
outside transactions. `pnpm secrets:rotate-kek` rewraps data keys after a KEK
rotation. Every file in `src/server/secrets/` imports `server-only`, so a
client module that reaches one — directly or through a re-export — fails the
build. The package throws outside the Next.js server layer, so the Vitest
config and the `scripts/` entry points (`tsconfig.scripts.json`) map it to the
package's own empty build, the way Next.js resolves it. Sentry events and (in
production) console output pass through the scrubber in
`src/lib/observability/scrub.ts`.

**Storage.** Every file belongs to a kind in `src/server/storage/kinds.ts`
(store, org or user scope, upload cap); keys are `{kind}/{orgId}/...` or
`avatars/{userId}/...`. Vercel Blob when the store's token is set, otherwise
`.data/blob/{store}/` with public files served by the dev-only
`/api/dev/blob/[...key]`. Blob I/O never runs inside a transaction: write the
blob, then the row (delete the blob if the row fails); change the row, then
delete the old blob after commit. Upload route handlers use `readUpload`
(4 MB cap, 413 from Content-Length before reading) and declare
`maxDuration = 60`. Images are re-encoded by sharp (JPEG, PNG or WebP in,
at most 40 MP, EXIF stripped, WebP variants out).

**Health.** `/api/health` answers 503 unless every runtime URL logs in as
its role (no superuser, no BYPASSRLS, owns nothing) with the `UTC`/`15s`/`15s`
session defaults, `app.security_manifest()` is empty, and (on previews) the
database is fixture-only and the mail sink, Blob stores and KEK are the
preview ones, or (in production) email, cron and secrets are configured.
With the `CRON_SECRET` bearer it lists every check.

**Email verification.** Credentials sign-up enqueues `verify-email`; the
link opens `/verify-email/[token]`, which consumes the token only when the
user presses "Confirm email" (mail scanners prefetch links). The daily
`purge-unverified` job deletes password accounts never confirmed within 72
hours that have no Google account and no membership. The Auth.js `signIn`
callback (`googleSignInGate` in `src/lib/auth/google-linking.ts`) refuses a
Google profile whose address Google has not verified, and for a verified one
purges such an account (`src/lib/auth/purge-squatter.ts`) and strips the
password of an unverified account the purge had to keep, before Auth.js looks
the address up. It fails closed, because the Google provider allows email
account linking. The 'check your email' notice (onboarding, invite page) and
the link page share one resend limit per account.

**Lint** (`eslint.config.mjs`). ESLint bans:
- `$queryRawUnsafe`, `$executeRawUnsafe` and `Prisma.raw`;
- `set_config`, `SET SESSION`, `SET app.*` and `RESET app.*` in any SQL string;
- `process.env.DATABASE_URL*` outside `urls.ts` and owner scripts;
- cache-tag string literals outside `tags.ts`, and the `next/cache`
  invalidation APIs outside `invalidate.ts`;
- importing `serviceDb`, `authDb` or `getClient` outside
  `CLIENT_ALLOWLIST` (the identity plane, the rate limiter, the ICS feed, the
  cron routes and job runner, the health check, scripts and the data layer;
  adding a path is a security review item);
- `redirect`/`notFound` in `src/server` services (except `context.ts`), and
  request-context imports in cached loaders.

## 0C: legacy modules on the RLS path (done)

The Phase 0-6 modules started on `app_legacy`, a temporary role with
`FOR ALL USING (true)` policies on 23 tables — for that role, row-level
security was effectively off. Phase 0C moved each module onto `app_user`
through the wrappers, so RLS covers it. Notes, workspace search
(the command palette), finance (periods, categories, transactions, sponsors
and sponsorships, the dashboard, the CSV export, the finance digest and
receipts), the org overview, the org switcher, the notification bell and
bare `/app` are done. The pattern every module follows:

- **Actions.** `withOrgContext` becomes `withOrgAction`. Actions that used
  to call `requireFinanceAccess`/`requireOrgMembership` directly use the
  wrapper too, then check `can(ctx, perm)` or `requirePermission(ctx, perm)`
  (a `ForbiddenError`, as before). Nested `prisma.$transaction` blocks are
  flattened: the wrapper's transaction already covers the action.
- **Reads.** Query helpers take `db` as their first argument. Pages resolve
  the org with `getOrgContextBySlug(slug)` (`notFound()` for a non-member,
  so another org's pages answer 404) and read in one `withOrgTx`. Reads in
  a transaction share one connection, so they run one after another rather
  than in `Promise.all`; the finance dashboard fetches the period's
  transactions once and sums them in memory instead of running parallel
  aggregates. Every query keeps its explicit `organizationId` filter.
- **Audit and email.** `writeFinanceAuditLog(ctx.db, ...)`
  (`src/lib/finance/audit.ts`) calls `app.write_finance_audit`, which fixes
  the actor, org and timestamp; no runtime role can INSERT into
  `FinanceAuditLog`. Reimbursement status mail stays an outbox job enqueued
  in the same transaction.
- **Files.** The receipt upload route (`/api/orgs/[orgId]/receipts`) checks
  membership, reads the body with `readUpload`, reads the transaction in one
  `withOrgTx`, writes the blob with `putBlob("receipts", ...)` outside any
  transaction, then inserts the row in a second transaction and deletes the
  blob if that fails. The download route reads the row in `withOrgTx` (the
  Receipt policy decides who may see it) and the file afterwards; its signed
  token binds the receipt and the org. Deleting a receipt deletes the row in
  the action and the file after commit. Receipt keys written before the
  move (Vercel pathnames and `local:` files) still read.

**Error semantics.** A handler that returns `{ error }` commits whatever it
wrote first; a throw rolls everything back. Every migrated action returns
its errors before its first write, so neither case leaves a partial write.
A rule the database refuses after the app check passed (for example
`transaction_guard` after a concurrent change) now rolls back the whole
action, audit row and outbox job included. The `*.db.test.ts` files next to
each module pin these rules against the real policies: PRIVATE notes and
author-or-admin edits, finance-role writes, separation of duties against
the acting user, Receipt visibility and cross-org refusal.

**Teardown.** Nothing reaches `app_legacy` any more. Migration
`20260924120000_0c_drop_app_legacy` drops the 23 `FOR ALL` policies and every
grant, removes the role's branches from `app.enqueue_job`, the ICS token
functions, `app.immutable_columns` and `app.security_manifest`, and drops the
role itself. `src/lib/prisma.ts`, `legacyDb`, `withOrgContext`,
`src/lib/auth/guards.ts`, `src/lib/notifications.ts`, `DATABASE_URL_LEGACY`,
`LEGACY_DB_PASSWORD` and the ESLint `LEGACY_ALLOWLIST` are gone with it. RLS
case T24 asserts the role holds no policy, no table grant and no function
EXECUTE in the database.

Roles are cluster-global while a migration is per-database, and Postgres
checks only the current database before `DROP ROLE`: dropping it while
another database still grants it leaves dangling ACL entries there. So the
migration drops the role only when it is the cluster's single application
database (a Neon project, CI). On a shared cluster it raises a notice and
leaves the role with nothing granted; drop it by hand once every database
has run the migration.

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

`FinanceAuditLog` is append-only by design (spec 5.9). No runtime role has
`INSERT`, `UPDATE` or `DELETE` on it: finance actions write their entry
through `app.write_finance_audit` in the same transaction as the change
(`writeFinanceAuditLog`, `src/lib/finance/audit.ts`), and the function
fixes the actor, the org and the timestamp. The runtime never connects as a
superuser or the table owner, so the revokes hold locally too.

### Public, unauthenticated surfaces

Three routes are deliberately reachable without a session, because they're
meant to be shared outside the org: the guest poll response page
(`/poll/[pollId]`), the invite-accept page (`/invite/[token]`), and the
per-user `.ics` calendar feed (`/api/calendar/feed/[token]`). Each is gated
by an unguessable token instead of a membership check, and each is
rate-limited (`src/lib/rate-limit.ts`) since they're public and don't cost an
email to hit repeatedly. Since Phase 0A:

- the poll page renders from a stripped DTO (`src/lib/polls/poll-view.ts`:
  opaque respondent keys, no ids or emails); only members of the poll's org
  answer as themselves, everyone else answers as a guest keyed by an httpOnly
  `poll_guest_<pollId>` cookie whose sha256 scopes their edits; finalizing
  attaches only current members;
- an invite is accepted only by the account whose stored, verified email is
  the invited address (`src/lib/invitations.ts`);
- the feed stores only a hash of its token and includes only events of orgs
  the user still belongs to (`src/lib/calendar-feed.ts`).

Route handlers that accept a browser POST (for example the receipt upload,
`/api/orgs/[orgId]/receipts`) do their own session, membership and
same-origin checks: unlike Server Actions they get no built-in CSRF check.
Security headers and the Content Security Policy are described in
`src/lib/security/csp.ts`.

The limiter is Postgres-backed (a fixed window in
`RateLimitBucket`, reached only through `app.rate_limit_hit` on the service
or auth role), so every serverless instance shares one count and a
rolled-back action still counts. Keys hash their identifying parts
(`rateLimitKey(scope, ...parts)`), so the table holds no emails, IPs or
tokens. Sign-in (per IP and per email), sign-up (per IP and per email),
verification-link resends (per account), invites (per org), poll responses
(per IP), receipt uploads (per user), CSP reports (per IP) and the ICS feed
(per token hash) are limited; the client IP comes from `x-real-ip`, never the
client-controlled first `x-forwarded-for` hop.
