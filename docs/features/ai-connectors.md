# AI connectors (MCP): implementation plan

Status: Phase 1 (foundations) built 2026-10-25, and Phase 2 (read tools)
and Phase 3 (write tools) 2026-10-26, behind `CONNECTORS_ENABLED` (see
each phase's "as built"). Phase 0's WorkOS checks have not run yet, so
nothing has been tried against WorkOS itself. Decided 2026-10-21: Bananasplit
serves a remote MCP server, so members can use their Personal space and clubs
from Claude, ChatGPT, Cursor, VS Code and other MCP clients. WorkOS AuthKit
Standalone Connect issues the OAuth tokens. Auth.js stays the only way to
sign in. The research behind this covered the MCP 2026-07-28 spec, the
TypeScript SDK v2 and the WorkOS Connect docs, all checked 2026-10-21.

## Summary

- **One endpoint.**
  - `https://<app>/api/mcp` speaks stateless Streamable HTTP from a Vercel
    function.
  - It serves both 2025-11-25 clients (with `initialize`) and 2026-07-28
    clients (with `server/discover`).
- **Tokens.**
  - AuthKit issues RS256 JWTs. We check `iss`, `aud` (the exact MCP URL)
    and `exp`, and read our user id from a JWT-template claim.
  - Every tool call runs as that member under RLS, with the same policies
    as the web app.
- **Who holds what.**
  - Our database holds the grant: which app, read or change, which space,
    and whether it is revoked.
  - WorkOS holds the OAuth machinery: client registration (CIMD and DCR),
    PKCE, the consent screen and refresh tokens.
- **What ships when.** Read tools ship first and write tools follow. No
  tool sends anything outside the club.

## How a connection works

1. **Add the connector.** The member adds `https://<app>/api/mcp` in their
   client. In Claude that is Customize › Connectors › Add custom connector.
2. **First call, no token.** The client calls `/api/mcp` without a token.
   It gets a `401` with this header:
   `WWW-Authenticate: Bearer resource_metadata="https://<app>/.well-known/oauth-protected-resource/api/mcp"`.
3. **The client finds AuthKit and starts OAuth.**
   - The metadata names the AuthKit domain as the only authorization
     server.
   - AuthKit's discovery advertises
     `client_id_metadata_document_supported: true`, the `none` client
     auth method and S256 PKCE. Claude needs both of the first two to use
     CIMD.
   - The client registers itself, by CIMD (Claude, ChatGPT, VS Code) or by
     DCR (Cursor, Gemini, Antigravity).
   - It opens `/oauth2/authorize` with PKCE and
     `resource=https://<app>/api/mcp`.
4. **AuthKit sends the member to our sign-in page.** This is our External
   Sign-in URI, `/connect?external_auth_id=…`, and it receives nothing
   else.
   - The page signs the member in through Auth.js if needed. The
     `requireUser()` callback URL brings them back with the parameter
     intact.
   - It shows "Continue as <email>". On Continue, a Server Action calls
     `POST https://api.workos.com/authkit/oauth2/complete`.
   - That call carries our user id, email, name and the consent choices.
     The action then redirects to the `redirect_uri` the call returns.
5. **AuthKit asks for consent and issues tokens.**
   - Its consent screen shows the client's name and logo, "Logged in as
     <email>", and the two choices from `user_consent_options`.
   - AuthKit then sends the client a code, which the client swaps for an
     access token, plus a refresh token with `offline_access`.
6. **Every later request.** Each MCP request carries the bearer token. The
   route verifies the token, resolves the grant and runs the tool.

### Token claims we rely on

| Claim | Comes from | Use |
|---|---|---|
| `iss` | `https://<authkit domain>` | must equal `WORKOS_AUTHKIT_DOMAIN` |
| `aud` | the Resource Indicator that matches the client's `resource` | must equal the MCP URL exactly (see below) |
| `exp`, `iat` | | checked by `jose`; trust `exp` (the docs show both 300 s and 3600 s) |
| `urn:bananasplit:uid` | JWT template `{{ user.external_id }}` | our `User.id` |
| `sub` | the WorkOS user id (`user_01…`), not ours | stored on the grant, for WorkOS revocation calls |
| `client_id` | the client's CIMD URL or DCR id | half of the grant's key |
| `sid` | the consent id (`app_consent_…`) | tells a new consent from an old one |
| `urn:bananasplit:space`, `urn:bananasplit:access` | `user_consent_options` | the member's choices at consent |

The audience check fails closed. With no Resource Indicator registered,
WorkOS ignores `resource` and sets `aud` to the environment's client id,
which our check rejects.

We don't use `scope`. Self-registered clients only get
`openid profile email offline_access`. Custom scopes need WorkOS support to
set an environment-wide default. So "read" versus "read and change" is the
grant's `access`, chosen at consent.

## Decisions (confirmed 2026-10-22, as proposed)

1. **Which plans get connectors.**
   - Every plan (`connectors: "FREE"` in `PLAN_FEATURES`), as Notion and
     Linear do.
   - Why: the member's own AI app pays for the model, and the ChatGPT
     directory rejects in-app upsells.
   - Paused clubs: reads keep working and writes are refused, as for
     everything else.
2. **The club switch's default.** The switch lives at Admin panel › Privacy
   › AI connectors, for owners and admins (`privacy.write`). On, for new
   and existing clubs.
3. **The consent choices.** AuthKit allows enums only, one choice each.
   - Space: "Personal and all my clubs", or one space.
   - Access: "Read only" (listed first, the default) or "Read and make
     changes".
4. **An AuthKit custom domain.** This would be `auth.<domain>`, $99/mo,
   production only. The issuer and the JWKS URL change with it, so it is
   set up before launch: yes, at launch.
5. **The URL.** `/api/mcp` on the app's own domain, rather than an `mcp.`
   subdomain.

## Phase 0: WorkOS staging spike (before any app code)

Use a WorkOS staging environment, Claude Code against localhost and the MCP
Inspector. Confirm what the docs leave open, and write the answers into
this doc. The harness and its 13 checks are on `claude/mcp-spike` (commit
`8474061`, runbook `docs/features/ai-connectors-spike.md`); run them there,
since Phase 1 replaced the spike's `whoami` tool, which shows the token's
claims. Not run yet (it waits on a WorkOS staging environment and a local
database).

- **The user-id claim.** `urn:bananasplit:uid` appears in access tokens
  issued to both CIMD and DCR clients.
- **Localhost as a resource.** A Resource Indicator for
  `http://localhost:3000/api/mcp` is accepted in staging and becomes `aud`.
  If not, use a tunnel.
- **Consent choices.**
  - The consent-option claims appear in the access token and survive a
    refresh.
  - A repeat authorization of the same client either skips consent or
    doesn't, and either keeps `sid` or doesn't.
  - If the claims don't survive a refresh, the grant row keeps the first
    choice. That is the design anyway.
- **Refresh tokens.** They rotate, and deleting the user's authorized
  application kills them.
- **Failure paths.**
  - What AuthKit's Cancel does.
  - How long an `external_auth_id` lives.
  - What `complete` returns for an expired one. The WorkOS emulator uses
    10 minutes, and 404 for unknown or expired ids.
  - Whether our page can abort the flow. Nothing documents this; the
    fallback is a page telling the member to close the window.
- **Questions for WorkOS.**
  - Custom scopes for self-registered clients.
  - RFC 9207 `iss` in authorization responses (not advertised today).
    ChatGPT uses its stable redirect URI only with it.
  - A client allowlist.

## Phase 1: foundations

### Configuration

- **Env vars.**
  - `CONNECTORS_ENABLED`, `WORKOS_API_KEY` and `WORKOS_AUTHKIT_DOMAIN`.
  - The feature is off unless all three are set, like `COLLAB_ENABLED`.
  - The MCP URL is `appUrl("/api/mcp")` (`src/lib/app-url.ts`). It must
    equal the Resource Indicator in WorkOS.
- **Setup and health.**
  - Update `.env.example`.
  - Add a RUNBOOK step for the WorkOS production environment. It needs
    billing on file and CIMD and DCR on. Set the External Sign-in URI to
    `https://<app>/connect` and the default Resource Indicator to
    `https://<app>/api/mcp`. Add the JWT template and branding.
  - In production with the flag on, `/api/health` checks that the WorkOS
    variables are set.
- **Environments.**
  - Production uses WorkOS production.
  - Each developer gets their own WorkOS staging environment, or uses
    `workos/emulate` for flows without consent.
    - Why: WorkOS refuses a second external id for an email it already
      knows.
    - Every local seed has `alice@example.edu` under a different id.
  - Previews stay off: WorkOS allows only one External Sign-in URI per
    environment.
- **Packages.**
  - Add `@modelcontextprotocol/server@^2.3`; its zod `^4.2` peer matches.
  - Add `jose` as a direct dependency (it is already installed through
    Auth.js).
  - Don't use `mcp-handler`. It doesn't hand the request's auth to the
    server factory, so the tool list can't follow the grant, and the part
    of it we need is about 40 lines.
  - Never import the v1 `@modelcontextprotocol/sdk` that shadcn puts in
    `node_modules`.

### Schema (one migration)

```prisma
enum ConnectorAccess {
  READ
  WRITE
}

/// An AI app a user connected (docs/features/ai-connectors.md): one per
/// user and OAuth client. Our record of the grant; WorkOS issues the tokens.
model ConnectorGrant {
  id             String          @id @default(cuid())
  userId         String
  /// The OAuth client the tokens were issued to (a CIMD URL or a DCR id).
  clientId       String
  /// Looked up from WorkOS after the first call; null until then.
  clientName     String?
  /// The token's sub, for revoking the grant at WorkOS.
  workosUserId   String
  /// The consent the current tokens belong to (the token's sid).
  consentId      String
  access         ConnectorAccess @default(READ)
  /// Null: Personal and every club the user is in. Else that one space.
  organizationId String?
  createdAt      DateTime        @default(now())
  lastUsedAt     DateTime        @default(now())
  /// Set by Disconnect, a password reset or the Google sign-in gate; every
  /// call with this consent is refused until the member connects again.
  revokedAt      DateTime?

  user         User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  organization Organization? @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([userId, clientId])
}
```

- **The club switch column.** `OrgSettings.connectorsEnabled Boolean
  @default(true)`. Its update is already admin-only.
- **RLS, in the same migration.**
  - Policies for `app_user`: `SELECT`, `INSERT`, `UPDATE` and `DELETE`
    where `"userId" = app.user_id()`.
  - No service policy unless a job ends up needing one.
  - Add the explicit GRANTs and the row in the grant matrix in
    `prisma/rls/phases.mjs`.
  - The policies test the user, as `Pin`'s do. Check that
    `app.security_manifest()` stays empty.

### Identity and the RLS wrappers

- **`src/server/connectors/token.ts`.** `verifyConnectorToken(token)` uses
  `jose` `jwtVerify`:
  - The key set is `createRemoteJWKSet(<domain>/oauth2/jwks)`, kept at
    module scope.
  - It requires `issuer`, `audience` = the MCP URL, `algorithms: ["RS256"]`
    and a 30-second clock tolerance.
  - The token must also carry `urn:bananasplit:uid`, `client_id` and `sid`.
  - It returns a `VerifiedConnector`: a branded type built only here, from
    a unique symbol the module doesn't export. A failure throws the SDK's
    `OAuthError(InvalidToken)`.
- **Two new wrappers in `src/server/db/context.ts`.**
  - `withConnectorUserTx(connector, fn)` is the member's own rows, as
    `withUserTx`.
  - `withConnectorOrgTx(connector, grant, organizationId, options, fn)`
    runs `runInTx` the way `withOrgTxAs` does, then:
    - loads the member's `User` name and email into `ctx.user`, so services
      that take an `OrgContext` work (`loadTaskEnv` reads `ctx.user.name`);
    - runs `checkSpace` with `feature: "connectors"` plus the tool's own
      feature and `whenPaused`;
    - refuses when `OrgSettings.connectorsEnabled` is off, or when the
      grant is scoped to a different space;
    - hands the handler an `OrgContext`.
- **ESLint.**
  - A `CONNECTORS = ["src/server/connectors/**"]` block may import the two
    wrappers. Everyone else is restricted, as with `AS_USER_TX`.
  - `src/server/**` keeps its navigation ban, so no `redirect` or
    `notFound` in tools.
  - Adding a path is a security review item.
- **Grant resolution on every request (`src/server/connectors/grant.ts`).**
  It runs in `withConnectorUserTx` and looks up `(userId, clientId)`:
  - **No row:** create one from the consent claims. Without them the
    defaults are READ and every space. A space claim naming a space the
    member is no longer in is refused with the same 401, never widened to
    every space.
  - **`consentId` differs from `sid`:** this is a new consent. Take its
    claims and clear `revokedAt`.
  - **`revokedAt` set and the same `sid`:** refuse with `401
    invalid_token`. The client signs in again and gets a new consent.
  - **Bookkeeping:** update `lastUsedAt` at most every 15 minutes. After
    the response (`after()`), look up `clientName` once from WorkOS's
    authorized applications.

### The endpoint

- **The route.** `src/app/api/mcp/route.ts` exports POST with
  `maxDuration = 60` and `dynamic = "force-dynamic"`. The SDK answers GET
  and DELETE with 405. Each POST runs these steps:
  1. **Origin check.** `originValidationResponse`: an `Origin` header that
     isn't the app's own origin gets a 403. Browsers send one; MCP clients
     don't.
  2. **Bearer check.** A missing or invalid token gets a real `401` with
     the `resource_metadata` challenge; Claude ignores the header on any
     other status.
  3. **Grant.** Resolve the grant (above).
  4. **Rate limit.** `checkRateLimit(rateLimitKey("connector.call",
     grant.id), 600, 3600)`. It fails open, like every limit.
  5. **Server.** `createMcpHandler(({ authInfo }) => buildServer(grant),
     { responseMode: "json", maxSubscriptions: 0 })`. Write tools are
     registered only for WRITE grants.
- **Server info and `instructions`.** The name is `bananasplit` and the
  title "Bananasplit". The `instructions` are short and factual:
  - what Personal and clubs are;
  - that ids come from `list_spaces` and `search`;
  - which fields hold text club members wrote.
- **Protected resource metadata.**
  - Served at `src/app/.well-known/oauth-protected-resource/api/mcp/route.ts`
    (path-suffixed) and at the root
    `src/app/.well-known/oauth-protected-resource/route.ts`.
  - Body: `{ resource, authorization_servers: [<authkit domain>],
    bearer_methods_supported: ["header"], resource_name: "Bananasplit" }`.
  - No `scopes_supported`, since WorkOS custom scopes are unavailable.
  - GET and OPTIONS with `Access-Control-Allow-Origin: *`. Neither path is
    in the proxy matcher, so they get the static CSP, which is fine for
    JSON.
- **Error mapping (`src/server/connectors/errors.ts`).** Every failure is
  an `isError: true` tool result, never a protocol error, and never echoes
  the input. This follows the 2025-11-25 rule for input errors.

  | Error | What the tool says |
  |---|---|
  | `NotFoundError` | "No space or item with that id, or you're not a member." |
  | `ForbiddenError` | "Your role in <club> can't do that." |
  | `SpaceRefusedError` | its own message (paused, or not on the plan) |
  | `ZodError` | the first issue, with its field and an example |
  | anything else | "Something went wrong", plus a Sentry report |

### The sign-in page (External Sign-in URI)

- **Files and headers.**
  - `src/app/connect/page.tsx` and `actions.ts`.
  - Add `/connect` to the proxy matcher and to `NONCE_ROUTE_PREFIXES` and
    `STATIC_CSP_SOURCE` in `src/lib/security/csp.ts`.
  - Add the AuthKit origin to `FORM_TARGETS`: a form posted without
    JavaScript follows the redirect there, and `form-action` covers it.
- **The page.**
  - No session: `requireUser()` sends the member to sign-in and back, with
    `external_auth_id` kept.
  - An unconfirmed email gets "Confirm your email first".
  - Otherwise it shows the signed-in email, "Use another account" (sign
    out, then back here) and Continue. The space and access choices are
    made on AuthKit's consent screen, not here.
- **The action.** Completion is POST-only, never on GET.
  1. Rate limit: `rateLimitKey("connector.connect", userId)`, 20 an hour.
  2. Build the consent options: Space (Personal, then a "Clubs" group of
     the clubs with connectors on) and Access.
  3. Call `complete` outside any transaction, with
     `AbortSignal.timeout(8000)`.
  4. Check that `redirect_uri` is on the AuthKit origin, then redirect to
     it.
  5. A 404 or 400 means the sign-in expired: "This sign-in expired. Go
     back to the app you were connecting and try again."
- **Words.** "Personal" and "club", never "workspace", "organization" or
  "org" (docs/features/personal-and-clubs.md).

### Connected apps (the member's own page)

- **Where and what.** On the profile page, beside the calendar feed card
  (`src/app/app/[orgSlug]/profile/`). It lists each grant's app name,
  access, space, and connected and last-used dates, with Disconnect and
  Disconnect all.
- **Disconnect.**
  1. In `withUserTx`, set `revokedAt`. The next request is refused,
     including with access tokens issued before it.
  2. After commit, `DELETE /user_management/users/{workosUserId}/authorized_applications/{clientId}`.
     This is best effort and logged; our row is what counts.
- **How to connect.**
  - The URL to copy.
  - A prefilled Claude link:
    `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Bananasplit&connectorUrl=<url>`.
  - Short steps for ChatGPT, Claude Code, Cursor and VS Code. Claude Code
    is `claude mcp add --transport http bananasplit <url>`.
- **Hooks elsewhere.**
  - A password reset and the Google sign-in gate's password strip revoke
    all the user's grants. Both already bump `sessionVersion`:
    `src/server/email/password-reset.ts` and
    `src/lib/auth/google-linking.ts`.
  - There is no self-service account deletion today. `purge-unverified`
    only removes accounts that never confirmed an email, and `/connect`
    refuses those. Whatever deletes an account later must also delete its
    WorkOS user (`DELETE /user_management/users/{id}`). Otherwise a new
    sign-up with the same email fails at `complete`.

### The club switch

- **Where.** Admin panel › Privacy › AI connectors.
- **Copy.** "Members can use this club from AI apps they connect, such as
  Claude or ChatGPT. An app only ever sees what that member can see here."
- **Effect.** Turning it off refuses every connector call for the club at
  once. Nothing is revoked, so turning it back on restores access.

### Phase 1 tool

`list_spaces` returns Personal and the member's clubs. Each entry has its
id, name, kind, the member's role, URL, whether connectors are on, and
whether the club is paused.

**Done when:**
- Claude Code, on localhost against WorkOS staging, connects and lists
  spaces. *Not yet: waits on Phase 0's WorkOS staging setup.*
- Disconnect refuses the next call, and the club switch refuses calls for
  its club. *Verified by tests only (route and DB tests).*
- Another org's id answers not found. *Verified by the DB tests.*
- `pnpm test:rls` is green. *Yes, 2026-10-25.*

### Phase 1: as built (2026-10-25)

Built as planned above, with these decisions on the way:

- **Two definer functions** (migration `20261025120000_connector_grants`).
  - `app.connector_spaces()`, for `app_user`: the caller's spaces with each
    club's switch. `OrgSettings` is readable only in the current org, and
    both `list_spaces` and `/connect`'s consent choices need every club's.
  - `app.revoke_connector_grants(user)`, for `app_auth` only: the password
    reset and the Google gate run on the identity plane, without a member
    context, and revoke in their own transaction. It returns what WorkOS
    should forget. The grant matrix row stays `["SIUD", "", ""]`.
  - Both are in the reviewed lists (`tests.mjs` T27c, T27f), and the three
    own-row `ConnectorGrant` write policies are on the manifest's
    tenant-only-write allowlist (as `Pin`'s are).
- **Tokens** must also carry `sub`, since `workosUserId` is required for the
  WorkOS revocation call.
- **The wrapper's refusals, in order:** a grant scoped to another space
  (checked before any query), then non-member or scheduled-for-deletion
  (`NotFoundError`), then the club switch, then `checkSpace` with
  `connectors` and the tool's own feature. The scope and switch refusals are
  a `ConnectorRefusedError` (an `AppError`, 403) whose message the tool
  passes on.
- **`list_spaces`** also returns the grant's `access` (`read` or
  `read_and_change`); a scoped grant lists only its space, and spaces
  scheduled for deletion are left out. The `instructions` name only
  `list_spaces`; Phase 2 adds `search` to them.
- **Consent choices** are grouped ("All spaces", "Personal", "Clubs") when
  the member has clubs with connectors on, and flat otherwise: the WorkOS
  docs show flat or grouped choices, never a mix. Phase 0 check 5 confirms
  how AuthKit renders them.
- **The rate limit** answers HTTP 429 with `Retry-After` and a JSON-RPC
  error body, before the MCP server runs.
- **Bookkeeping.** `clientName` is looked up after the response when the
  grant is created or renewed, or at a `lastUsedAt` write while it is still
  empty (so at most every 15 minutes). The WorkOS DELETE after Disconnect,
  a password reset or the Google gate also runs after the response
  (`after()`), best effort and logged.
- **Hidden while off.** With the flag off, `/connect` says so on load, the
  profile card and the club switch are hidden, Settings › Plan doesn't list
  "AI connectors", and the CSP leaves AuthKit out of `form-action`.
- **Where things are.**
  - `src/server/connectors/`: `config.ts`, `token.ts` (`VerifiedConnector`),
    `grant.ts`, `errors.ts`, `server.ts`, `tools/`, `consent.ts`,
    `connected-apps.ts`, `revoke.ts`, `workos.ts`.
  - `withConnectorUserTx` and `withConnectorOrgTx` in
    `src/server/db/context.ts`, importable only from
    `src/server/connectors/**` (ESLint `CONNECTORS`).
  - The profile card is `src/app/app/[orgSlug]/profile/connected-apps-card.tsx`.
    The club switch is in `settings/privacy/`, audited as
    `privacy.connectors_changed`.
- **Still open, for Phase 0.**
  - If a refresh can mint a new `sid` (check 8), a refresh would revive a
    revoked grant, since a new consent clears `revokedAt`. The WorkOS DELETE
    kills the refresh tokens, but it is best effort. If check 8 shows a new
    `sid` on refresh, reviving must also require a `/connect` completion
    after `revokedAt`.
  - Whether a repeat authorization keeps `sid` (check 9). If it does, a
    member who disconnected can't reconnect the same app unless the WorkOS
    DELETE went through.
- **Merged with main (2026-10-25).** The migration's
  `app.security_manifest()` is rebuilt from `20261024120000_meetings` (the
  latest before it), so main's `UpNextDismissal` entries stay. The profile
  card uses Bananasplit's own icons (`@/components/icons`). Any later
  migration that re-creates the manifest must start from this one.

## Phase 2: read tools

Every tool sets:
- a `title`;
- `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`
  and `openWorldHint: false`;
- a zod input schema with field descriptions, and an output schema;
- results as `structuredContent` plus the same JSON as text;
- names beside ids, absolute URLs, and a default limit of 20 (at most 50),
  with a cursor.

Its plan feature (people, teamwork, finance, …) goes through the wrapper's
`feature` option.

The calendar, notes and finance queries live under `src/app/app/[orgSlug]/`
(`calendar/queries.ts`, `notes/queries.ts`, `finance/queries.ts`). They
take `db` first, so tools can import them as they are. Moving them into
`src/server/` is optional tidying, not a blocker.

| Tool | Backed by | Work needed |
|---|---|---|
| `search` (query) | `searchWorkspace` (`src/server/search/workspace.ts`) | Move the viewer building out of `search/actions.ts` into `src/server/search/viewer.ts`. Search each allowed space in turn, each in its own transaction, then merge by score (top 20). Ids look like `<kind>:<orgId>:<id>`, and URLs are absolute from `hit.href`. The name and shape follow ChatGPT's `search`/`fetch` contract. |
| `fetch` (id) | `getNoteById` + `noteToMarkdown`, `getTaskDetail` + `getComments`, `getEventById`, database definition, poll, person | Dispatch on the id's kind. |
| `list_tasks` (space, assignee, status, due before, cursor) | `getTableTasks`, `taskFilterWhere`, `visibleTaskWhere` | none |
| `get_task` | `getTaskDetail`, `getComments`, `getActivity` (last 10) | none |
| `list_events` (space, from, to) | `getEventsInRange`, `getUpcomingEvents` | Add RSVP counts, and give times in the viewer's zone. |
| `get_event` | `getEventById`, `getViewerRsvps` | none |
| `list_notes` (space, folder, query) | `getNotesForList` | none |
| `get_note` | `getNoteById`, `noteToMarkdown` (`src/lib/notes/export/markdown.ts`) | Cap at 40k characters, with `truncated` and an `offset` argument. |
| `list_databases`, `query_database` (space, database, filter, cursor) | `listDatabases`, `loadView`, `loadRecords` | none; `canViewDatabase` and member visibility apply |
| `list_members` (club) | `listOrgPeople` | Add a variant that takes `db` (today it opens its own `withOrgTx`). Emails only with `members.viewEmails` or `showMemberEmailsToMembers`. |
| `get_weekly_summary` (club, week) | `getWeeklySummary` | none |
| `list_my_reimbursements` (club) | `getMyReimbursements` | none |
| `list_open_polls` (space) | `listOpenPolls`, `listQuestionPolls` | none |

The finance ledger is not in v1. RLS lets every member read it, and the
app gates it on `finance.manage`. A tool that adds it must repeat that
check.

**Done when:** each tool has a `*.db.test.ts` covering its denials:
- another org's id;
- another member's PRIVATE note, and a share that has been removed;
- a PRIVATE task;
- sections the club hid, hidden from non-admins;
- member emails;
- a paused club's reads, which still work;
- the club switch off;
- a READ grant, which can't see write tools.

### Phase 2: as built (2026-10-26)

Built as the table above says, with these decisions on the way:

- **Ids** (`src/server/connectors/tools/ids.ts`).
  - Every item id a tool returns is opaque: `<kind>:<spaceId>:<id>`. The
    kinds are note, task (epics and stories too), event, poll (either
    kind), person, database (its URL key) and expense.
  - `fetch` and the `get_` tools take that id alone. Space ids stay the
    org ids `list_spaces` returns.
  - A forged id finds nothing. The space still opens through
    `withConnectorOrgTx`, and every lookup filters on `organizationId`.
  - Folder ids, `list_notes`' filter, are plain ids from its own results:
    a folder isn't something `fetch` opens.
- **Cursors** (`tools/cursor.ts`).
  - A cursor is base64url JSON. It names an offset (or a club-made
    database's keyset position) and a fingerprint of the tool and its
    filters.
  - A cursor from another list is refused with "start over without a
    cursor".
  - `search` and the `get_` tools have no cursor. `search` returns its top
    results, 20 unless asked for more, at most 50.
- **One way into a space.** `inSpace` (`tools/space.ts`) does four things:
  - runs `withConnectorOrgTx` with `whenPaused: "allow"` and the tool's
    feature;
  - loads the space's name, slug, zones and sidebar;
  - refuses a section the club hid to members (`SectionHiddenError`);
  - leaves that section open to owners and admins (`settings.view`), as
    search does. Hiding Polls hides Find a time too, as in the sidebar.

  | Tools | Feature | Section |
  |---|---|---|
  | `list_tasks`, `get_task` | tasks | Tasks |
  | `list_events`, `get_event` | rsvp | Calendar |
  | `list_notes`, `get_note` | files | Files |
  | `list_databases`, `query_database` | databases | Databases |
  | `list_members` | people | People |
  | `get_weekly_summary` | teamwork | Tasks |
  | `list_my_reimbursements` | finance | Finance |
  | `list_open_polls` | polls | Polls, or Find a time, per poll |

  `fetch` uses its kind's row. Personal doesn't have people, teamwork or
  finance, so those tools refuse it with the plan's own message.
- **search** (`tools/search.ts`).
  - It is the palette's `searchWorkspace`. The viewer comes from
    `src/server/search/viewer.ts`, which the ⌘K action now uses too.
  - It runs over each space `list_spaces` lists with AI apps on, one
    transaction each, and merges by score.
  - It searches only what `fetch` opens: notes, tasks and epics, events,
    polls, people and databases. `searchWorkspace` gained `groups` and
    `limit` for this. A kind whose plan feature the space lacks isn't
    searched.
  - Left out: finance (the ledger), files and folders (`fetch` can't read
    an upload), and tags and org-chart roles.
  - A space that refuses (switched off between the two reads, say) is
    skipped, not a failed search. A query with no words returns nothing,
    rather than the palette's recent pages.
- **fetch** (`tools/fetch.ts`) returns `{ id, title, text, url, metadata }`,
  with the item as Markdown in `text`.
  - A note is its first 40,000 characters. `metadata` holds `truncated`
    and `nextOffset`, for `get_note`.
  - A database is its columns and row count, not its rows.
  - A poll reads as its page shows it to this member
    (`buildQuestionPollView`, `buildPollView`). Counts stay hidden until it
    closes when the poll says so, and an anonymous poll names no voters.
- **get_event** lists the event's linked notes as the notes rules allow,
  and none while the club hides Files from members.
- **get_note** reads `noteToMarkdown`, the Download Markdown export.
  - A part ends after a line break near 40,000 characters when there is
    one, and never inside an emoji.
  - The parts join back into the whole note.
- **Times.**
  - Instants are ISO 8601 with their offset, in the member's own zone, or
    else the club's.
  - All-day events and due dates are days (yyyy-mm-dd).
  - `list_events` reads a `from` or `to` without an offset in the member's
    zone.
- **query_database** (`tools/databases.ts`).
  - Built-in databases filter and sort through the view grammar
    (`dbViewQuery`, `queryFor`). A filter the query builder rejects is
    refused with its reason, never silently dropped. Each column says
    whether it filters or sorts, and its operators.
  - Club-made databases take `query` only (`loadRecords`). Values are what
    the grid shows: choice labels, member names, "$15.50".
  - Columns hidden from members are left out (`viewerColumns`). RLS masks
    contact emails below the privacy tier.
  - Individual ballots need the tier Privacy allows (`canViewBallotRows`).
    Without it, `query_database` refuses and `fetch` describes the
    database without a row count.
- **list_members.** Emails come back for owners and admins
  (`members.viewEmails`), for everyone when Admin panel › Privacy shows
  member emails to members, and always for the member's own row.
  `listOrgPeopleInTx` and `countOrgPeopleInTx` run `listOrgPeople`'s query
  in the caller's transaction.
- **get_weekly_summary** also takes a `member` ("me" unless given), since
  the updates view lets anyone read a teammate's week. RLS leaves out their
  private tasks, and a week that hasn't begun reads as this one, as in the
  app.
- **list_my_reimbursements** returns only the member's own expense
  requests, with no receipt files and no emails. `fetch` opens one of them
  by its expense id; anyone else's is not found.
- **Errors.**
  - The SDK checks the arguments against each input schema before a tool
    runs. A failure is an `isError` result naming the field, never
    repeating its value.
  - The tools' own refusals are `AppError`s below 500 with fixed messages:
    `CursorError`, `ConnectorInputError`, `SectionHiddenError` and
    `BallotRowsHiddenError`.
- **Small refactors.**
  - `noteListWhere` in `notes/queries.ts`.
  - `loadFields`, now exported from `databases/custom.ts`.
  - `loadSearchViewer` and `hiddenSections` in `src/server/search/viewer.ts`.

**Done when**, as checked on 2026-10-26:
- Every tool has a `*.db.test.ts` covering its denials. They are in
  `src/server/connectors/tools/`, over `src/test/connector-fixture.ts`:
  - another org's id, and a forged one;
  - another member's PRIVATE note, and a removed share;
  - a PRIVATE task;
  - hidden sections, refused to members and open to owners;
  - member emails;
  - a paused club's reads;
  - the club switch;
  - a grant scoped to another space.

  They ran for real against a fresh, migrated database. Each file also
  runs its tools through the MCP server, so the SDK checks every output
  schema against real rows.
- A READ grant can't see write tools. None exist yet; the route test
  asserts that READ and WRITE grants list the same 15 read tools.
- Unit tests cover the cursor codec, the id codec and text parts.
- Protocol tests cover `tools/list`, and calls to `get_note`, `search` and
  `fetch`, in both eras.
- *Not yet:* any client against WorkOS staging. It waits on Phase 0.

**For Phase 3.** `inSpace` always allows reads in a paused club. Write
tools need the wrapper's default, `whenPaused: "refuse"`, so they need a
write variant of it.

## Phase 3: write tools

| Tool | Backed by | Work needed |
|---|---|---|
| `create_task`, `update_task` (title, description, owner, due, priority, status) | `createTask`, `updateTask`, `setTaskStatus` with `loadTaskEnv(ctx)` | none; assigning notifies the owner, as in the app |
| `add_task_comment` | `addComment` | none |
| `rsvp_to_event` (going, maybe, not going) | the `updateMany` inside `rsvpTx` in the calendar actions | Move it to `src/server/events/rsvp.ts` as `setOwnRsvp(ctx, eventId, status)`. |
| `add_database_record`, `update_database_record` | `createRecord`, `updateCell` (`src/server/databases/custom.ts`) | none; custom databases only, built-ins stay read-only here |
| `post_weekly_update` | `postWeeklyUpdate` (`src/server/tasks/weekly.ts`) | none |
| `vote_in_poll` | `setMyVotes` (question polls) | none |
| `create_note` (space, title, Markdown, folder) | `createNote` in `notes/actions.ts` | Move it to `src/server/notes/create.ts`. Add a Markdown-to-note-JSON converter (`src/lib/notes/import/markdown.ts`), round-trip tested against `noteToMarkdown`. |

Rules for every write tool:
- **Annotations.**
  - `readOnlyHint: false` and `openWorldHint: false` on all.
  - `destructiveHint: false` for purely additive tools (`create_task`,
    `add_task_comment`, `add_database_record`, `post_weekly_update`,
    `create_note`).
  - `destructiveHint: true` for anything that overwrites (`update_task`,
    `update_database_record`, `rsvp_to_event`, `vote_in_poll`).
  - No deletes in v1.
- **Audit.** Each write records `writeOrgAuditLog(ctx.db, { action:
  "connector.<tool>", targetType, targetId, diff: { client, clientId } })`
  in the same transaction.
- **Limits.** `connector.write` allows 120 an hour per grant, and a paused
  club refuses writes through the wrapper.

Editing existing notes waits, because live collaboration owns their Yjs
state.

### Phase 3: as built (2026-10-26)

Built as the table above says, with these decisions on the way:

- **One way in for writes.** `writeInSpace` (`tools/write.ts`) checks, in
  order:
  1. A READ grant is refused (`ReadOnlyGrantError`).
  2. `connector.write` allows 120 writes an hour per grant, across every
     space. It is counted before the space opens, so a refused write
     counts too, as with every limit, and it fails open like them
     (`WriteLimitError`).
  3. `withConnectorOrgTx` runs with `whenPaused: "refuse"`, which covers
     the grant's scope, membership, the club switch and the tool's plan
     feature.
  4. A section the club hid is refused to members, as for reads
     (`SectionHiddenError`). Owners and admins still write there.
  5. The write runs, and then the `connector.<tool>` audit row, in the same
     transaction. The diff is `{ client, clientId }`, where `client` is the
     grant's app name and stays null until the WorkOS lookup has filled it
     in.

  The services' own refusals come back in their own words and roll the
  write back (`WriteRefusedError`). They arrive as `{ error }`,
  `TaskError` or `DatabaseInputError`: a closed poll, a task rule, a value
  its column won't take.
- **Write tools stay off a READ grant's `tools/list`.** The choice:
  - A model can't try what it can't see, and both directories review the
    tool list.
  - The cost is that a model on a READ grant can't tell the member why it
    can't make a change. So a READ grant's `instructions` add one factual
    sentence: the connection reads only, and making changes needs the app
    connected again with Read and make changes. `list_spaces` already
    returns `access`.
  - The wrapper still refuses a READ grant, as a second check.
- **Annotations.** All four hints are explicit on every tool.
  - Adds (`destructiveHint: false`, `idempotentHint: false`):
    `create_task`, `add_task_comment`, `add_database_record` and
    `create_note`.
  - Overwrites (`destructiveHint: true`, `idempotentHint: true`):
    `update_task`, `update_database_record`, `rsvp_to_event` and
    `vote_in_poll`.
  - `post_weekly_update` is `destructiveHint: false` as planned, with
    `idempotentHint: true`. Posting a week again replaces that week's post,
    as the app's Post button does. It is only ever the member's own post,
    but a reviewer may count that as overwriting.
- **Inputs.**
  - Item ids are Phase 2's opaque ids (task, event, database, poll and
    person), decoded with `refOf`. Space ids are the ones `list_spaces`
    returns.
  - An owner, or a member column's value, is "me" or a person id from the
    same space (`memberOf`).
  - Two ids stay plain, as Phase 2's folder ids do: a club-made database's
    row ids (`query_database` returns them plain) and note folder ids
    (`list_notes`).
- **create_task and update_task.**
  - They run `createTask` and `updateTask` with `loadTaskEnv(ctx)`.
    `setTaskStatus` is `updateTask({ status, blockedReason })`, so a status
    change goes through `updateTask` with the other fields, as one change.
  - The fields are the title, the description (Markdown), owner, due day,
    priority, status and `blockedReason`.
  - There is no `expectedVersion`, so the last write wins, as with the
    board's quick toggles.
  - Assigning someone above the member in the published org chart is
    refused. The message names them and asks for `confirmAboveLevel: true`
    once the member confirms. With it, the task is saved flagged and they
    get `TASK_FLAGGED`, as in the app.
  - `update_task` looks the task up first, so a private task the member
    isn't on is not found rather than a service error.
  - Not exposed: collaborators, tags, subtasks and parents, visibility,
    type, start dates and deleting.
- **add_task_comment** runs `addComment`: the owner and collaborators are
  notified. The tools hand out no raw user ids, so a comment can't
  @-mention anyone.
- **rsvp_to_event** runs `setOwnRsvp`.
  - An event that is deleted, or in another club, is not found.
  - An event the member isn't invited to is refused, and nobody's answer
    changes.
  - The answers are going, maybe and not going. There is no way back to
    "no answer", as in the app.
- **add_database_record and update_database_record** take club-made
  databases only. A built-in one is refused with a pointer to its page.
  - Cells are keyed by `query_database`'s column keys: field names, with
    the second of a name as "Name (2)".
  - Values go through the grid's `parseCell`, so choices are their labels,
    and null clears a cell.
  - `update_database_record` saves one `updateCell` per cell, all in one
    transaction, so one refused cell rolls back every cell.
  - Rows read back as the grid shows them.
- **post_weekly_update** runs `postWeeklyUpdate`.
  - Any day in a week names the club's week (`updateWeekStartOfKey`).
  - A week that hasn't begun is refused.
  - Personal is refused, since it has no teamwork.
  - Private tasks stay out, as `summaryLines` leaves them.
- **vote_in_poll** is for question polls only.
  - Choices are labels, matched as the app compares options (`optionKey`).
    An empty list takes the vote back.
  - A find-a-time poll gets a pointer to its page.
  - The result is the poll as its page shows this member
    (`buildQuestionPollView`): counts stay hidden until it closes when the
    poll says so.
- **create_note.** Markdown goes through `markdownToNote`, then
  `checkNoteContent`, then `createNote`.
  - The note is always PRIVATE: it has no parent to inherit from, and who
    sees a note isn't something a connected app changes.
  - A folder is optional.
  - A leading `# Title` is the title when none is given, and is dropped when
    it repeats the title.
  - With live collaboration on, the body is stored as Yjs state too, as
    `importNote` stores it.
  - The Markdown is capped at 100,000 characters.
- **The Markdown converter** (`src/lib/notes/import/markdown.ts`).
  - It uses `mdast-util-from-markdown` with the GFM extensions. They are
    new direct dependencies, at the versions already in the lockfile
    through `react-markdown` and `remark-gfm`.
  - It reads paragraphs, headings, quotes, rules, code blocks, tables
    (with the first row as the header), bullets, numbers and checklists,
    bold, italic, strikethrough, `<u>`, inline code, links and line breaks.
  - A blank line doesn't end a Markdown list, so a list's checklist items
    become a checklist of their own. That is how the export's bullets
    followed by a checklist round-trip.
  - Links keep only http(s), mailto, tel and app paths (`//host` is
    refused). An image becomes a link to it, never a picture fetched from
    elsewhere. Raw HTML stays as text.
  - The round-trip test checks both directions:
    `noteToMarkdown` then `markdownToNote` gives back the same document,
    and writing that again gives the same Markdown.
  - What doesn't round-trip: callouts, toggles, columns, mentions, dates,
    page links, task chips and file cards. The export's stand-ins for them
    come back as plain blocks. A mark that covers spaces at its edges also
    changes, since the export moves those spaces outside the marker.
- **Refactors.**
  - `setOwnRsvp` lives in `src/server/events/rsvp.ts`, and the calendar
    action calls it.
  - `createNote`, `parentFor` and `assertEventBelongsToOrg` live in
    `src/server/notes/create.ts`, and New note is a thin shell over them.
    `createNote` also takes a folder and a checked body.
  - Phase 2's files export `findTaskSummary`, `findEventSummary`,
    `memberNames` and their section constants.
- **The audit log** (Admin panel › Audit log) names each connector write in
  words and filters them under AI apps, with the app's name once it's
  known. The club switch's `privacy.connectors_changed` gets a sentence
  too.

**Done when**, as checked on 2026-10-26:
- The nine tools are registered for WRITE grants only, and both refactors
  are in.
- Every write tool has DB tests, in `src/server/connectors/tools/`:
  - `write.db.test.ts` runs all nine through each refusal: a READ grant, a
    paused club, a club the member isn't in, a grant scoped elsewhere, the
    club switch and a hidden section. It then checks that nothing was left
    behind and that no audit row was written.
  - It also covers an owner writing in a hidden section, the audit row's
    shape, and the real limiter refusing write 121 while another grant
    still writes.
  - Each `*-writes.db.test.ts` covers what its tools write, notify and
    refuse, and runs them through the MCP server for their output schemas.
  - They ran for real against a fresh, migrated database
    (`bananasplit_connectors_p3`): 47 tests in seven files, with real
    query timings.
- The Markdown round trip is unit-tested
  (`src/lib/notes/import/markdown.test.ts`).
- The route test lists the 15 read tools for a READ grant and the nine
  write tools after them for a WRITE grant, with their hints. It also shows
  that a READ grant can't call a write tool, that a READ grant's
  instructions say it reads only, and that the write limit comes back as an
  `isError` result.
- Typecheck, ESLint on the changed files, `pnpm test` (344 files, 3431
  tests) and `pnpm test:rls` (134 + 17 + 141, with the usual environmental
  skip T27b2) pass. Six DB files outside the connectors (integrations,
  conference, the calendar actions, platform) fail without
  `SECRETS_KEK_V1`, `SECRETS_KEK_CURRENT` and `SECRETS_FINGERPRINT_KEY`.
  They pass with throwaway values passed on the command line.
- *Not yet:* any client against WorkOS staging, so no real client has
  called a write tool. That waits on Phase 0.

**Left for later.**
- Notifications name the member ("Alice assigned you …"), not the app that
  made the change. A "from Claude" could follow once `clientName` is
  reliable.
- More write tools: subtasks, tags, collaborators, adding poll options,
  find-a-time answers, editing notes and built-in databases.

## Not exposed, and why

- **Anything that sends outside the app.** That means email and
  announcements, event attendee notices, public RSVP and poll links, note
  sharing and visibility, and exports.
  - A connected AI reads private data and text other members wrote, in the
    same context.
  - Any outward channel added to that is what turns a prompt injection
    into a leak.
- **Admin and money surfaces.** Member and role management, invitations,
  settings, integrations and keys, the plan, deletion and restore, finance
  writes and receipts, the finance ledger, and the audit log.

## Security checklist

- **Tokens.**
  - RS256 only, with `iss`, the exact `aud` and `exp` checked.
  - Never in URLs or logs (`src/lib/observability/scrub.ts` already drops
    `Authorization`).
  - Never forwarded anywhere.
- **Live checks on every call.**
  - the grant isn't revoked;
  - membership and role (`app.set_context`);
  - the plan and paused state (`checkSpace`);
  - the club switch;
  - the tool's own permission (`can()`).
- **Text.**
  - Text members wrote comes back as data fields in `structuredContent`.
  - Descriptions and `instructions` carry no behavioral directives; both
    directories reject them.
- **Minimal responses.** Results carry only what the tool needs, and
  emails only when the member could see them in the app.
- **`/connect`.**
  - `X-Frame-Options: DENY` (already global) and the nonce CSP.
  - Completion is POST-only.
  - It redirects only to the AuthKit origin.
- **Self-registered clients.** Look through them now and then
  (`GET /connect/applications?registration_types=dynamic`) and delete
  abusive ones.

## Tests

- **Unit.**
  - Token checks against a local JWKS: wrong `iss`, wrong `aud` (the
    environment's client id), expired, missing `uid`, an HS256 header.
  - The grant states, the error mapping, the cursor codec and the consent
    options.
- **DB** (`src/server/connectors/*.db.test.ts`).
  - The wrappers, and every tool's denials (above).
  - These skip silently without Postgres and the role passwords, so check
    that a run actually executed them.
- **RLS.** `pnpm test:rls` with the new table in the grant matrix, plus a
  case where one user can't read or revoke another's grant.
- **Protocol.** `@modelcontextprotocol/client` against the route handler in
  Vitest:
  - a 2025-11-25 `initialize`, then `tools/list` and `tools/call`;
  - a 2026-07-28 `server/discover`, then a call;
  - the 401 challenge's shape, and the Origin 403.
- **E2E.** `/connect` signed out, then sign-in, back, and `complete` (with
  WorkOS stubbed).
- **By hand, each release.** Claude Code, claude.ai, ChatGPT developer
  mode, Cursor, VS Code and the MCP Inspector.

## Phase 4: launch

- **WorkOS production.**
  - billing, the custom domain (decision 4) and branding (logo, colors,
    consent page CSS);
  - CIMD and DCR on;
  - the External Sign-in URI, the default Resource Indicator and the JWT
    template.
- **Privacy policy and terms.**
  - An AI app a member connects receives what the member asks it to read.
  - WorkOS is a subprocessor, holding name, email and our user id.
- **Docs.**
  - This file becomes the feature doc.
  - ARCHITECTURE gets the connector wrappers, the ESLint block and the
    token path.
  - `platform-services.md` gets the rate limits.
  - `personal-and-clubs.md` and the pricing table get `FEATURE_LABELS`,
    `FEATURE_PITCH` and the comparison rows.
- **Claude Connectors Directory** (claude.ai/directory/manage).
  - a test account with a populated club;
  - a privacy policy, a support contact, a docs URL and screenshots;
  - a title and a read-only or destructive hint on every tool.
- **ChatGPT Plugin Directory.**
  - organization and domain verification
    (`/.well-known/openai-apps-challenge`);
  - a reviewer password account without MFA;
  - five test prompts that should work, three that should be refused, and
    a video;
  - all three hints explicit on every tool.
- **MCP Registry** (optional). A `server.json` with a `streamable-http`
  remote.

## Later

- **MCP Apps cards.** An event with RSVP buttons, and the task board, for
  Claude, ChatGPT and VS Code. Text results stay for every other client.
- **Personal access tokens** for developer tools and scripts.
  - Prefixed `bsp_…`, hashed like the ICS token.
  - Scoped to a space and an access level, with an expiry.
  - Checked by the same route.
- **A read-only URL.** `/api/mcp/readonly`, with its own Resource
  Indicator.
- **More write tools.** Editing notes, creating events (admins, without
  attendee notices), and availability polls.
- **Not planned: the other direction.** That would be Bananasplit's own AI
  calling Notion or Google MCP servers.
  - Anthropic's MCP connector in the Messages API is still beta.
  - Slack admits only Marketplace apps, and Google's MCP servers are a
    developer preview.
  - It would also end the no-tools rule in `src/server/ai/generate.ts`.
