# Calendar, Google Calendar sync and the website feed: setup

The suite's database is the source of truth for every event. Sessions,
workshops, socials, hackathons and board meetings are created and edited in
**Calendar** (or in **Databases > Sessions**, which is the same record).
From there:

- **public** events are copied to the club's Google Calendar (a mirror for
  people who subscribe) and published on a cached, read-only feed that the
  club website reads when it builds;
- **internal** events stay inside the suite. They never reach the website or
  the public Google Calendar.

## For an org

### 1. Events

- **Who:** owners and admins create, edit, drag and delete events. Members
  see the calendar, answer invitations (RSVP) and run polls (availability
  polls and question polls).
  Finalizing a poll creates an event, so an admin does it.
- **Type:** workshop, info session, hackathon, social, board meeting or
  other. The website uses the type for its colors and labels.
- **Visibility:** _Internal_ (the default) or _Public_. Choosing Public shows
  a warning: the title, description, location and RSVP link become
  world-readable on the website, the public feed and the public Google
  Calendar. Invited members and meeting links are never published.
- **Public events also carry:** the RSVP link (the website's RSVP button),
  _Full_ (the website greys the event out and hides the button), _Featured_
  (the website emphasizes it), a short public note, and the stamp-card slot.
- **Host:** a member, or a guest's name for an outside speaker.
- **All-day events** are whole days in the org's timezone (Settings >
  General), everywhere: the calendar, Google, the website and the .ics feeds.
  Timed events are entered in your own timezone.
- **Invitations:** invite members to an event; they are notified, can RSVP
  from the event page, and are told when the time or place changes or the
  event is cancelled (you can switch that notice off per edit).

### 1a. Using the calendar

Four views, switched in the header and remembered in the URL, so a link to
a particular month or week is shareable.

| View                | What it is for                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Month** (default) | The term at a glance. Days that carry something take a tonal step; each event is a chip with its time, title and type.                                              |
| **Week**            | One column per day with an hour axis, for spotting clashes and gaps. It opens on the hours that have something in them rather than on midnight.                     |
| **Day**             | One day's hour column. Reached from the switcher, or from a month cell's "+N more".                                                                                 |
| **List**            | Every day in the window that has something, in order, with the type, place, your RSVP and (for admins) the Google sync state on the row. This is the planning view. |

- **Filters:** the type chips and the visibility menu narrow every view at
  once, and are part of the URL. The header says how many events the
  current window holds.
- **Reading an event:** selecting one opens a card anchored to it with the
  time, place, visibility and your RSVP, plus a solid **View event** (the
  full page) and, for whoever runs it, **Edit event**. Escape closes it.
- **Creating one:** **New event**, or the **+** on a day cell, which starts
  the event at 6pm that day. The form asks for a title, a time, a type, a
  visibility and a place; everything else is behind **More details**.
  Enter saves, Escape cancels, and moving the start moves the end with it.
- **Moving one:** drag a chip to another day in the month grid (admins, on
  a computer). The time of day and the length are kept.
- **On a phone:** the month grid fits the screen, with events as colour
  bars you tap, and the month's events follow it as a list you can read;
  the week shows one day at a time under a strip of the seven days, marked
  with a dot where something is scheduled. **New event** sits at the top
  right, beside the title; Find a time, RSVPs, Sync and Today are left to
  the menu and the arrows.
- **Colours** come from the org's theme (Settings > Theme), so each club's
  calendar matches the rest of its workspace. Colour is never the only
  cue: every event names its type, public events carry a globe, internal
  ones a dashed outline, and both are in the event's screen-reader label.

The calendar loads only the weeks on screen. Admins see a small icon on
events that are still syncing to Google or whose sync failed.

### 1b. Availability polls

