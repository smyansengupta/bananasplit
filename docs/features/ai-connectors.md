# AI connectors (MCP)

Members use their Personal space and organizations from Claude, ChatGPT,
Cursor, VS Code and other MCP clients. Bananasplit serves a remote MCP
server at `/api/mcp`; WorkOS AuthKit Standalone Connect issues the OAuth
tokens; Auth.js stays the only way to sign in.

**Status (2026-11-01).** Built and on `main`, off unless configured
(`CONNECTORS_ENABLED`, below): foundations and `list_spaces` (PR #66,
2026-10-25), 14 read tools (PR #68, 2026-10-26) and nine write tools (PR
#71, 2026-10-26, merged to `main` through #74 and #77). Phase 4 added the
launch material: the tool audit test, ChatGPT's domain check, the MCP
Registry entry and the reviewer account. **No real client has connected
yet:** the WorkOS staging checks (Phase 0, `ai-connectors-spike.md`) have
not run, and tests use a local RS256 key set. The steps only the owner can
take, in order, are in [`ai-connectors-launch.md`](ai-connectors-launch.md).

The design rests on the MCP 2026-07-28 spec, the TypeScript SDK v2
(`@modelcontextprotocol/server` 2.3) and the WorkOS Connect docs, all
checked 2026-10-21.

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
- **Tools.** 20 read tools for every grant; 17 write tools only for a
  grant the member allowed to make changes. 13 of them (5 read, 8 write) are
  the CRM's, in a space that added it ([`crm.md`](crm.md), "Your own Claude
  (MCP)"). No tool sends anything outside the app.

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

A token must carry `urn:bananasplit:uid`, `client_id`, `sid` and `sub`.

The audience check fails closed. With no Resource Indicator registered,
WorkOS ignores `resource` and sets `aud` to the environment's client id,
which our check rejects.

We don't use `scope`. Self-registered clients only get
`openid profile email offline_access`. Custom scopes need WorkOS support to
set an environment-wide default. So "read" versus "read and change" is the
grant's `access`, chosen at consent.

## Decisions (confirmed 2026-10-22)

1. **Every plan gets connectors** (`connectors: "FREE"` in
   `PLAN_FEATURES`), as Notion and Linear do.
   - Why: the member's own AI app pays for the model, and the ChatGPT
     directory rejects in-app upsells.
   - Each tool still needs its own plan feature: finance needs Team, and
     Personal has no people, weekly updates or finance. Since the homepage
     redesign (#72) nothing pauses: a trial that ends drops to Team Free,
     and its locked features are refused to reads and writes alike.
2. **The club switch is on by default**, for new and existing
   organizations. It lives at Admin panel › Privacy › AI connectors, for
   owners and admins (`privacy.write`).
3. **The consent choices.** AuthKit allows enums only, one choice each.
   - Space: "Personal and all my organizations", or one space.
   - Access: "Read only" (listed first, the default) or "Read and make
     changes".
4. **An AuthKit custom domain** (`auth.<domain>`, $99 a month, production
   only), set up before launch: the issuer and the JWKS URL change with it.
5. **The URL** is `/api/mcp` on the app's own domain, not an `mcp.`
   subdomain.
6. **Write tools are hidden from a READ grant** (Phase 3). A model can't
   try what it can't see, and both directories review the tool list. A
   READ grant's `instructions` add one factual sentence instead: the
   connection reads only, and making changes needs the app connected again
   with Read and make changes. The write wrapper still refuses a READ
   grant, as a second check.

## Configuration

- **Env vars.** `CONNECTORS_ENABLED="true"`, `WORKOS_API_KEY` and
  `WORKOS_AUTHKIT_DOMAIN` (an https origin; http only on localhost, for
  the WorkOS emulator). The feature is off unless all three are set, like
  `COLLAB_ENABLED` (`src/server/connectors/config.ts`). The MCP URL is
  `appUrl("/api/mcp")`, and it must equal the Resource Indicator in
  WorkOS. `OPENAI_APPS_CHALLENGE` is separate: ChatGPT's domain check
  (below).
- **Off** means: `/api/mcp` and the metadata answer 404, `/connect` says
  so on load, the profile card, the club switch and the pricing row are
  hidden, Settings › Plan doesn't list "AI connectors", and the CSP leaves
  AuthKit out of `form-action`.
- **Health.** In production with the flag on, `/api/health` checks that the
  WorkOS variables are set and usable (`production:connectors`).
- **Environments.**
  - Production uses WorkOS production (RUNBOOK, "AI connectors").
  - Each developer gets their own WorkOS staging environment, or uses
    `workos/emulate` for flows without consent. WorkOS refuses a second
    external id for an email it already knows, and every local seed has
    `alice@example.edu` under a different id.
  - Previews stay off: WorkOS allows only one External Sign-in URI per
    environment.
- **Packages.** `@modelcontextprotocol/server` 2.3 (its zod `^4.2` peer
  matches) and `jose`. Not `mcp-handler`: it doesn't hand the request's
  auth to the server factory, so the tool list couldn't follow the grant.
  Never import the v1 `@modelcontextprotocol/sdk` that shadcn puts in
  `node_modules`.

## Schema and RLS

Migration `20261025120000_connector_grants`:

```prisma
enum ConnectorAccess {
  READ
  WRITE
}

/// An AI app a user connected: one per user and OAuth client. Our record
/// of the grant; WorkOS issues the tokens.
model ConnectorGrant {
  id             String          @id @default(cuid())
  userId         String
  clientId       String          // a CIMD URL or a DCR id
  clientName     String?         // looked up from WorkOS after the first call
  workosUserId   String          // the token's sub, for revoking at WorkOS
  consentId      String          // the token's sid
  access         ConnectorAccess @default(READ)
  organizationId String?         // null: Personal and every organization
  createdAt      DateTime        @default(now())
  lastUsedAt     DateTime        @default(now())
  revokedAt      DateTime?       // Disconnect, a password reset or the Google gate

  @@unique([userId, clientId])
}
```

- **The club switch** is `OrgSettings.connectorsEnabled Boolean
  @default(true)`; its update was already admin-only.
- **Policies.** `SELECT`, `INSERT`, `UPDATE` and `DELETE` for `app_user`
  where `"userId" = app.user_id()`, as `Pin`'s are; no service policy. The
  explicit GRANTs and the grant matrix row (`["SIUD", "", ""]`) are in
  `prisma/rls/phases.mjs`, and the three own-row write policies are on the
  manifest's tenant-only-write allowlist.
- **Two definer functions**, both in the reviewed lists (`tests.mjs` T27c,
  T27f):
  - `app.connector_spaces()`, for `app_user`: the caller's spaces with each
    organization's switch. `OrgSettings` is readable only in the current
    org, and both `list_spaces` and `/connect`'s consent choices need every
    organization's.
  - `app.revoke_connector_grants(user)`, for `app_auth` only: the password
    reset and the Google gate run on the identity plane, without a member
    context, and revoke in their own transaction. It returns what WorkOS
    should forget.
- **The manifest.** The migration rebuilt `app.security_manifest()` from
  `20261024120000_meetings`. Any later migration that re-creates it must
  start from the latest one.

## Identity and the wrappers

- **`src/server/connectors/token.ts`.** `verifyConnectorToken` runs `jose`
  `jwtVerify` against `createRemoteJWKSet(<domain>/oauth2/jwks)` (kept at
  module scope), requiring the issuer, the MCP URL as audience,
  `algorithms: ["RS256"]` and a 30-second clock tolerance. It returns a
  `VerifiedConnector`, a branded type built only there from a unique
  symbol the module doesn't export. A failure throws the SDK's
  `OAuthError(InvalidToken)`.
- **Two wrappers in `src/server/db/context.ts`.**
  - `withConnectorUserTx(connector, fn)`: the member's own rows, as
    `withUserTx`.
  - `withConnectorOrgTx(connector, grant, organizationId, options, fn)`:
    `withOrgAction` for a token instead of a session. It refuses, in order:
    a grant scoped to another space (checked before any query); a
    non-member or a space scheduled for deletion (`NotFoundError`); the
    club switch; then `checkSpace` with `connectors` and the tool's own
    feature. The scope and switch refusals are a `ConnectorRefusedError`
    (an `AppError`, 403) whose message the tool passes on. The handler gets
    an `OrgContext` whose `user` is the member's own row, so services that
    read `ctx.user` (`loadTaskEnv`) work unchanged.
- **ESLint.** The `CONNECTORS = ["src/server/connectors/**"]` block may
  import the two wrappers; everyone else is restricted, as with
  `AS_USER_TX`. `src/server/**` keeps its navigation ban, so no `redirect`
  or `notFound` in tools. Adding a path is a security review item.
- **Grant resolution on every request (`src/server/connectors/grant.ts`).**
  In `withConnectorUserTx`, by `(userId, clientId)`:
  - **No row:** create one from the consent claims. Without them the
    defaults are READ and every space. A space claim naming a space the
    member is no longer in is refused with the same 401, never widened to
    every space.
  - **`consentId` differs from `sid`:** a new consent. Take its claims and
    clear `revokedAt`.
  - **`revokedAt` set and the same `sid`:** `401 invalid_token`. The client
    signs in again and gets a new consent.
  - **Bookkeeping:** `lastUsedAt` at most every 15 minutes. `clientName` is
    looked up from WorkOS's authorized applications after the response
    (`after()`) when the grant is created or renewed, or at a `lastUsedAt`
    write while it is still empty.

## The endpoint

`src/app/api/mcp/route.ts` exports POST (`maxDuration = 60`,
`dynamic = "force-dynamic"`); the SDK answers GET and DELETE with 405. Each
POST runs:

1. **Origin.** `originValidationResponse`: an `Origin` that isn't the app's
   own gets 403. Browsers send one; MCP clients don't.
2. **Bearer.** A missing or invalid token gets a real `401` with the
   `resource_metadata` challenge; Claude ignores the header on any other
   status.
3. **Grant.** Resolved as above.
4. **Rate limit.** `connector.call`, 600 an hour per grant. It answers 429
   with `Retry-After` and a JSON-RPC error body, before the MCP server
   runs, and fails open like every limit.
5. **Server.** `createMcpHandler(() => buildConnectorServer(session),
   { responseMode: "json", maxSubscriptions: 0 })`, built fresh per request
   so the tool list follows the grant.

- **Server info and `instructions`** (`src/server/connectors/server.ts`).
  Name `bananasplit`, title "Bananasplit". The instructions are four
  factual sentences: what Personal and organizations are, that space ids
  come from `list_spaces` and item ids from `search` and the list tools,
  and which fields hold text members wrote. A READ grant's add the
  read-only sentence (decision 6).
- **Protected resource metadata** at the path-suffixed
  `/.well-known/oauth-protected-resource/api/mcp` (named by the 401) and
  the root `/.well-known/oauth-protected-resource`: `{ resource,
  authorization_servers: [<authkit domain>], bearer_methods_supported:
  ["header"], resource_name: "Bananasplit" }`, no `scopes_supported`. GET
  and OPTIONS with `Access-Control-Allow-Origin: *`.
- **Outside the nonce CSP.** `/api/mcp`, both metadata URLs and
  `/.well-known/openai-apps-challenge` are not in the proxy matcher, so
  they carry the static CSP, which is fine for JSON and text.
  `src/proxy.test.ts` and `src/lib/security/csp.test.ts` pin that.
- **Errors (`src/server/connectors/errors.ts`).** Every failure is an
  `isError: true` tool result, never a protocol error, and never echoes the
  input (the 2025-11-25 rule for input errors).

  | Error | What the tool says |
  |---|---|
  | `NotFoundError` | "No space or item with that id, or you're not a member." |
  | `ForbiddenError` | "Your role in <organization> can't do that." ("this organization" without a name) |
  | `SpaceRefusedError`, `ConnectorRefusedError` | their own message (the plan, the switch, the grant's scope) |
  | The tools' own `AppError`s below 500 | fixed messages: `CursorError`, `ConnectorInputError`, `SectionHiddenError`, `BallotRowsHiddenError`, `ReadOnlyGrantError`, `WriteLimitError`, `WriteRefusedError` |
  | `ZodError` | the first issue, with its field and an example |
  | anything else | "Something went wrong on Bananasplit's side. Try again in a minute.", plus a Sentry report |

  The SDK checks arguments against each input schema before a tool runs;
  a failure names the field, never its value.

## The sign-in page (`/connect`)

- **Files and headers.** `src/app/connect/page.tsx` and `actions.ts`.
  `/connect` is in the proxy matcher, `NONCE_ROUTE_PREFIXES` and
  `STATIC_CSP_SOURCE`; the AuthKit origin is in `FORM_TARGETS`, since a
  form posted without JavaScript follows the redirect there.
- **The page.** No session: `requireUser()` sends the member to sign-in and
  back, with `external_auth_id` kept. An unconfirmed email gets "Confirm
  your email first". Otherwise it shows the signed-in email, "Use another
  account" (sign out, then back here) and Continue. Space and access are
  chosen on AuthKit's consent screen, not here.
- **The action** (POST only, never on GET):
  1. `connector.connect`, 20 an hour per user.
  2. The consent options (`src/server/connectors/consent.ts`): Space and
     Access. With organizations that allow AI apps, Space is grouped ("All
     spaces", "Personal", "Organizations"); otherwise flat. The WorkOS docs
     show flat or grouped choices, never a mix (Phase 0 check 5 confirms
     the rendering).
  3. `complete`, outside any transaction, with `AbortSignal.timeout(8000)`.
  4. Check that `redirect_uri` is on the AuthKit origin, then redirect.
  5. A 404 or 400 means the sign-in expired: "This sign-in expired. Go
     back to the app you were connecting and try again."

## Connected apps and revocation

- **The profile card** (`src/app/app/[orgSlug]/profile/connected-apps-card.tsx`)
  lists each grant's app name, access, space, and connected and last-used
  dates, with Disconnect and Disconnect all. "How to connect" has the URL to
  copy, a prefilled Claude link (`claudeConnectorUrl`), and short steps for
  ChatGPT, Claude Code (`claude mcp add --transport http bananasplit
  <url>`), Cursor and VS Code.
- **Disconnect** sets `revokedAt` in `withUserTx`, so the next request is
  refused, including with access tokens issued before it. After the
  response it calls `DELETE
  /user_management/users/{workosUserId}/authorized_applications/{clientId}`,
  best effort and logged; our row is what counts.
- **A password reset and the Google gate's password strip** revoke all the
  user's grants (`src/server/email/password-reset.ts`,
  `src/lib/auth/google-linking.ts`, through `app.revoke_connector_grants`).
- **Account deletion.** There is no self-service deletion today;
  `purge-unverified` only removes accounts that never confirmed an email,
  and `/connect` refuses those. Whatever deletes an account later must also
  delete its WorkOS user (`DELETE /user_management/users/{id}`), or a new
  sign-up with the same email fails at `complete`.
- **`scripts/connectors-grants.ts`** lists or revokes a user's authorized
  apps at WorkOS by our user id.

## The club switch

Admin panel › Privacy › AI connectors: "Members can use this organization
from AI apps they connect, such as Claude or ChatGPT. An app only ever sees
what that member can see here." Off refuses every connector call for the
organization at once; nothing is revoked, so on restores access. Audited as
`privacy.connectors_changed`.

## Tools

37 tools: 20 read tools every grant gets, and 17 write tools a WRITE grant
gets after them. The 13 CRM tools (`crm_*`) are described in
[`crm.md`](crm.md), "Your own Claude (MCP)"; the rest are below.

### Rules every tool follows

- **Annotations.** A `title` and all four hints, explicit:
  - read tools: `readOnlyHint: true`, `destructiveHint: false`,
    `idempotentHint: true`, `openWorldHint: false` (`READ_ONLY`);
  - adds (`create_task`, `add_task_comment`, `add_database_record`,
    `create_note`): `readOnlyHint: false`, `destructiveHint: false`,
    `idempotentHint: false` (`ADDS`);
  - overwrites (`update_task`, `update_database_record`, `rsvp_to_event`,
    `vote_in_poll`): `destructiveHint: true`, `idempotentHint: true`
    (`OVERWRITES`);
  - `post_weekly_update`: `destructiveHint: false`, `idempotentHint: true`
    (`POSTS`). Posting a week again replaces that week's post, as the
    app's Post button does. It is only ever the member's own post, but a
    reviewer may count that as overwriting.
  - `openWorldHint: false` on all: nothing reaches outside Bananasplit.
  - `src/server/connectors/server.test.ts` lists the tools as a client does
    and fails on a missing title, description or hint, an argument without
    a description, or a behavioral directive in a description. The route
    test pins each write tool's hints.
- **Schemas.** Zod input schemas with field descriptions, and output
  schemas. Results are `structuredContent` plus the same JSON as text.
- **Names, links, pages.** Names beside ids, absolute URLs, a default limit
  of 20 (at most 50), and a cursor.
- **Ids** (`tools/ids.ts`). Every item id is opaque: `<kind>:<spaceId>:<id>`,
  for note, task (epics and stories too), event, poll (either kind),
  person, database (its URL key) and expense. `fetch` and the `get_` tools
  take that id alone; space ids are the org ids `list_spaces` returns. A
  forged id finds nothing: the space still opens through
  `withConnectorOrgTx`, and every lookup filters on `organizationId`. Two
  ids stay plain: note folder ids (`list_notes`) and a club-made
  database's row ids (`query_database`).
- **Cursors** (`tools/cursor.ts`). Base64url JSON naming an offset (or a
  club-made database's keyset position) and a fingerprint of the tool and
  its filters. A cursor from another list is refused with "start over
  without a cursor". `search` and the `get_` tools have none.
- **Times.** Instants are ISO 8601 with their offset, in the member's own
  zone, or else the organization's. All-day events and due dates are days
  (yyyy-mm-dd). `list_events` reads a `from` or `to` without an offset in
  the member's zone.
- **One way into a space for reads.** `inSpace` (`tools/space.ts`) runs
  `withConnectorOrgTx` with the tool's feature, loads the space's name,
  slug, zones and sidebar, and refuses a section the organization hid to
  members (`SectionHiddenError`). Owners and admins (`settings.view`) still
  read it, as search does. Hiding Polls hides Find a time too.
- **One way in for writes.** `writeInSpace` (`tools/write.ts`), in order:
  1. A READ grant is refused (`ReadOnlyGrantError`).
  2. `connector.write`, 120 writes an hour per grant across every space.
     It is counted before the space opens, so a refused write counts too,
     and it fails open like every limit (`WriteLimitError`).
  3. `withConnectorOrgTx`: the grant's scope, membership, the club switch
     and the tool's plan feature.
  4. A hidden section is refused to members, as for reads.
  5. The app's own service, then a `connector.<tool>` audit row, in one
     transaction. The diff is `{ client, clientId }`; `client` is the
     grant's app name, null until the WorkOS lookup fills it in.

  The services' own refusals (a closed poll, a task rule, a value its
  column won't take: `{ error }`, `TaskError`, `DatabaseInputError`) come
  back in their own words and roll the write back (`WriteRefusedError`).

### Read tools

| Tool | Backed by | Feature | Section |
|---|---|---|---|
| `list_spaces` | `app.connector_spaces()` and memberships | (none) | |
| `search` (query) | `searchWorkspace` | per kind | as search |
| `fetch` (id) | its kind's tool | its kind's | its kind's |
| `list_tasks`, `get_task` | `getTableTasks`, `taskFilterWhere`, `visibleTaskWhere`; `getTaskDetail`, `getComments`, `getActivity` | tasks | Tasks |
| `list_events`, `get_event` | `getEventsInRange`, `getUpcomingEvents`; `getEventById`, `getViewerRsvps` | rsvp | Calendar |
| `list_notes`, `get_note` | `getNotesForList` (`noteListWhere`); `getNoteById`, `noteToMarkdown` | files | Files |
| `list_databases`, `query_database` | `listDatabases`, `loadView`, `loadRecords` | databases | Databases |
| `list_members` | `listOrgPeopleInTx`, `countOrgPeopleInTx` | people | People |
| `get_weekly_summary` | `getWeeklySummary` | teamwork | Tasks |
| `list_my_reimbursements` | `getMyReimbursements` | finance | Finance |
| `list_open_polls` | `listOpenPolls`, `listQuestionPolls` | polls | Polls, or Find a time, per poll |

- **list_spaces** returns Personal and the member's organizations: id,
  name, kind, the member's role, URL and whether the organization allows
  AI apps, plus the grant's `access` (`read` or `read_and_change`). A
  scoped grant lists only its space; spaces scheduled for deletion are
  left out.
- **search** is the palette's `searchWorkspace` (the viewer comes from
  `src/server/search/viewer.ts`, which ⌘K uses too). It runs over each
  space `list_spaces` lists with AI apps on, one transaction each, and
  merges by score (20 unless asked, at most 50). It searches only what
  `fetch` opens: notes, tasks and epics, events, polls, people and
  databases; a kind whose feature the space lacks isn't searched. Left
  out: the finance ledger, files and folders (`fetch` can't read an
  upload), tags and org-chart roles. A space that refuses is skipped, not
  a failed search. A query with no words returns nothing. The name and
  shape follow ChatGPT's `search`/`fetch` contract (not yet tried against
  ChatGPT).
- **fetch** returns `{ id, title, text, url, metadata }`, with the item as
  Markdown in `text`. A note is its first 40,000 characters (`metadata`
  holds `truncated` and `nextOffset`, for `get_note`). A database is its
  columns and row count, not its rows. A poll reads as its page shows it to
  this member (`buildQuestionPollView`, `buildPollView`): counts stay
  hidden until it closes when the poll says so, and an anonymous poll
  names no voters.
- **get_event** lists the event's linked notes as the notes rules allow,
  and none while the organization hides Files from members.
- **get_note** reads `noteToMarkdown` (the Download Markdown export). A part
  ends after a line break near 40,000 characters when there is one, never
  inside an emoji, and the parts join back into the whole note.
- **query_database.** Built-in databases filter and sort through the view
  grammar (`dbViewQuery`, `queryFor`); a filter the query builder rejects
  is refused with its reason, never dropped. Each column says whether it
  filters or sorts, and its operators. Club-made databases take `query`
  only (`loadRecords`), with values as the grid shows them (choice labels,
  member names, "$15.50"). Columns hidden from members are left out
  (`viewerColumns`); RLS masks contact emails below the privacy tier.
  Individual ballots need the tier Privacy allows (`canViewBallotRows`);
  without it `query_database` refuses and `fetch` describes the database
  without a row count.
- **list_members.** Emails come back for owners and admins
  (`members.viewEmails`), for everyone when Admin panel › Privacy shows
  member emails to members, and always for the member's own row.
- **get_weekly_summary** takes a `member` ("me" unless given), since the
  updates view lets anyone read a teammate's week. RLS leaves out their
  private tasks; a week that hasn't begun reads as this one.
- **list_my_reimbursements** returns only the member's own expense
  requests, with no receipt files and no emails. `fetch` opens one by its
  expense id; anyone else's is not found.

The finance ledger is not exposed: RLS lets every member read it and the
app gates it on `finance.manage`, so a tool that adds it must repeat that
check.

### Write tools (WRITE grants only)

| Tool | Backed by | Annotations |
|---|---|---|
| `create_task`, `update_task` | `createTask`, `updateTask` with `loadTaskEnv(ctx)` | adds; overwrites |
| `add_task_comment` | `addComment` | adds |
| `rsvp_to_event` | `setOwnRsvp` (`src/server/events/rsvp.ts`) | overwrites |
| `add_database_record`, `update_database_record` | `createRecord`, `updateCell` | adds; overwrites |
| `post_weekly_update` | `postWeeklyUpdate` | posts |
| `vote_in_poll` | `setMyVotes` | overwrites |
| `create_note` | `markdownToNote`, `checkNoteContent`, `createNote` (`src/server/notes/create.ts`) | adds |

- **Inputs.** Item ids are the opaque ids above, decoded with `refOf`;
  space ids come from `list_spaces`. An owner, or a member column's value,
  is "me" or a person id from the same space (`memberOf`).
- **create_task and update_task.** The fields are the title, the
  description (Markdown), owner, due day, priority, status and
  `blockedReason`. A status change goes through `updateTask` with the other
  fields, as one change. There is no `expectedVersion`: the last write
  wins, as with the board's quick toggles. Assigning someone above the
  member in the published org chart is refused with their names until the
  member confirms (`confirmAboveLevel: true`); the task is then saved
  flagged and they get `TASK_FLAGGED`, as in the app. `update_task` looks
  the task up first, so a private task the member isn't on is not found.
  Not exposed: collaborators, tags, subtasks and parents, visibility,
  type, start dates and deleting.
- **add_task_comment** notifies the owner and collaborators. The tools
  hand out no raw user ids, so a comment can't @-mention anyone.
- **rsvp_to_event.** A deleted event, or one in another organization, is
  not found; an event the member isn't invited to is refused and nobody's
  answer changes. Going, maybe or not going; there is no way back to "no
  answer", as in the app.
- **add_database_record and update_database_record** take databases the
  space made itself; a built-in one is refused with a pointer to its page.
  Cells are keyed by `query_database`'s column keys (a second "Name" is
  "Name (2)"); values go through the grid's `parseCell`, so choices are
  labels and null clears a cell. One `updateCell` per cell, all in one
  transaction, so one refused cell rolls back every cell.
- **post_weekly_update.** Any day in a week names the organization's week
  (`updateWeekStartOfKey`); a week that hasn't begun, and Personal, are
  refused. Private tasks stay out, as `summaryLines` leaves them.
- **vote_in_poll** is for question polls only. Choices are labels, matched
  as the app compares options (`optionKey`); an empty list takes the vote
  back. A find-a-time poll gets a pointer to its page. The result is the
  poll as its page shows this member.
- **create_note.** The note is always PRIVATE: it has no parent to inherit
  from, and who sees a note isn't something a connected app changes. A
  folder is optional. A leading `# Title` is the title when none is given,
  and is dropped when it repeats the title. With live collaboration on, the
  body is stored as Yjs state too, as `importNote` stores it. The Markdown
  is capped at 100,000 characters. Editing existing notes waits, because
  live collaboration owns their Yjs state.
- **The Markdown converter** (`src/lib/notes/import/markdown.ts`) uses
  `mdast-util-from-markdown` with the GFM extensions. It reads paragraphs,
  headings, quotes, rules, code blocks, tables (first row as the header),
  bullets, numbers and checklists, bold, italic, strikethrough, `<u>`,
  inline code, links and line breaks. A blank line doesn't end a Markdown
  list, so a list's checklist items become a checklist of their own (how
  the export's bullets followed by a checklist round-trip). Links keep only
  http(s), mailto, tel and app paths (`//host` is refused). An image
  becomes a link, never a picture fetched from elsewhere; raw HTML stays as
  text. Callouts, toggles, columns, mentions, dates, page links, task chips
  and file cards don't round-trip: the export's stand-ins come back as
  plain blocks.
- **The audit log** (Admin panel › Audit log) names each connector write in
  words and filters them under AI apps, with the app's name once it's
  known.

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
- **Deleting anything.** No tool deletes in v1.

## Security checklist

- **Tokens.**
  - RS256 only, with `iss`, the exact `aud` and `exp` checked.
  - Never in URLs or logs (`src/lib/observability/scrub.ts` already drops
    `Authorization`).
  - Never forwarded anywhere.
- **Live checks on every call.**
  - the grant isn't revoked;
  - membership and role (`app.set_context`);
  - the plan (`checkSpace`);
  - the club switch;
  - the tool's own permission (`can()`), and the hidden sections.
- **Text.**
  - Text members wrote comes back as data fields in `structuredContent`.
  - Descriptions and `instructions` carry no behavioral directives; both
    directories reject them, and `server.test.ts` checks the descriptions.
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

- **Unit.** Token checks against a local JWKS (wrong `iss`, an `aud` that
  is the environment's client id, expired, missing `uid`, an HS256
  forgery); the grant states, error mapping, cursor and id codecs, text
  parts, consent options and config; the Markdown round trip
  (`src/lib/notes/import/markdown.test.ts`); the tool audit
  (`src/server/connectors/server.test.ts`); `server.json`
  (`config.test.ts`); the challenge route; the pricing row.
- **Protocol** (`src/app/api/mcp/route.test.ts`). Through the route
  handler: a 2025-11-25 `initialize`, `tools/list` and calls; a 2026-07-28
  `server/discover` and calls; the 401 challenge's shape and the Origin
  403; 404 while off; Disconnect; the 600-an-hour limit; READ and WRITE
  tool lists with their hints; a READ grant's instructions and refused
  write; the write limit as an `isError` result; `get_note`, `search` and
  `fetch`.
- **DB** (`src/server/connectors/*.db.test.ts`, `tools/*.db.test.ts`, over
  `src/test/connector-fixture.ts`). The wrappers, and every tool's
  denials: another org's id and a forged one; another member's PRIVATE
  note and a removed share; a PRIVATE task; hidden sections, refused to
  members and open to owners; member emails; the club switch; a grant
  scoped elsewhere. `write.db.test.ts` runs all nine write tools through
  each refusal and checks nothing was left behind and no audit row
  written, plus the audit row's shape and the real limiter refusing write
  121 while another grant still writes. Each file runs its tools through
  the MCP server, so the SDK checks every output schema against real
  rows. These skip silently without Postgres and the role passwords, so
  check that a run actually executed them; Phases 1–3 ran them against
  fresh, migrated databases.
- **RLS.** `pnpm test:rls` with the table in the grant matrix, plus a case
  where one user can't read or revoke another's grant.
- **By hand, each release.** Claude Code, claude.ai, ChatGPT developer
  mode, Cursor, VS Code and the MCP Inspector. *Not done yet: it waits on
  Phase 0.*

## Open questions (Phase 0)

The spike harness and its 13 checks are on `claude/mcp-spike` (commit
`8474061`, runbook `ai-connectors-spike.md`); run them there, since the
feature replaced the spike's `whoami` tool, which shows a token's claims.
Until they run, nothing has been tried against WorkOS itself.

- **The user-id claim.** `urn:bananasplit:uid` appears in access tokens
  issued to both CIMD and DCR clients (checks 3, 4).
- **Localhost as a resource** in staging (check 2); if not, a tunnel.
- **Consent.** How grouped choices render (check 5); whether the choices
  appear as claims (check 6).
- **Check 8: does a refresh keep `sid`?** A new consent clears `revokedAt`,
  so if a refresh mints a new `sid`, a refresh would revive a revoked
  grant. The WorkOS DELETE kills the refresh tokens, but it is best effort.
  If check 8 shows a new `sid`, reviving must also require a `/connect`
  completion after `revokedAt`.
- **Check 9: does a repeat authorization keep `sid`?** If it does, a member
  who disconnected can't reconnect the same app unless the WorkOS DELETE
  went through.
- **Failure paths.** What AuthKit's Cancel does (11), how long an
  `external_auth_id` lives and what `complete` returns once expired (12;
  the WorkOS emulator uses 10 minutes and 404), and whether our page can
  abort the flow (nothing documents it; the fallback tells the member to
  close the window).
- **For WorkOS support.** Custom scopes for self-registered clients; RFC
  9207 `iss` in authorization responses (ChatGPT uses its stable redirect
  URI only with it); a client allowlist.

## Left for later

- **Notifications** name the member ("Alice assigned you …"), not the app
  that made the change. A "from Claude" could follow once `clientName` is
  reliable.
- **More write tools.** Subtasks, tags, collaborators, adding poll
  options, find-a-time answers, editing notes, built-in databases, and
  creating events (admins, without attendee notices).
- **MCP Apps cards.** An event with RSVP buttons, and the task board, for
  Claude, ChatGPT and VS Code. Text results stay for every other client.
- **Personal access tokens** for developer tools and scripts: prefixed
  `bsp_…`, hashed like the ICS token, scoped to a space and an access
  level, with an expiry, checked by the same route.
- **A read-only URL.** `/api/mcp/readonly`, with its own Resource
  Indicator.
- **Not planned: the other direction**, Bananasplit's own AI calling
  Notion or Google MCP servers. Anthropic's MCP connector in the Messages
  API is still beta, Slack admits only Marketplace apps, Google's MCP
  servers are a developer preview, and it would end the no-tools rule in
  `src/server/ai/generate.ts`.
