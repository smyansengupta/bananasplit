# AI connectors: Phase 0 spike runbook

Throwaway harness on `claude/mcp-spike` for the WorkOS questions in the
plan's Phase 0. The plan itself (`docs/features/ai-connectors.md`) is on
`claude/personal-files-databases`, not committed yet. Copy the answers
there when the spike is done, then delete this branch.

## What the harness is

| Path | What it does |
|---|---|
| `src/app/connect/` | AuthKit's External Sign-in URI. Signed out, it links to sign-in and back. Continue calls WorkOS `complete` with our user id and the two consent questions (space, access), then redirects to AuthKit. |
| `src/app/api/mcp/route.ts` | The MCP endpoint. A foreign `Origin` gets 403; no valid token gets a 401 naming the metadata; otherwise one tool runs, `whoami`. |
| `src/app/.well-known/oauth-protected-resource/` | Protected resource metadata, at the root and path-suffixed URIs. |
| `src/server/connectors/` | Config, token checks (`jose`), WorkOS REST calls and the MCP server. |
| `scripts/connectors-grants.ts` | Lists or revokes a user's authorized apps through WorkOS. |

`whoami` returns:
- the account and spaces the token resolves to, under RLS;
- the grant fields (`client_id`, `sid`, `sub`, the space and access claims);
- the token's lifetime and every claim.

The server log prints one `[connectors] request` line per call. A refused
token prints the expected and actual `iss` and `aud`. Neither ever prints
the token itself.

Covered without WorkOS: `pnpm vitest run src/server/connectors src/app/api/mcp`.
- **Token checks:** wrong issuer, an `aud` set to the WorkOS client id,
  expired, missing user-id claim, an HS256 forgery.
- **Endpoint:** the 401 challenge and the Origin 403.
- **Protocol:** a 2025-11-25 client (`initialize`, `tools/list`, `whoami`)
  and a 2026-07-28 client (`server/discover`, `whoami`).

## Before you start

1. **A local database.** The `.env` here links to the main checkout's.
   - It needs Postgres on `localhost:5432` (not running when this was
     built).
   - It also needs the three role passwords the README describes:
     `APP_DB_PASSWORD`, `SERVICE_DB_PASSWORD` and `AUTH_DB_PASSWORD`, each
     `test`.
   - Then run these, from this worktree:

     ```bash
     pnpm prisma migrate deploy
     ```

     ```bash
     pnpm db:local-roles
     ```

     ```bash
     pnpm db:seed
     ```
2. **A WorkOS staging environment.**
   - Connect › Configuration › MCP Auth: turn on **Client ID Metadata
     Document** and **Dynamic Client Registration**.
   - MCP resource indicators: add `http://localhost:3000/api/mcp` and make
     it the default.
   - External Sign-in URI: `http://localhost:3000/connect`.
   - JWT template: `{"urn:bananasplit:uid": {{ user.external_id }}}`.
3. **Two lines in `.env`:** `WORKOS_API_KEY=sk_test_…` and
   `WORKOS_AUTHKIT_DOMAIN=https://<subdomain>.authkit.app`.
4. **Run the app from this worktree.** Stop any other server on port 3000
   first.

   ```bash
   pnpm dev
   ```

## Checks

Fill in the result column as you go.

| # | Check | How | Result |
|---|---|---|---|
| 1 | Discovery | `curl -i -X POST http://localhost:3000/api/mcp` gives 401 with `resource_metadata`. `<authkit>/.well-known/oauth-authorization-server` has `client_id_metadata_document_supported: true` and `none` in `token_endpoint_auth_methods_supported`. | |
| 2 | Localhost resource | WorkOS accepted the `http://localhost` Resource Indicator, and whoami's `aud` equals it. | |
| 3 | CIMD client | Claude Code: `claude mcp add --transport http bananasplit-spike http://localhost:3000/api/mcp`, then `/mcp` › Authenticate, then ask it to call whoami. Is `urn:bananasplit:uid` present? | |
| 4 | DCR client | `npx @modelcontextprotocol/inspector`, Streamable HTTP, connection type "Via Proxy", the OAuth flow, then whoami. Same questions as 3. | |
| 5 | Consent screen | What AuthKit shows: client name and logo, redirect host, the two questions, which choice is preselected. Screenshot it. | |
| 6 | Consent claims | `urn:bananasplit:space` and `urn:bananasplit:access` are in whoami's claims with the chosen values. | |
| 7 | Token lifetime | whoami's `lifetimeSeconds` (the docs show 300 and 3600). | |
| 8 | Refresh | After the token expires, call whoami again. A new `iat`; is `sid` the same, and are the consent claims still there? | |
| 9 | Re-authorize | Remove and re-add the connector in the same client. Is consent asked again? Does `sid` change? | |
| 10 | Revoke | `pnpm tsx --tsconfig tsconfig.scripts.json scripts/connectors-grants.ts list <account.id>`, then `revoke <account.id> <client id>`. Does the next refresh fail with `invalid_grant`? Does the current access token keep working until `exp`? | |
| 11 | Cancel | Press Cancel on AuthKit's consent screen. Where does the browser land, and what does the client say? | |
| 12 | Expired sign-in | Open `/connect` from a fresh attempt, wait more than 10 minutes, press Continue. Does it land on `?result=expired`, and with what status in the `[connectors] complete refused` log line? | |
| 13 | Email clash | Optional. Run the same email from a second local database (a different user id): `complete` should refuse. Note the status. | |

## Ask WorkOS support (you send it)

> We're using AuthKit Standalone Connect as the authorization server for a
> remote MCP server. Three questions: (1) Can our environment give
> self-registered (CIMD/DCR) clients custom scopes as an
> environment-wide default? (2) Do you plan to return the RFC 9207 `iss`
> parameter in authorization responses and advertise
> `authorization_response_iss_parameter_supported`? (3) Is there a way
> to allowlist or block specific self-registered clients?

## Not in the spike

- No `ConnectorGrant` table and no migration.
- No plan gating and no club switch.
- No tools beyond whoami.

Those are Phase 1, built fresh from the plan rather than grown from this
harness.
