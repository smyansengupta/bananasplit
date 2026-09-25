# Guided setup: connecting a club's accounts

A new organization starts empty. **Setup** (`/app/<your-url>/setup`) is the
short version of everything in `settings.md` and `databases.md`: it walks an
owner or admin through the four services the suite can use, one at a time,
and after each connection it does the thing the connection was for instead of
handing back an empty screen.

A club that has its credentials in front of it is done in a few minutes. A
club that has none of them still ends somewhere useful.

Owners and admins only. Members who open it are told why and sent back.

## Getting there

- The **org overview** shows a prompt while anything is left to connect, and a
  louder one when something that used to work has stopped. It names the next
  step and what it is worth, and it goes away when you press **Done for now**.
- **Settings** and **Settings > Integrations** both link to it.
- Once you are set up, **Connection status** (`/app/<your-url>/setup/status`)
  is the page you come back to.

## The four steps

Each step says the same four things, in this order: what it turns on, what
you are agreeing to, where the credential lives (click by click), and then
the field to paste it into. The consequences are never hidden behind a
disclosure, because a consequence nobody read is not a consequence.

Every step can be **skipped**, and a skipped step can be picked up later from
the rail on the left. Nothing expires. Pressing **Done for now** only hides
the prompt on the overview; the flow and every step stay exactly where they
are.

| #   | Step                         | About  | Needs first                                          |
| --- | ---------------------------- | ------ | ---------------------------------------------------- |
| 1   | Club website data (Supabase) | 5 min  | one SQL file run in the website's Supabase project   |
| 2   | Google Calendar              | 2 min  | the club's own Google account                        |
| 3   | Email sender (Resend)        | 10 min | a verified sending domain — DNS, so not same-sitting |
| 4   | Claude API key               | 3 min  | an Anthropic account the club pays on                |

The order is time to value, not importance. The website data source is first
because it is the only step that fills empty screens.

### 1. Club website data

Reads check-ins, signups, sessions and ballots from the Supabase project
behind the club website, through the fixed read-only contract described in
`databases.md`: a role that may call six export functions and nothing else.
It cannot select from your tables, it cannot read the room codes that gate
check-in, and nothing in the suite is ever written back to the website.

The step walks through applying `supabase/suite-export.sql`, giving
`cbc_suite_reader` a password, and reading the project ref, region and
pooler prefix off the **Connect > Session pooler** string. The host is
derived from those fields; no free-form host is ever accepted.

**When it connects**, the first sync is queued immediately. The step watches
the job and turns into the real numbers as they land: how many check-ins,
signups, sessions and ballots the databases now hold, a first attendance
chart, and links straight into Attendance, People, Ballots and Reports. If
the website answered but had nothing in it, the step says so plainly and
offers CSV import and manual entry instead.

### 2. Google Calendar

Mirrors sessions created here onto the calendar you pick. The step names
which calendar gets public events and which gets internal ones, and is
explicit that the portal can only touch events it created itself, that
disconnecting revokes access at Google, and that signing in with a personal
account means the club's calendar leaves when that person does.

Connecting needs a platform-level Google OAuth client. Where there is none
(local development, most previews) the Connect button is disabled and says
so; the rest of the step still works.

### 3. Email sender

The one step you cannot finish in a sitting, and the step says so up front:
verifying a domain in Resend means adding DNS records, and DNS takes
anywhere from ten minutes to a few hours. Until the domain reads **Verified**
in Resend, **Test connection** will keep failing, and the failure will say it
is the DNS rather than the key.

The key must have **Full access**: the domain check reads your domain list,
which a sending-only key cannot do.

**When it connects**, the step offers to send one test message from your own
sender to your own address, and links to the notification settings and the
member invitations that now come from you.

### 4. Claude API key

Used by one feature: reading an uploaded org chart into positions and
people. The step is explicit about the money — one document is one API call
billed to the club's own Anthropic workspace, nothing runs on a schedule,
and the document is sent to Anthropic's API to be read. It recommends a
club-specific workspace with a monthly spend limit, and lets you pick a
cheaper model than the Opus default.

**When it connects**, it links to the org chart importer the key exists for.

## When a test fails

Every failure shows two things: what the service actually said, and the one
thing to change. The field at fault is outlined, so a wrong project ref and a
wrong password do not look the same.