**Find a time** (its own sidebar section, under Club after Polls) finds a meeting
time (when2meet-style): `/app/{slug}/calendar/find-a-time` lists the space's
availability polls, **New poll** there (or **Find a time** in the
Calendar's header) starts one, and each lives at
`/calendar/find-a-time/{pollId}`. It used to be one kind of poll on the
Polls page; `/calendar/polls/{pollId}` and `/calendar/polls/new` still
forward there, so older links and pins keep working. In Personal it is the
only kind of poll: a question needs members to vote.

- **Creating one** (any member): a title, the days to offer, the daily hours
  and the time zone those hours are in (the organization's by default; the
  form says what they are in your own zone when the two differ), the meeting
  length, how finely people mark their time, and optionally when it stops
  taking answers. The form shows how many slots that makes before you create
  it.
- **Inviting guests:** _Invite guests_ on an open poll's page (or _Copy guest
  link_ in the Find a time list) copies the link for people outside the club. They
  type a name and mark their times: no account, no sign-up and no
  onboarding. Members answer as themselves, in the app or on the link (a
  member who isn't signed in can sign in from it). The poll's in-app address
  works too: anyone who isn't a member of the club, signed in or not, is
  sent to the guest page instead of sign-in.
- **Answering** (_Your availability_): pick _Available_, _If needed_ or
  _Unavailable_, then click a time or drag a rectangle across several (mouse
  or touch; on a phone, drag the time column to scroll). Starting on a time
  you have already marked undoes it. With the keyboard, the grid is one tab
  stop: arrows move, Space marks, Shift+arrow marks as you move. Answers save
  as you go.
- **Reading it** (_Everyone_): each time shows how many people can make it,
  shaded one colour from few to many, with a corner mark where some of them
  said "if needed". Point at a time, tab to it or tap it to see who is
  available, who only if needed, who can't and who hasn't answered. Members
  are shown by name, in the app and on the guest link, and guests by the
  name they typed.
- **Times** are shown in your own time zone, which the page names, with a
  switch to the poll's.
- **Best times** lists up to five non-overlapping windows of the meeting's
  length that suit the most people. An owner or admin schedules one (or any
  time, from the _Everyone_ read-out) after a confirmation: that creates an
  internal event, invites the members who can make its start and closes the
  poll. Guests can't be invited; the confirmation says how many there are.
- The poll's creator, or an owner or admin, can delete it; an event it
  scheduled stays on the calendar.

### 1c. Question polls

**Polls > Ask a question** asks the club anything: a question and the
options people vote on. Members only: there is no guest link.

- **Creating one** (any member): the question (up to 200 characters), an
  optional description, and 2 to 20 options (up to 120 characters each, no
  two the same, ignoring case and spacing). Blank option rows are ignored;
  Enter moves to the next row or adds one, and pasting a list (one per line,
  bullets and numbers stripped) fills several rows at once. Settings:
  - _Allow more than one choice_: people tick several options instead of one.
  - _Anonymous voting_: only the counts are ever shown. Nobody, not the
    creator and not an owner or admin, can see who voted for what, and the
    setting can't be changed afterwards (see _Anonymity_ below).
  - _Members can add options_: anyone can add an option while it is open
    (the creator and admins always can).
  - _Hide results until the poll closes_: voters see only their own choice
    until then; the creator and admins see the counts all along. The number
    of people who voted is always shown.
  - _When it closes_: no end, 1 day, 3 days, 1 week, or a date and time.
- **Voting:** pick an option (or several). The vote shows at once and is
  saved a moment later; change it or **Clear my vote** any time while the
  poll is open. Each option shows its share of the voters as a bar, its count
  and, unless the poll is anonymous, the faces of who picked it (hover for
  the names). The leading option is highlighted, your own choices are marked
  _You voted_, and a closed poll marks its _Top choice_.
- **Closing:** at its closing time, or by hand: its creator or an owner/admin
  closes and reopens it from the poll's "…" menu (reopening a poll whose
  closing time has passed drops that time). A closed poll takes no votes and
  its votes can't be withdrawn, so the result stays put.
- **Options:** the creator or an owner/admin can remove an option while the
  poll is open (its votes go with it; a poll keeps at least two).
- **Deleting:** the creator or an owner/admin deletes a poll from its "…"
  menu or from the Polls list, after a confirmation. Its votes go with it.
