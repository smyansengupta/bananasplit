# Databases: setup

Everyone in the org can browse the club's data here: the sessions, who
checked in, who signed up and what people voted for. Sessions and calendar
events are the same records. Check-ins, signups and ballots come from the
club website (or from CSV, or typed in by an admin).

## What each database holds

| Database | One row is | Where the rows come from |
|---|---|---|
| Sessions | a workshop, social, hackathon, info session or board meeting | the calendar, the website sync, or **New session** here |
| Attendance | one check-in, with the stamp it earned and the person's term total | the website sync, CSV import, or **Add check-in** |
| Signups | one person's interest form for one term | the website sync, CSV import, or **Add signup** |
| Ballots | poll results; for authorized roles, one row per answer | the website sync |
| People | one person per term: sessions, stamps, first and last visit, lapsed | computed from attendance |

Stamp numbers, term totals, first visits, "lapsed", signup status and
conversion are **computed**, not typed: they are recomputed in the same
transaction as every write that could change them, so the table, the CSV
export and Reports always agree.

## Who sees what

Set this in **Settings > Privacy**; the database enforces it on every path
(the table, the row drawer, search, a `?row=` deep link and CSV export),
not just in the screens.

| Data | Default | Setting |
|---|---|---|
| Sessions, Attendance, People, poll results | all members | per database, in Privacy |
| Signups | owners and admins | per database, in Privacy |
| Email addresses | owners and admins (members see `m***@husky.neu.edu`) | contact email visibility |
| Individual ballots (who voted for what) | owners only | ballot visibility: owners, owners and admins, or nobody |
| Small result groups | hidden below 3 votes, shown as `<3` | minimum group size |

A treasurer reads as a member. Opening a single ballot is recorded in the
org's audit log, as is every CSV export, edit, merge and import.

Only owners and admins can add, edit, suppress or delete rows. Rows that
came from the website can be **suppressed** (kept, but not counted) and
given suite-side corrections (a display name, "added to list"); they cannot
be deleted, because the next sync would bring them back. Nothing in the
suite is ever written back to the website.

## Connecting the club website (Supabase)

The suite keeps its own copy of the website's data and refreshes it on a
schedule. It reads through a **fixed, read-only contract**: a login that can
call six functions and nothing else. It never uses the project's
`service_role` key, and it cannot read the room codes that gate check-in.

**1. Apply the export to the website's database.** In the Supabase SQL
editor for the project (staging first, then the live project between
sessions), run `supabase/suite-export.sql` from the website repository. It
creates the `suite_export` schema, the six functions
(`contract_version`, `sessions_all`, `checkins_since`, `signups_since`,
`ballots_page`, `unsubscribes_all`) and the `cbc_suite_reader` role, and
revokes execution from everyone else, including the public `anon` key.
Run the four checks at the foot of that file afterwards.

Do **not** add `suite_export` to Settings > API > Exposed schemas: that
would put a roster reader behind the website's public key.

**2. Give the reader a password**, once, in the same SQL editor:

```sql
alter role cbc_suite_reader with password '<a long random password>';
```

**3. Connect it in the suite**, in Settings > Integrations > Website data:

| Field | Where to find it |
|---|---|
| Project ref | the 20-character id in the Supabase project URL |
| Pooler region | the project's region, e.g. `us-east-1` |
| Pooler prefix | `aws-0` or `aws-1`, whichever the project's connection string shows |
| Role name | `cbc_suite_reader` |
| Password | the one you just set |

The suite **derives** the host (`{prefix}-{region}.pooler.supabase.com`,
port 5432) and the user (`{role}.{projectRef}`) from those fields: no
free-form host is ever accepted. The connection is read-only, TLS is
verified, and statements time out after 10 seconds. The password is
encrypted at rest and never shown again. Press **Test connection**: it
checks the contract version and nothing else.

