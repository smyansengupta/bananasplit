# Meetings

The Meetings section, and the video-call providers behind it. The public
sign-up page keeps its own document (`docs/features/rsvp.md`): it is unchanged
and still called an RSVP page, but it is now one of three shapes a meeting can
take rather than a section of its own.

## What a meeting is

One place to set up anything that happens at a time. You pick the shape first
and the form shows only what that shape needs:

| Shape | What it is | What it needs |
|---|---|---|
| **Online** | A Google Meet, Zoom or Teams call | A real meeting at that provider, with a join link |
| **In person** | A room, an address | A place, and how to find it |
| **Event** | A talk, a social, a hackathon | Either of the above plus the public sign-up page |

A meeting can be both online and in person (hybrid) by filling in the other
half later. `Event.format` (`ONLINE | IN_PERSON | HYBRID`) is explicit rather
than derived, because an in-person meeting with no room picked yet is still in
person.

## A meeting is an Event

There is no `Meeting` model. `Event` already carries the conference provider
and link, the whole RSVP page, the Google Calendar mirror, attendees,
attendance, the ICS feed, the public feed, and the reports and databases that
read from it. A second model would have split the calendar in half and
duplicated all of it.

The **Calendar** section is unchanged: it is where you see what is happening.
**Meetings** is where you set it up. Everything made in Meetings appears on the
Calendar as it always did.

## Making the meeting real

`Event.conferenceProvider` has always said which kind of call a meeting is, but
until now it only labelled a link someone pasted. Bananasplit can now create
the meeting itself, in the account the organization connected.

### Where you connect it

**In Meetings, not in Settings.** The three providers were briefly rows on
Settings › Integrations and are deliberately not there any more: you connect
Zoom at the moment you want a Zoom link, not by going to an admin page first.
Two places, each doing the job it is actually for:

- the **bar** across the top of Meetings (`video-connections.tsx`) is where you
  connect. One button per provider, each a plain form POST that navigates, the
  same shape as the Google Calendar connect next door. No menu: this bar exists
  to be acted on once, and a dropdown would put a click in front of the only
  thing anyone comes here to do;
- the **menu in the create form** (`conference-picker.tsx`) is where you pick,
  and it is the last question the form asks. A provider nobody has connected is
  listed but **not selectable**, with a line saying where to connect it.

Connecting deliberately does NOT happen from inside the create form. Both ways
of doing it were wrong: navigating away takes the half-typed meeting with it,
and opening consent in a new tab depends on a popup, which can be blocked - a
connect button that silently does nothing is worse than one that is honestly
greyed out.

The picker's trigger uses `aria-labelledby` pointing at both the label and
itself, not `<label for>`: an explicit label *replaces* a button's accessible
name, so a screen reader would have heard "Video call" and never what was
chosen.

They are still `OrgIntegration` rows with `OrgSecret` refresh tokens, and
`providerInfo()` still answers for them (`ALL_PROVIDER_INFO` in
`src/server/integrations/catalog.ts`); they are simply not in `PROVIDERS`, which
is what the Integrations page lists.

### Whose account

The **organization's**. An owner or admin connects one Google Meet, Zoom or
Teams account, and every online meeting anyone creates is made there. Per-host accounts ("my meetings in my own Zoom") are a
later addition; the storage is keyed by org and provider, so adding them means
a second lookup, not a migration.

Each provider is its **own** `OrgIntegration` row (`GOOGLE_MEET`, `ZOOM`,
`MICROSOFT_TEAMS`). So an org can have Meet without mirroring its calendar into
Google Calendar, or Zoom with no Google account at all, and connecting one never
re-prompts for another. The refresh token is an `OrgSecret` of kind
`REFRESH_TOKEN`, encrypted at rest through `src/server/secrets`, exactly as
Google Calendar's is.

### What each provider gives us

The differences are real and the code does not pretend otherwise
(`src/server/conference/clients.ts`):

- **Google Meet** — `POST https://meet.googleapis.com/v2/spaces` makes a
  meeting *space*: a room with no start time of its own, whose link is
  permanent. So moving the meeting is a no-op at Google — our own record and
  reminders carry the time — and `remove` ends any live conference rather than
  deleting a space (Google has no delete). Scope:
  `https://www.googleapis.com/auth/meetings.space.created`.
