# AI connectors (MCP): implementation plan

Status: planned, nothing built yet. Decided 2026-10-21: Bananasplit serves a
remote MCP server, so members can use their Personal space and clubs from
Claude, ChatGPT, Cursor, VS Code and other MCP clients. WorkOS AuthKit
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
this doc:

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
    defaults are READ and every space.
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
  spaces.
- Disconnect refuses the next call, and the club switch refuses calls for
  its club.
- Another org's id answers not found.
- `pnpm test:rls` is green.

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