- **Where else it shows:** the Polls page lists question polls, newest
  first, split into open and closed (Find a time lists the other kind); the Overview's _Open polls_ widget; _Pin
  something_; pins and _Recently visited_ (under the poll's question). The
  org export (Settings > Danger zone) includes `Poll`, `PollOption` and
  `PollVote`, the votes without who cast them.

**Anonymity** is enforced by the database, not just hidden in the page:

- `PollVote` RLS lets a member read another member's vote only when the poll
  is not anonymous. On an anonymous poll each member reads their own votes
  and nothing else, whatever their role.
- Everyone gets the results from `app.poll_vote_counts(pollIds)`, a
  `SECURITY DEFINER` function that returns counts per option and the number of
  voters, never who, and only for polls in the caller's own org.
- `app_user` may update only `closedAt` and `closesAt` on a poll (a column
  grant), so a poll can't be switched from anonymous to named once people
  have voted.
- The page's data is built on the server (`src/lib/polls/question-poll.ts`),
  which leaves voters out of an anonymous poll's view even if it were handed
  them, and the export drops `PollVote.userId`.

Votes are also checked by the database: as yourself, for an option of the
same poll, while it is open. The RLS cases are `P-QPOLL-01`..`06` in
`prisma/rls/phases.mjs`.

### 2. Connect Google Calendar (optional, recommended)

1. **Settings > Integrations > Google Calendar > Connect**, signed in to
   Google as the account that owns the club's public calendar (for CBC: the
   club Gmail). Only owners and admins can connect or disconnect.
2. Pick the **public calendar** (where public events go, and the only one
   the import reads). Until one is picked, or with _Don't mirror public
   events_, public events are not on Google and there is nothing to import:
   the portal never falls back to the account's primary calendar. Optionally
   pick a separate **internal calendar** for board-only events; without one,
   internal events are simply not on Google. The internal calendar can never
   be the public one.
3. Open **Calendar > Sync and website feed** and run the **import** (next
   section) once, then press **Sync now** so every upcoming public event is
   pushed to Google.

After that every save is mirrored within about a minute. **Edits made
directly in Google Calendar are overwritten by the next save in the suite**,
so tell the board to edit events in the suite only.

If Google stops accepting the connection (a password change, the access was
removed, or a consent screen still in Testing mode, where authorizations
expire after about a week), the integration shows **Needs reconnecting** and
every owner and admin gets one notification. Reconnect in Settings, then press
**Sync now** on the Sync page; nothing is lost, changes made meanwhile are
pushed then.

**Disconnect** revokes the authorization at Google. The events already on
the Google calendar stay there; reconnecting to the same calendar updates
them in place instead of duplicating them.

### 3. Import the events that are already on Google (once)

Calendar > Sync and website feed > **Import existing Google events** (the
same card is on Settings > Integrations > Google Calendar while Google is
connected):

1. **Dry run** reads the public Google calendar you picked, and no other
   (six months back to about a year ahead; with no public calendar picked
   the import is refused), and reports _N linked, M new, K ambiguous_, with sample
   titles. Nothing is written.