| What you see                             | What it usually is                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| refused the password for the reader role | the `ALTER ROLE` line was never run, or the password has a quote in it                      |
| has no suite export                      | `suite-export.sql` went to a different project than the ref you entered                     |
| pooler host was not found                | the region or the `aws-0`/`aws-1` prefix is wrong — read both off the Session pooler string |
| the website database did not answer      | a free Supabase project pauses after a week; resume it                                      |
| `<domain>` is pending in Resend          | the DNS records are not all in place yet; this is normal, come back later                   |
| Resend rejected this API key             | the key is sending-only; make one with Full access                                          |
| Claude rejected this API key             | wrong, revoked, or from another account                                                     |
| it cannot use `<model>`                  | the key works; pick a different default model                                               |
| Google access was revoked or expired     | reconnect; in Testing mode Google expires refresh tokens weekly                             |

Anything the flow has not seen before is shown verbatim rather than
swallowed, so an unexpected message still reaches whoever can act on it.

## Connection status

`/app/<your-url>/setup/status` is the standing view, for the day something
breaks rather than the day you set it up:

- **Not working** at the top, each with the service's own message, the fix,
  and a button straight to that step.
- **Working, but behind** for things that are connected but stale: a sync
  more than two hours old, or a credential nobody has re-proved in sixty
  days.
- One row per connection with the last four characters of its credential,
  when it was last proved, when data last arrived, what host it reads from,
  and who set it up.
- **Test connection**, **Reconnect** and **Disconnect** on each, plus the
  per-stream sync table from the Databases page.

Disconnecting Google revokes access at Google and stops mirroring; events
already on the calendar are left alone. Disconnecting any of the others
deletes the stored credential (owners only) — rows already pulled in stay,
but stop updating.

## A club with no website

Nothing in the flow is a dead end for an org with no Supabase project. Skip
step 1 and the last panel says so, then offers the two routes that need no
integration at all:

- **Import a CSV** into Attendance or Signups — up to 5,000 rows, previewed
  before anything is saved, with every skipped row explained (`databases.md`).
- **Add rows by hand** — New session, then Add check-in on that session.

Rows that arrive either way behave exactly like synced ones: the same
rollups, the same reports, the same exports. Connecting a website later
changes nothing you have already entered.

## For the integrator

- Progress is **derived** on every read from the org's `OrgIntegration` rows,
  never stored and never cached, so a service that stopped working shows as
  broken the moment its next test fails. The only stored state is two columns
  on `OrgSettings` (`20260924190000_c1_setup_state`): `setupSkipped` (which
  steps the club passed over) and `setupCompletedAt` (whether someone pressed
  Done). No new table, so no new policy and no new GRANT; `P-C1-01` and
  `P-C1-02` in `prisma/rls/phases.mjs` cover the columns.
- The step copy lives in `src/server/setup/catalog.ts`. It is pure data with
  no server-only import, so the client panels render it directly. Adding a
  fifth integration means adding a row there and a form in
  `step-forms.tsx`.
- Failure text lives in `src/server/setup/diagnose.ts`, matched on the
  reason strings the providers return. A reason with no rule passes through
  unchanged.
- Credentials never leave `src/server/secrets`. The actions in
  `src/app/app/[orgSlug]/setup/actions.ts` run on the service path (not
  `withOrgAction`) for the same reason Settings does: no transaction may be
  open around the network check. No action returns a credential; the client
  sees status and the last four characters, nothing else.
- The open step is `?step=`, not client state, so the flow survives a
  refresh, a bookmark and the back button, and every panel is a server
  component. `?edit=1` reopens the form for a step that is already connected.
- The website data source's connection test is `testSupabaseSource` in
  `src/server/sync/connection.ts` — the same one the sync job uses — so
  "Test connection" and "will the sync work" can never disagree. Settings >
  Integrations calls the same one.

### Locally

Google needs a real OAuth client, so its Connect button is disabled; the rest
of the flow works. For the website data source, build the stand-in and set
`SOURCE_SYNC_ALLOW_LOCAL=1`:

```
pnpm exec tsx --tsconfig tsconfig.scripts.json scripts/source-sync-standin.ts \
  --website ../anthropic-club-website --db cbc_suite_standin
pnpm jobs:drain --watch
```

Then press **Test connection** on step 1: it connects to the stand-in, and
the first sync runs in the drain. Mail goes to `.data/mail/`.