- **Zoom** — `POST /v2/users/me/meetings` makes a scheduled meeting with a
  start, a duration, a passcode, dial-in numbers and a separate host
  `start_url`. `me` is the account that granted the token. Zoom's `PATCH`
  answers 204, so an update reads the meeting back for the current links.
- **Teams** — `POST /v1.0/me/onlineMeetings` on Microsoft Graph, with a start
  and an end. Scope: `OnlineMeetings.ReadWrite`.

### Platform credentials

One OAuth client per provider, from the environment:

| Provider | Env | Where the app is made |
|---|---|---|
| Google Meet | `GOOGLE_MEET_CLIENT_ID` / `_SECRET` | Google Cloud console |
| Zoom | `ZOOM_CLIENT_ID` / `_SECRET` | Zoom Marketplace |
| Teams | `MICROSOFT_TEAMS_CLIENT_ID` / `_SECRET`, optional `MICROSOFT_TEAMS_TENANT` | Azure portal |

A provider with no credentials is "not configured": it still appears in
Integrations, and its Connect button explains what the platform is missing and
links to the console. Nothing throws until someone tries to connect. So Zoom
and Teams can ship dark and light up when the credentials land.

### Connecting

`src/server/conference/oauth.ts`, modelled on the Google Calendar flow in
`src/server/integrations/google.ts` and generalised so the security properties
are written once:

- **start** (`POST /api/integrations/conference/{slug}/start`) — OWNER/ADMIN
  only, same-origin, rate limited. A PKCE verifier and a nonce go into a
  signed httpOnly cookie scoped to that provider's callback path; the state is
  `HMAC(provider, orgId, userId, nonce, exp)` with a ten-minute life.
- **callback** (`GET .../callback`) — re-checks the signed state, the cookie's
  nonce (single use), that the session user is the one who started it and is
  still OWNER/ADMIN, then exchanges the code and checks the granted scopes.

The **provider is part of what is signed**, so a state or cookie issued for
Zoom cannot be replayed at the Teams callback. A grant that comes back short of
a scope we need is revoked again rather than stored: a half-working connection
is worse than none, because every meeting under it would fail one at a time.

### Trusting what comes back

Everything a provider's API returns is untrusted. A join URL is stored only if
it is `https` on a host that provider owns (`isAllowedJoinUrl`), so a
compromised or misbehaving API cannot turn a meeting link into a redirect
somewhere else. The host test is a full-label match or a parent-domain suffix,
so `notzoom.us` and `meet.google.com.evil.test` are both rejected.

### The conference-sync job

Creating the meeting is a **job**, not part of the save: a provider being slow
or down must never cost someone the meeting they just typed in. The event saves
at once, the link arrives a second or two later, and a failure is a state on the
row (`conferenceSyncState` `FAILED` plus a sanitized reason) rather than an
error where the person was typing.

Same contract as the Google mirror next door: short transactions to read a
snapshot and to write the result, the network call in between with no
transaction open, and a compare-and-set on `syncVersion` so a save that lands
mid-flight wins and leaves the row `PENDING` for the job that save queued.

`conferenceManaged` is the line we do not cross: we only move or cancel a
meeting **we** made. A link someone pasted by hand is never touched.

Two columns, not one, because they answer different questions:
`conferenceProvider` is what is **wanted now**, and `conferenceManagedAt` is
**where the meeting actually lives**. They differ for exactly as long as a
teardown takes. Turning the call off, or switching from Zoom to Meet, changes
the want first; the Zoom meeting is still out there and has to be called off.
A switch cancels at the old provider on one run and queues itself again, so
the next run creates at the new one. Without that split, turning a meeting
in person left a row the database rightly refused (`conferenceManaged` with no
provider), and switching would have sent a Zoom id to Google.

`Event.format` is **derived on every save** from the provider and the place
(`formatOf` in the event service), never set by hand. It was briefly a column
nothing wrote, which meant every event stayed `IN_PERSON` and the sync job
decided there was nothing to do - the whole feature was a silent no-op.

Saving a meeting with a provider and **no link** is the normal case, not an
error: it means "make it for me". Only `OTHER` still demands a pasted link,
because there is nothing for us to call.

Failure handling:

- `invalid_grant` or a 401 → the connection goes `NEEDS_REAUTH`, owners and
  admins get one notice per failure streak, and the job stops (retrying cannot
  help until someone reconnects, and reconnecting queues the work again).