2. **Apply import** writes it:
   - an event the suite already has (created here, or synced from the
     website's sessions) with a clear title-and-time match is **linked**, not
     duplicated, and becomes Public (it is on the public calendar);
   - an event with no match is **created** as a Public event (type guessed
     from the title, the first link in the description becomes the RSVP
     link);
   - an event with several close matches is created and flagged as a
     **possible duplicate**; merge it in Databases > Sessions.

Running the import again changes nothing: everything is already linked.

### 4. Publish events on the website

1. **Turn the feed on:** Settings > Privacy > _Public events feed_ (an owner
   or admin). Until then the feed answers 404, exactly like an unknown club.
2. **The feed URLs** are shown on Calendar > Sync and website feed:
   - `https://<portal>/api/public/<org-slug>/events` — JSON: upcoming public
     events (plus the last day), in the website's event shape with the
     explicit type, full, featured and note fields;
   - `https://<portal>/api/public/<org-slug>/events.ics` — the same events as
     a calendar anyone can subscribe to.

   Both are read-only, need no login and set no cookies, and are cached for
   five minutes at the CDN (and served stale for up to a day if the portal
   is down). A change in the suite reaches the feed right away; the CDN copy
   within five minutes. If the org's slug is renamed, the old URL redirects.

3. **Point the website at it** (claudeneu.com; any static site can do the
   same). Set `SUITE_EVENTS_URL` to the JSON URL in **two** places:
   - **Netlify > Site configuration > Environment variables** (scope:
     Builds). Every Netlify build, whether from a push or the build hook,
     runs the site's `prebuild` event fetch; without the variable there, a
     hook-triggered build silently falls back to Google Calendar.
   - **GitHub > Settings > Secrets and variables > Actions > Variables**, for
     the hourly _Refresh events_ workflow.
4. **Rebuild the website when events change:** create a build hook in
   Netlify (Site configuration > Build & deploy > Build hooks) and save its
   URL in **Settings > Integrations > Website build hook** (it is encrypted
   and never shown again; only Netlify build-hook URLs are accepted). When a
   public event is created, edited or deleted, or an event changes
   visibility, the suite waits a minute, so a burst of edits costs one
   deploy, and then triggers the build.

**Double deploys.** The hourly GitHub workflow also refreshes events. A
hook-triggered build writes `events-hash.txt` next to the site; when the
workflow's freshly fetched events match the hash already live, it commits
with `[skip netlify]` and does not ping the hook, so the same data is not
deployed twice.

**If the suite is unreachable** when the website builds, the website falls
back to reading the public Google Calendar, and if that fails too it keeps
the events it already had. A failed fetch never empties the site.

### 5. Personal calendar feed

Each member can subscribe to their own feed of events they are invited to
(Settings > Calendar). It includes events of every org they still belong to;
leaving an org removes its events from the feed.

## Why the website reads the suite, not Google Calendar

The spec asks for this tradeoff to be explained. The two options:

**A. The website reads the suite's feed at build time (chosen), with Google
Calendar as its fallback.**

- The suite stays the single source of truth; the website shows exactly
  what the board saved.
- Explicit fields (type, full, featured, RSVP link, note) instead of
  guessing from titles and parsing links out of calendar descriptions.
- The internal/public rule lives in one place in the suite
  (`publicEventsWhere`), so a board meeting can never reach the website.
- The website does not depend on the health of the Google sync.
- The site stays fully static: no API key or runtime fetch in the browser,
  no CSP change.
- Costs: the suite must be reachable when Netlify builds (covered by the
  Google fallback and keep-existing); two settings on the website side
  (`SUITE_EVENTS_URL` in Netlify and GitHub) and a build-hook secret in the
  suite; the double-deploy handling above.

**B. The website keeps reading the public Google Calendar.**

- No website changes, and it works today.
- But the site shows whatever the Google mirror last received: a failed sync
  or an expired Google authorization leaves it silently stale. Event details
  must survive a round trip through Google's description field (the RSVP
  link on its first line), the type is guessed from the title, and a
  mistakenly mirrored internal event would go public. Freshness is the sync
  delay plus the hourly refresh.

A keeps B as its fallback, so choosing A gives up none of B's resilience.
The Google Calendar mirror still exists for people who subscribe to it, and
the website's "Add to your calendar" link can keep pointing at it.

## For the platform operator