> **Connection spike.** TLS, confirmed 2026-10-02: both `aws-0` and `aws-1`
> pooler hosts exist, and each presents `*.pooler.supabase.com`, signed by
> Supabase Intermediate 2021 CA, signed by Supabase Root 2021 CA. That root
> is in no public trust store, so Node rejects the chain on its own; the
> suite pins the root from `src/server/sync/supabase-root-ca.ts` (valid to
> 2031). `SUPABASE_ROOT_CA_PEM` replaces it if Supabase rotates first.
> Still open: the `role.projectRef` username format, inferred from
> Supabase's documentation. Record it here once someone with dashboard
> access has run the test.

### What the sync does

- **Sessions** are matched to calendar events: first by the link it already
  has, then by the same local date, a start within 90 minutes and a matching
  title. One candidate is linked; several create a session flagged in
  **Possible duplicates**; none creates a new internal session.
- **The suite wins.** Once anyone edits a session here, the sync stops
  overwriting its title, time and room; it still maintains the link, the
  term and the stamp slot. A session deleted on the website is unlinked and
  flagged, never deleted here.
- **Check-in methods** map from the website's `source`: `code` is **Form**
  (the student typed the room code), `link` is **QR** (a pre-filled
  check-in link), `officer` is **Manual**. Anything unexpected is stored as
  Form and counted in the sync status.
- **People** are matched by email address. A person whose address is a
  current member's verified email is linked to their account, so their name
  and picture appear on their rows.
- **Ballots** are imported except load and smoke tests (`loadtest-*`,
  `smoke-*`). Imported ballots are stored but **not counted** when their
  poll has no definition yet, when it is marked as a test, when they were
  cast outside the poll's window, or when they name options the poll no
  longer offers (pre-launch test ballots look exactly like this).
- **Unsubscribes** mark the person, so signup views and exports honour them.

Runs are hourly, on **Sync now**, and when someone opens a database whose
data is more than ten minutes old. Nothing syncs inside a page request: the
job runs separately. Once a week (or on **Full reconcile**) it re-reads
everything and removes rows the website no longer has. The panel on the
Databases page shows, per stream, the last run, rows written and any error.

Locally, `pnpm jobs:drain --kind source-sync` runs a pending sync; there is
a stand-in for the website database at `scripts/source-sync-standin.ts`.

## Poll definitions

A poll's questions and labels live in the website repository, not in its
database. Paste or upload `src/lib/polls/<slug>.json` in **Ballots > Poll
definitions** to give the results real labels, set the voting window and
mark test polls. Re-importing re-evaluates that poll's ballots. Without a
definition, the ballots are kept and shown as "No poll definition yet".

## CSV import, for orgs without a website

**Import CSV** on Attendance or Signups takes up to 5,000 rows and 4 MB,
previews them (nothing is saved), lists every row it would skip and why,
then imports in one go. Attendance needs a `session` column (the session's
id or its exact title) plus an email and/or name; Signups need a `name`.
Times are read as the org's local time. Imported rows are suite-side: they
can be edited and deleted.

## Filtering, sorting and links

Every table sorts, filters, searches and pages **on the server**, so the
view's URL is shareable and Reports can link straight into a filtered view:

```
/app/{org}/databases/{database}?f={column}:{op}:{value}&sort={column}:{dir}
  &q={search}&from={yyyy-mm-dd}&to={yyyy-mm-dd}&page={n}&row={id}
```

Operators are `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `contains`, `in` and
`isnull`; `f` repeats. Dates are whole days in the org's timezone. Only
columns a database lists as sortable or filterable are accepted; anything
else is ignored and named on the page. **Export CSV** downloads exactly the
current view, with the viewer's own visibility applied.

## Merging duplicates

- **Sessions:** Sessions > Possible duplicates, or "Merge into another
  session" in a session's panel. Check-ins, RSVPs, notes, expenses and the
  website link move to the session you keep; the other is removed from the
  calendar too. There is no undo; the audit log records what moved.
- **People:** in any person's panel, "Merge a duplicate into this person".
  Their addresses, check-ins, signups and ballots move across. Splitting an
  address back off creates a separate person again.
