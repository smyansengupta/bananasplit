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

- **Who:** owners and admins create, edit, drag, resize and delete events.
  Members see the calendar, answer invitations (RSVP) and run availability
  polls. Finalizing a poll creates an event, so an admin does it.
- **Type:** workshop, info session, hackathon, social, board meeting or
  other. The website uses the type for its colors and labels.
- **Visibility:** *Internal* (the default) or *Public*. Choosing Public shows
  a warning: the title, description, location and RSVP link become
  world-readable on the website, the public feed and the public Google
  Calendar. Invited members and meeting links are never published.
- **Public events also carry:** the RSVP link (the website's RSVP button),
  *Full* (the website greys the event out and hides the button), *Featured*
  (the website emphasizes it), a short public note, and the stamp-card slot.
- **Host:** a member, or a guest's name for an outside speaker.
- **All-day events** are whole days in the org's timezone (Settings >
  General), everywhere: the calendar, Google, the website and the .ics feeds.
  Timed events are entered in your own timezone.
- **Invitations:** invite members to an event; they are notified, can RSVP
  from the event page, and are told when the time or place changes or the
  event is cancelled (you can switch that notice off per edit).

The calendar loads only the weeks on screen, and can be filtered by type and
visibility. Admins see a small icon on events that are still syncing to
Google or whose sync failed.

### 2. Connect Google Calendar (optional, recommended)

1. **Settings > Integrations > Google Calendar > Connect**, signed in to
   Google as the account that owns the club's public calendar (for CBC: the
   club Gmail). Only owners and admins can connect or disconnect.
2. Pick the **public calendar** (where public events go). Optionally pick a
   separate **internal calendar** for board-only events; without one,
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

Calendar > Sync and website feed > **Import existing Google events**:

1. **Dry run** reads the public Google calendar (six months back to about a
   year ahead) and reports *N linked, M new, K ambiguous*, with sample
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

1. **Turn the feed on:** Settings > Privacy > *Public events feed* (an owner
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
     the hourly *Refresh events* workflow.
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

| What | Where |
|---|---|
| Google OAuth client for Calendar (separate from sign-in) | `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`. In Google Cloud: enable the Google Calendar API; create a *Web application* OAuth client; add the portal's Calendar callback URL (shown in Settings > Integrations) as an authorized redirect URI. |
| Consent screen | Scopes `openid`, `email`, `calendar.events.owned`, `calendar.calendarlist.readonly` (`calendar.events` only if `.owned` cannot write the chosen calendar). It needs an authorized domain, a homepage and a privacy-policy URL, and must be **published and verified**: in Testing mode authorizations expire after about seven days. The sign-in client keeps `openid email profile` only. |
| Background jobs | `gcal` (mirror one event; runs right after the save), `site-rebuild` (one minute after public changes), `google-import` (heavy; kicked to `/api/cron/jobs`), `google-revoke`. All need the job drain (`/api/cron/jobs` with `CRON_SECRET`; RUNBOOK step 8). |
| Per-org secrets | The Google refresh token and the Netlify hook URL are encrypted OrgSecrets (Settings > Integrations); never env vars. |
| Public feed | `/api/public/[orgSlug]/events` and `.ics` sit outside the nonce-CSP proxy and send `Cache-Control: public, s-maxage=300, stale-while-revalidate=86400`, an ETag (304s) and `Access-Control-Allow-Origin: *`. The data is an `unstable_cache` entry tagged `org:{orgId}:public-events`, invalidated after every commit that touches a public event. |

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
