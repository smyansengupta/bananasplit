# Live collaboration on notes: setup

Several members can edit the same note at once and see each other's changes
as they type, with a coloured caret and name for everyone in the note and
their avatars next to the save status. It is **off by default**
(`COLLAB_ENABLED`); while it is off, or whenever the collaboration server
cannot be reached, notes use the autosave editor exactly as before.

Production runs on Vercel, whose functions cannot hold the long-lived
WebSockets live editing needs, so it needs one more service: a small
collaboration server, shipped in this repo (`pnpm collab:start`), or a hosted
equivalent (see [Hosting](#hosting-options)). Choosing and running it is the
one decision left before turning this on.

## For an org

- **Who edits, who watches.** The same rules as always: a note's author and
  OWNER/ADMIN can edit; other members can read ORGANIZATION notes, and now
  watch them change live (read-only, with everyone's carets). A **PRIVATE**
  note stays its author's alone, live or not (the author can still have it
  open in two tabs).
- **What is live.** The body. The title, visibility and linked event save as
  soon as you change them, but other people see a new title on their next
  visit.
- **Status.** "Live" once joined, "Syncing…" while your typing is on its way,
  "Saved" when the server has written it into the note, "Offline —
  reconnecting…" if the connection drops. Keep typing when offline: the
  changes are kept in the tab and merged when it reconnects (closing the tab
  first asks for confirmation).
- **Making a note private or deleting it** closes its live sessions at once:
  anyone who may no longer see it loses the note on their screen ("This note
  is no longer available to you").
- **Search, the notes list and exports** see live edits a few seconds after
  typing stops, like autosaved ones.

## How it works

```
browser (TipTap + Yjs)  --wss, token-->  collaboration server  --signed HTTPS-->  app bridge routes  -->  Postgres (RLS)
          ^                                  (Hocuspocus)                          /api/collab/load
          |                                                                        /api/collab/store
          +--- first token from the note page, fresh ones from issueNoteCollabToken (RLS read as the user)
```

- **Editor.** With a session, the note page's editor binds to a Yjs
  document (TipTap's Collaboration and CollaborationCaret extensions) instead
  of the stored JSON. The transport sits behind a small provider interface
  (`src/components/notes/collab/provider.ts`), so another backend is one new
  factory, not a new editor.
- **Tokens.** The app mints a 5-minute HS256 JWT (`src/lib/collab/token.ts`)
  only after reading the note back through RLS as the user: the note page
  mints the first, `issueNoteCollabToken` every later one. It names the user,
  the org, the one document it opens, and `perm` (`write` for the author or
  an OWNER/ADMIN, `read` otherwise). The collaboration server trusts nothing
  else from the browser: it verifies the token on connect, makes `read`
  connections read-only (their document updates are dropped), stamps every
  awareness (presence) state with the token's user so nobody can appear as
  someone else, asks for a new token a minute before expiry and closes the
  connection at expiry without one. Losing access therefore takes effect
  within five minutes at most, and at once when a note turns PRIVATE or is
  deleted: the app calls the server's signed `/revoke`, which closes the
  note's connections and refuses every token minted before it for that
  note, so only a token from a fresh RLS read gets back in.
- **Persistence.** The collaboration server holds no database credentials.
  It loads and saves through the app's bridge routes, signed with a key
  derived from `COLLAB_SECRET`; the app opens the named user's own RLS
  context (`withOrgTxAs`) for the connecting user (load) or the last writer
  (store), so the note policies apply to a live save exactly as to an
  autosave. Saves are debounced (2 seconds after the last edit, at least
  every 10 seconds while typing) and write `contentJson`, `contentText` (the
  search vector follows), the Yjs state (`Note.yjsState`), `updatedById` and
  a version bump. A body that did not change writes nothing.
- **No duplicated text.** A note that was never edited live is seeded from
  `contentJson` with a client id derived from that content, so a restarted
  server seeds exactly what reconnecting editors already hold. Once a note
  has a Yjs state, every write builds on it: an autosave (someone on the
  fallback editor) is applied to the state as an edit, and the next live save
  merges it and hands it back to the live editors. The version check still
  protects autosave editors from overwriting a live save (they get the usual
  "updated by someone else" banner). `src/lib/collab/note-doc.ts` has the
  details and `note-doc.test.ts` the cases.
- **Fallback.** Joining shows the note read-only for up to 6 seconds; if the
  server does not answer, refuses the token or never syncs, the editor falls
  back to autosave for the rest of the visit. Once live, a dropped
  connection keeps the live editor rather than switching (saving the same
  edits both ways would write them twice).
- **CSP.** The collaboration origin is added to `connect-src` only while
  collaboration is on (`src/lib/security/csp.ts`).

## Hosting options

| Option                                                      | What it takes                                                                                                                                                                                                                                                                                                   | Trade-offs                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Self-host the bundled server** (recommended to start)     | Any always-on Node 22+ host with WebSockets and TLS: Fly.io, Render, Railway, a small VM, Cloud Run with one minimum instance. Run `pnpm install --frozen-lockfile && pnpm collab:start`.                                                                                                                       | Works as shipped. Note content stays between your app, your database and your server. Roughly free to a few dollars a month at club scale. One more service to deploy and watch. One instance holds each open note in memory; several instances would need Hocuspocus's Redis extension (not needed for a club). |
| **TipTap Cloud** (hosted Hocuspocus)                        | A TipTap account and app; the browser side stays Hocuspocus-compatible, and our tokens are already HS256 JWTs (sign them with TipTap's secret instead). Persistence moves to their webhook plus REST API: a new route that receives document updates and calls `storeNoteState`, and seeding through their API. | No server to run. Paid beyond the free tier. Every note body is stored by a third party (a privacy decision for board notes). About a day of adapter work.                                                                                                                                                       |
| **Liveblocks** (Yjs rooms)                                  | A Liveblocks account; a provider factory wrapping `@liveblocks/yjs`; their access-token endpoint in place of our token (minted after the same RLS read); their `ydocUpdated` webhook plus REST read to persist, and their REST write to seed.                                                                   | Managed, with presence tooling. Per-user pricing, vendor lock-in, content stored by a third party, and the most adapter work.                                                                                                                                                                                    |
| **PartyKit / Cloudflare Durable Objects** (`y-partyserver`) | A Cloudflare account; our rules (token check, read-only, presence stamping, `/revoke`) ported to a party server that calls the same bridge routes; a provider factory for its Yjs provider.                                                                                                                     | Cheap and scales without thinking about it; you still own the code. The server rules have to be rewritten for that runtime.                                                                                                                                                                                      |

Whatever the host, the app side is the same: the bridge routes, the tokens
and the fallback do not change.

## What to decide and provide to turn it on in production

1. **Pick the host** (above). For the bundled server: a public `wss://`
   URL for browsers (for example `wss://collab.<your domain>`), and outbound
   HTTPS from it to the app's production origin.
2. **Generate the shared secret** once: `openssl rand -base64 48`. Treat it
   like `AUTH_SECRET`: anyone holding it can act as any member in live
   editing.
3. **On the collaboration host**, set `COLLAB_SECRET`, `COLLAB_APP_URL`
   (the app's production origin, e.g. `https://portal.example.org`) and, if
   the platform does not set `PORT`, `COLLAB_PORT`. Start it with
   `pnpm collab:start` and check that `https://<host>/` answers.
4. **In Vercel (Production scope)**, set `COLLAB_ENABLED=true`,
   `COLLAB_SERVER_URL` (the `wss://` URL) and the same `COLLAB_SECRET`,
   then redeploy. The migration (`20260926120000_note_yjs_state`) applies on
   deploy like every other.
5. **Previews:** leave `COLLAB_ENABLED` unset in the Preview scope (the
   default) unless previews get their own collaboration server; Vercel
   Deployment Protection would also block its calls into a preview.
6. **Watch it:** point the uptime monitor at the collaboration host too.
   When it is down, notes quietly fall back to autosave.

RUNBOOK "Live collaboration" has the same steps plus secret rotation.

## For the platform operator

| What                 | Where                                                                                                                                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App (Vercel)         | `COLLAB_ENABLED` (`"true"` to turn on), `COLLAB_SERVER_URL` (`wss://`, or `ws://` on localhost), `COLLAB_SECRET` (32+ characters). Any one missing or invalid keeps collaboration off and logs `[collab] COLLAB_ENABLED is set but ignored: …` once. |
| Collaboration server | `COLLAB_SECRET` (same value), `COLLAB_APP_URL` (default `NEXT_PUBLIC_APP_URL`), `COLLAB_PORT` or `PORT` (default 1234), `COLLAB_HOST`. Node 22+. Entry point `scripts/collab-server.ts`; code in `src/collab-server/`.                               |
| Bridge               | `POST /api/collab/load` and `/api/collab/store` (503 while off, 401 without a valid signature, 413 above 3 MB of document state). ESLint lets only these routes import `withOrgTxAs`.                                                                |
| Revoke               | `POST <collab host>/revoke`, signed, called after commit when a note turns PRIVATE or is deleted: closes the note's connections and refuses older tokens for it.                                                                                     |
| Storage              | `Note.yjsState` (bytea, NULL until a note is saved live). Covered by the existing Note policies (RLS case P-COLLAB-01); left out of list reads and org exports.                                                                                      |

## Local development

1. Add to `.env` (any 32+ character secret):

   ```sh
   COLLAB_ENABLED="true"
   COLLAB_SERVER_URL="ws://localhost:1234"
   COLLAB_SECRET="local-dev-collab-secret-at-least-32-chars"
   ```

2. Apply the migration (`pnpm prisma migrate dev`), then run the app and the
   collaboration server side by side:

   ```sh
   pnpm dev          # the app on :3000
   pnpm collab:dev   # the collaboration server on :1234 (restarts on change)
   ```

3. Open the same ORGANIZATION note as two seeded users (two browsers, or a
   private window; every seeded user's password is `password123`), for
   example `kristine@example.edu` (the author) and `oliver@example.edu`
   (ADMIN, can edit) or `alex@example.edu` (MEMBER, watches read-only).

To see the fallback, stop `pnpm collab:dev` and reload: the note opens in the
autosave editor after a few seconds. The tests that pin this feature:
`src/lib/collab/*.test.ts` (tokens, bridge signatures, the Yjs mapping),
`src/collab-server/server.test.ts` (the real server over WebSockets),
`src/components/notes/**/*.test.tsx` (the session and the fallback),
`src/app/api/collab/store/route.test.ts`, the note action tests,
`src/server/collab/persistence.db.test.ts` (the bridge on the real RLS
path) and P-COLLAB-01 in `pnpm test:rls`.

## Limits

- The title, visibility and event are not live (they save per field, last
  writer wins); only the body merges.
- A member removed from the org, or demoted, keeps a live connection until
  their token's next refresh (at most five minutes); their saves are refused
  from the moment the database says so.
- Undo in a live note undoes your own changes only.
- The bundled server keeps open notes in memory on one instance; a save that
  still fails after three retries is logged and kept in memory until the
  next edit, so watch its logs for `[onStoreDocument]` errors.