- Not configured → `DEAD` at once.
- A 404 on an update or cancel → the meeting is already gone; clear our copy.
- 408, 429 and 5xx → retry with the queue's backoff.

## Reminders

`EventReminderSend` replaces the two reminder columns that used to sit on
`EventRegistration`. Those meant exactly two reminders (a day and an hour) and
only for public sign-ups. Now:

- a meeting sets its own offsets (`Event.reminderMinutes`, minutes before the
  start, largest first; the org default is `OrgSettings.meetingReminderMinutes`,
  a day and an hour);
- **members** are reminded too (`EventAttendee`), not only public sign-ups;
- one row per reminder actually sent, and the unique index is the idempotency
  guard, so a retried job can never send the same reminder twice.

The guard needs two **partial** unique indexes rather than one over all five
columns: under Postgres's default `NULLS DISTINCT`, a row with a null
`userId` is distinct from itself, so a single index would not have stopped a
double send.

Online meetings put the join link in the reminder.

## Files

| Path | What |
|---|---|
| `src/server/conference/providers.ts` | The three providers in one table: endpoints, scopes, env, allowed join hosts |
| `src/server/conference/oauth.ts` | PKCE, signed state and cookie, code exchange, refresh, revoke |
| `src/server/conference/token.ts` | Access-token cache and refresh, per org and provider |
| `src/server/conference/clients.ts` | The three APIs behind one interface |
| `src/server/conference/sync.ts` | The `conference-sync` job |
| `src/server/conference/connect.ts` | The callback's checks, route-independent so it is testable |
| `src/server/conference/reauth.ts` | `NEEDS_REAUTH` plus one alert per streak |
| `src/app/api/integrations/conference/[provider]/` | `start` and `callback` |
| `src/server/conference/connections.ts` | What Meetings needs to draw a provider row (never a secret) |
| `src/components/meetings/video-connections.tsx` | The Video calls card at the top of Meetings |
| `src/components/meetings/conference-picker.tsx` | Picking (or connecting) a provider while making a meeting |
| `src/components/meeting-logos.tsx` | The providers' own marks |
| `src/app/app/[orgSlug]/meetings/` | The section itself |

## Database

Migration `20261024120000_meetings`.

- `Event` gains `format`, `conferenceManaged`, `conferenceMeetingId`,
  `conferenceHostUrl`, `conferencePasscode`, `conferenceDialIn`, the four
  `conferenceSync*` columns and `reminderMinutes`. Existing rows are backfilled
  from `conferenceProvider` and `location`: a link and a place was already
  hybrid in everything but name.
- `EventReminderSend` — RLS: owners and admins read it, only the service path
  writes it (it carries guests' identities by reference, so it follows
  `EventRegistration`).
- `UpNextDismissal` — a card a member hid from their own Overview. Own row
  only, not even an admin reads it; no `UPDATE` (hiding is an insert,
  un-hiding a delete).
- `app.reminder_offsets_ok(integer[])` — the offsets check. It is an
  `IMMUTABLE` function because a `CHECK` constraint cannot hold a subquery and
  testing an array needs `unnest`.
- Exported: `EventReminderSend` with the rest of the event data.
  `UpNextDismissal` is excluded as a personal preference, like `Notification`.

## The section

`RSVPs` became `meetings` in `src/lib/nav/sidebar.ts`. A saved sidebar naming
the old id still means the new section (`RENAMED_FROM`), so a club that hid
RSVPs still has Meetings hidden, in the group they put it in and under the name
they gave it. `/app/{slug}/calendar/rsvp` redirects to `/app/{slug}/meetings`,
and the old path stays in the section's `also` list so a pasted link still
lights up the right sidebar row.

Sign-up management lives under the meeting: `/app/{slug}/meetings/{id}/rsvp`
(the guest list and page settings) and `.../rsvp/door` (door mode, the one
route that may use the camera). The old `/calendar/{id}/rsvp` and
`/calendar/{id}/rsvp/door` forward there. They carry `?new=1` and nothing else,
and check no permission themselves: the new page sends anyone without
`events.write` to the meeting.

The list is not a second calendar. The Calendar is a grid you read by date;
this is the list you work from: the join link one click away, the head count on
whatever is taking sign-ups, and the connections at the top. Hosts see
everything; everyone else sees what they can act on - something to join, or a
page open for sign-ups.