| What                                                     | Where                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Google OAuth client for Calendar (separate from sign-in) | `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`. In Google Cloud: enable the Google Calendar API; create a _Web application_ OAuth client; add the portal's Calendar callback URL (shown in Settings > Integrations) as an authorized redirect URI.                                                                                                                           |
| Consent screen                                           | Scopes `openid`, `email`, `calendar.events.owned`, `calendar.calendarlist.readonly` (`calendar.events` only if `.owned` cannot write the chosen calendar). It needs an authorized domain, a homepage and a privacy-policy URL, and must be **published and verified**: in Testing mode authorizations expire after about seven days. The sign-in client keeps `openid email profile` only. |
| Background jobs                                          | `gcal` (mirror one event; runs right after the save), `site-rebuild` (one minute after public changes), `google-import` (heavy; kicked to `/api/cron/jobs`), `google-revoke`. All need the job drain (`/api/cron/jobs` with `CRON_SECRET`; RUNBOOK step 8).                                                                                                                                |
| Per-org secrets                                          | The Google refresh token and the Netlify hook URL are encrypted OrgSecrets (Settings > Integrations); never env vars.                                                                                                                                                                                                                                                                      |
| Public feed                                              | `/api/public/[orgSlug]/events` and `.ics` sit outside the nonce-CSP proxy and send `Cache-Control: public, s-maxage=300, stale-while-revalidate=86400`, an ETag (304s) and `Access-Control-Allow-Origin: *`. The data is an `unstable_cache` entry tagged `org:{orgId}:public-events`, invalidated after every commit that touches a public event.                                         |

## Local development

- Mirroring and rebuilds run from the job outbox: `pnpm jobs:drain --watch`
  (a `gcal` job also runs right after the save that queued it). Without real
  Google credentials the jobs fail with "not configured", and events show
  "Sync failed"; the unit tests use a mocked Google API instead.
- The seeded Claude Builders Club has the public feed turned on:

  ```sh
  curl -i http://localhost:3000/api/public/claude-builders-club/events
  curl -i http://localhost:3000/api/public/claude-builders-club/events.ics
  ```

- Point a local website build at it with
  `SUITE_EVENTS_URL=http://localhost:3000/api/public/claude-builders-club/events npm run build`.

## How the calendar views are built

The month grid, the hour columns and the agenda are this app's own
components (`src/components/calendar/`), not a calendar library. The layout
arithmetic — which day an event sits on, where it sits in an hour column,
how overlapping events share the width, which hours to open on — is pure
and lives in `src/lib/calendar/grid.ts`, with tests in `grid.test.ts`.

Two rules worth knowing when changing them:

- **Timed events are bucketed by the viewer's local day**, because their
  times are shown in the viewer's timezone. **All-day events are bucketed
  by org-timezone day keys**, resolved on the server, so an all-day event
  covers the same days for everyone. Mixing the two drifts an all-day
  event by a day for a viewer west of the club.
- **Today is rendered in the org timezone on the server** and swapped for
  the viewer's own day on hydration (`useTodayKey`), so the first paint
  cannot mismatch.

Event kind colours come from the tag palette, NOT from the org's theme:
`--tag-navy`, `--tag-plum`, `--tag-burgundy`, `--tag-rust`, `--tag-ochre`,
`--tag-forest`, `--tag-teal`, and `--muted-foreground` for _Other_. The
names live in `src/lib/tag-colors.ts`, the light and dark values in
`globals.css`, and the mapping from kind to colour in
`src/components/calendar/kinds.ts`. A club theme deliberately does not
override them: a kind is a label, and it keeps the colour it was given.
Note folders and epics take the same palette.

They were the derived chart slots until 2026-10-27. Under a monochrome
theme those are nearly grey, and under any theme they moved when the theme
moved, which is wrong for something somebody picked. Folder rows saved
before the change still hold `chart-1` … `chart-5`; `tagColorOf()` reads
those onto the nearest name, so nothing had to be migrated.

`src/lib/tag-colors.test.ts` holds the palette honest: every colour clears
4.5:1 on the page, on a card and on its own 15% tint, in both modes and
under every preset the app ships, keeps a chroma floor so no name reads as
grey, and keeps adjacent hues apart. `--chart-1..5` are untouched and
still belong to charts and meters, with their own guarantees in
`src/lib/theme/chart.ts`. Everything in the calendar still paints from
`--kind`, so a chip, a dot, a bar and a time-grid block follow one
variable.

FullCalendar is still a dependency (the task calendar uses it) but the org
calendar no longer loads it.
