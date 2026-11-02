# AI connectors: launch checklist

Everything below is a step only the owner can take: accounts, payments,
DNS, legal sign-off and the directory submissions. The feature itself is in
[`ai-connectors.md`](ai-connectors.md), the WorkOS staging spike in
[`ai-connectors-spike.md`](ai-connectors-spike.md), and the draft legal
text in [`ai-connectors-legal-draft.md`](ai-connectors-legal-draft.md).
Production is `https://bananasplit.fyi`, so the MCP URL is
`https://bananasplit.fyi/api/mcp`; if the canonical host changes, every URL
here changes with it (it must equal `NEXT_PUBLIC_APP_URL` plus `/api/mcp`).

**Already in the repository (2026-11-01):**

- 24 tools, each with a title and all four hints, pinned by
  `src/server/connectors/server.test.ts`.
- `/.well-known/openai-apps-challenge`, serving `OPENAI_APPS_CHALLENGE`.
- `server.json` for the MCP Registry, validated against the `2025-12-11`
  schema.
- `scripts/connectors-reviewer.ts`, the reviewer account.
- The reviewer prompts and listing copy, below.

## What gates the submissions

Do not submit to either directory until all three hold:

1. **Phase 0 has run on WorkOS staging** (the spike runbook's 13 checks),
   and its answers are in `ai-connectors.md`, "Open questions". Two of them
   can need code before launch:
   - **Check 8** (does a refresh keep `sid`?). If a refresh mints a new
     `sid`, a refresh would revive a grant the member disconnected, unless
     WorkOS's DELETE went through. The fix is to require a `/connect`
     completion after `revokedAt` before reviving.
   - **Check 9** (does re-authorizing keep `sid`?). If it does, a member who
     disconnected can't reconnect the same app unless WorkOS's DELETE went
     through.
   - **Checks 3 and 4** (the user-id claim reaches CIMD and DCR clients)
     decide whether anything works at all.
2. **Real clients work against production** (step 4).
3. **The legal pages are live**: the privacy additions, and Terms of
   Service. ChatGPT's listing requires a terms URL, and the app has none
   published yet (`TERMS_HREF` in `src/lib/brand/links.ts` is `"#"`).

## 1. Phase 0 on WorkOS staging

Follow `ai-connectors-spike.md` on `claude/mcp-spike` (commit `8474061`):
a WorkOS staging environment, a local database, Claude Code and the MCP
Inspector against `http://localhost:3000`. Fill in the results table, copy
the answers into `ai-connectors.md`, and send WorkOS support the three
questions at the end of the runbook. If check 8 or 9 comes back the wrong
way, the code change above lands before step 3.

## 2. Legal

1. Have counsel review `ai-connectors-legal-draft.md`, then put the agreed
   text into `src/app/privacy/page.tsx` and update its "Last updated"
   date.
2. Publish Terms of Service with the connected-apps clauses, and set
   `TERMS_HREF` to their page (sign-up and checkout link to it).
3. Add WorkOS to whatever subprocessor list you keep, once its DPA is
   signed (WorkOS dashboard › Settings › Legal, or through sales).
4. Pick the support contact the listings will show. Both directories want
   one, and ChatGPT wants a support _page_ URL; today the site has only
   `CONTACT_EMAIL` (a personal Gmail address) and no public page for it.

## 3. WorkOS production and Vercel

The RUNBOOK's "AI connectors" section has the exact settings; in order:

1. **Billing** on the WorkOS account (the custom domain needs it).
2. **Custom domain** `auth.bananasplit.fyi` for AuthKit: add the DNS
   records WorkOS shows in Vercel DNS, and wait for it to verify. The
   issuer and JWKS URL change with it, so this comes before any token is
   issued.
3. **Branding**: the logo (`public/brand/bananasplit-app-icon.svg`),
   colors and any consent-page CSS. AuthKit's consent screen shows them.
4. **Connect › Configuration › MCP Auth**: turn on Client ID Metadata
   Document (CIMD) and Dynamic Client Registration (DCR).
5. **External Sign-in URI**: `https://bananasplit.fyi/connect`.
6. **Resource Indicator**: `https://bananasplit.fyi/api/mcp`, made the
   default. Without it every token's `aud` is the environment's client id
   and the app refuses them all.
7. **JWT template**: `{"urn:bananasplit:uid": {{ user.external_id }}}`.
8. **Vercel, Production scope**: `CONNECTORS_ENABLED=true`,
   `WORKOS_API_KEY=sk_live_…`,
   `WORKOS_AUTHKIT_DOMAIN=https://auth.bananasplit.fyi`, then redeploy.
   Leave the Preview scope without them.
9. **Check**: `/api/health` (with the `CRON_SECRET` bearer) lists
   `production:connectors` as ok, and
   `curl -i -X POST https://bananasplit.fyi/api/mcp` answers 401 with
   `resource_metadata` in `WWW-Authenticate`.

## 4. Real clients against production

With your own account, in each of Claude Code
(`claude mcp add --transport http bananasplit https://bananasplit.fyi/api/mcp`,
then `/mcp` to sign in), claude.ai (Customize › Connectors › Add custom
connector, or the link on your profile's AI apps card), ChatGPT developer
mode, Cursor, VS Code and the MCP Inspector:

1. Connect with **Read only**: `list_spaces` works, the tool list has no
   write tools, and asking for a change gets the read-only explanation.
2. Connect again with **Read and make changes**: create a task, RSVP to an
   event, then check the audit log names the app under AI apps.
3. **Disconnect** on the profile card: the next call is refused, and
   connecting again works (this is check 9 in practice).
4. Leave a token to expire and use the client again (check 8 in practice).
5. Switch an organization's AI connectors off: its calls are refused, the
   others keep working.

Take the listing screenshots and record the review video during these runs
(step 6).

## 5. The reviewer account

Both directories sign in as a test account with a populated organization.
`scripts/connectors-reviewer.ts` makes one: a confirmed password account
(no MFA: Bananasplit has none) that owns **Northwind Robotics Club** on
the Team plan, with tasks, comments, events awaiting its RSVP, notes (one
private to another member), a parts-inventory database, an open poll and
two expense requests, plus a Personal space. Run it against production
from a shell where the production owner URL is set only for that command:

```bash
MIGRATE_DATABASE_URL='<production owner URL>' CONNECTORS_REVIEWER_PASSWORD='<a new password>' pnpm tsx --tsconfig tsconfig.scripts.json scripts/connectors-reviewer.ts --target-env MIGRATE_DATABASE_URL --email <reviewer mailbox> --production
```

- Use a mailbox you control (a password reset would go there), and one
  WorkOS doesn't already know under another user id.
- Keep the password in the password manager; it goes only into the
  directories' private reviewer fields.
- Without `--production` the script refuses any database that isn't local
  or marked `app.fixture_only`. Try it first on a local or preview
  database.
- Re-running recreates the organization with fresh dates, so run it again
  shortly before each review, and after any review that changed things.
- Checked on 2026-11-02 against a freshly migrated, unseeded local
  database: a first run and a re-run (nothing duplicated, the password
  kept), and its refusals of another account and of the slug held for
  another email. As that account, the tools return what the reviewer
  prompts below expect through the MCP server, but not yet through a real
  client.
- Then sign in at `https://bananasplit.fyi/sign-in` as the reviewer once,
  and connect Claude to it, to be sure the account works end to end.

## 6. Screenshots and the video

- **Claude**: no carousel screenshots are needed (they are for MCP Apps);
  keep a few of the consent screen and of Claude using the tools for the
  docs page.
- **ChatGPT**: a reviewer-accessible video URL that walks through the five
  test cases below and the three refusals, starting from connecting the
  app and choosing Read and make changes. Screenshots are optional.
- An icon: `public/apple-icon.png` (180×180 PNG) or the SVG app icon;
  ChatGPT wants it square, at least 48×48.

## 7. Claude Connectors Directory

At `claude.ai/directory/manage` › Submit new › MCP connector (any paid
Claude plan). The portal's steps:

1. **Connection**: `https://bananasplit.fyi/api/mcp`; every user connects
   to the same URL.
2. **Tools**: they sync from the server, grouped read-only and write. None
   should be flagged; `server.test.ts` checks titles and hints.
3. **Listing**: the copy below, a documentation URL, the privacy policy
   (`https://bananasplit.fyi/privacy`), the support contact, the icon, and
   the slug (permanent). **There is no public documentation page yet**:
   the connect steps live on the signed-in profile card. Publish one (the
   URL, Read only versus Read and make changes, what is and isn't exposed,
   Disconnect, the organization switch) before submitting.
4. **Use cases**: reads and writes; the user needs a Bananasplit account
   (free) and, for an organization, membership in it.
5. **Company** and a primary contact.
6. **Authentication**: OAuth, required. Leave the Anthropic-held client
   empty: Claude registers itself by CIMD.
7. **Data handling**: our own API; no health data; no sponsored content.
8. **Test & launch**: the reviewer account's email and password, the steps
   ("Add the connector, sign in with the account, choose Read and make
   changes, ask about Northwind Robotics Club"), and the confirmation that
   every tool has been run (step 4).
9. **Compliance**: the seven acknowledgments.

No allowed link URIs: no tool opens links.

## 8. ChatGPT

In the OpenAI Platform dashboard. OpenAI's flow changes often; follow the
form at the time, which on 2026-11-01 asked for:

1. **Identity**: individual or business verification for the name the app
   is published under (organization settings).
2. **Domain verification**: the submission shows a token. Set
   `OPENAI_APPS_CHALLENGE` to it in Vercel's Production scope and redeploy;
   `curl https://bananasplit.fyi/.well-known/openai-apps-challenge` must
   print exactly the token. Use `https://bananasplit.fyi` as the challenge
   base. Keep it set after verification, in case OpenAI checks again;
   unset, the path answers 404.
3. **Listing URLs** (all https): website `https://bananasplit.fyi`,
   support page (see step 2.4), privacy policy, and terms of service.
4. **Reviewer access**: the reviewer account's email and password, the
   sign-in URL, and the steps. It must work at once, without MFA, codes or
   magic links, which a Bananasplit password account does.
5. **Test cases**: the five and the three below, each run against the
   reviewer account first.
6. **The video** (step 6), and the icon.
7. **Text limits**: display name and short description 30 characters
   each, long description 4,000, up to three default prompts of 128.

New or changed tools stay unavailable in ChatGPT until approved, so a tool
change after launch is a resubmission.

## 9. MCP Registry

`server.json` at the repository root names the server
`fyi.bananasplit/bananasplit`, which needs `bananasplit.fyi` verified with
the registry:

1. Install `mcp-publisher` (the registry's quickstart).
2. Make an Ed25519 key pair and add the TXT record it prints to
   `bananasplit.fyi` in Vercel DNS:
   `bananasplit.fyi. IN TXT "v=MCPv1; k=ed25519; p=<public key>"`. Keep
   the private key in the password manager.
3. `mcp-publisher login dns --domain bananasplit.fyi --private-key <key>`.
4. From the repository root, `mcp-publisher publish`.
5. For a later change, bump `version` in `server.json` and publish again.

The registry is in preview and optional; it lists the server for clients
that browse it, and grants nothing.

## 10. After launch

- Watch Sentry for `connectors` errors and the 429s on `connector.call`
  and `connector.write`.
- Now and then, list self-registered clients
  (`GET /connect/applications?registration_types=dynamic`) and delete
  abusive ones.
- Keep the reviewer account working; re-run the script before re-reviews.
- Run the by-hand client checks (step 4) on each release that touches the
  connectors.

## Reviewer prompts (ChatGPT)

Written against the reviewer account's data. Each was designed from that
data; **run each against production before submitting**, and adjust the
expected behavior to what the app actually returns.

### Should work

1. **Tasks due soon.**
   - Prompt: "What do I have due this week in Northwind Robotics Club?"
   - Tools: `list_spaces`, `list_tasks`.
   - Expected: lists the reviewer's open tasks with due days, including
     "Order replacement servos" (in progress, high priority) and "Draft
     sponsor thank-you letters", and says "Update the parts inventory" is
     overdue.
2. **Meeting notes.**
   - Prompt: "Summarize the notes from our season kickoff meeting."
   - Tools: `search`, then `fetch` (or `list_notes`, `get_note`).
   - Expected: the decisions (entering the spring regional, build nights
     on Tuesdays and Thursdays, a $1,500 parts budget) and the three action
     items.
3. **RSVP.**
   - Prompt: "RSVP me as going to the next build night."
   - Tools: `list_events`, `rsvp_to_event`.
   - Expected: finds "Build night" in Engineering Lab 204, answers going,
     and confirms the event and its time.
4. **Create a task.**
   - Prompt: "Add a task in Northwind Robotics Club to order four spare
     servos, assigned to me, due next Friday."
   - Tools: `list_spaces`, `create_task`.
   - Expected: creates the task with the reviewer as owner and that due
     day, and returns its link.
5. **Query a database.**
   - Prompt: "Which parts are running low in our parts inventory?"
   - Tools: `list_databases`, `query_database`.
   - Expected: "Servo motor, 25 kg" (2, Bin A3) and "Aluminum extrusion,
     1 m" (3, Rack B).

### Should be refused

1. **Sending outside the app.**
   - Prompt: "Email the kickoff meeting notes to every member of the club."
   - Why: no Bananasplit tool sends email or messages; nothing a connected
     app does leaves the app.
   - Expected: says it can't send email from Bananasplit; it may offer to
     draft the text for the member to send. No write tool is called.
2. **Admin actions.**
   - Prompt: "Make Sam Rivera an admin of Northwind Robotics Club."
   - Why: member and role management are not exposed to AI apps.
   - Expected: says it can't change roles and points to Bananasplit's
     member settings. No tool changes anything.
3. **Someone else's private note.**
   - Prompt: "Show me Maya Patel's private note about the officer
     transition."
   - Why: a private note is visible only to its author, so search and
     fetch never return it to anyone else.
   - Expected: says it can't find or can't open that note. Nothing is
     returned from it.

Spares, if one of those doesn't fit the form: "Delete the 'Post the build
night photos' task" (no tool deletes); and, on a Read only connection,
"Create a task to book the lab" (write tools aren't offered, and the app
says the connection reads only).

## Listing copy (drafts)

- **Name**: Bananasplit
- **One-liner** (Claude, at most 200): "Read and update your Bananasplit
  tasks, events, notes, databases and polls, in your Personal space and
  your organizations."
- **Short description** (ChatGPT, at most 30): "Your organization's work"
- **Description**: "Bananasplit is where organizations run their work:
  tasks, a shared calendar, notes, databases, polls, weekly updates and
  reimbursements. Connect it to ask about what's due, summarize meeting
  notes, find a document or a record, and, if you allow changes when you
  connect, create and update tasks, RSVP to events, vote in polls, add
  database rows, post your weekly update and write notes. The app sees
  only what you can see in Bananasplit, as you, and organization admins can
  turn AI apps off for their organization. Nothing it does sends email or
  leaves Bananasplit, and you can disconnect it from your profile at any
  time."
- **Default prompts** (ChatGPT, up to three):
  - "What's due for me this week?"
  - "Summarize our latest meeting notes."
  - "What's on our calendar next week?"
