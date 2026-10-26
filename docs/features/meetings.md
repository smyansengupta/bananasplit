# Meetings

The Meetings section, and the video-call providers behind it. The public
sign-up page keeps its own document (`docs/features/rsvp.md`): it is still
called an RSVP page, but it is now one of three shapes a meeting can take
rather than a section of its own, and its reminders are the meeting's
reminders (see Reminders below).

## What a meeting is

One place to set up anything that happens at a time. You pick the shape first
and the form shows only what that shape needs:

| Shape | What it is | What it needs |
|---|---|---|
| **Online** | A Google Meet, Zoom or Teams call | A real meeting at that provider, with a join link |
| **In person** | A room, an address | A place, and how to find it |
| **Event** | A talk, a social, a hackathon | Either of the above plus the public sign-up page |

A meeting can be both online and in person (hybrid) by filling in the other
half later. `Event.format` (`ONLINE | IN_PERSON | HYBRID`) is a stored column
rather than something worked out each time it is read, so the list and the sync
job can filter on it, and an in-person meeting with no room picked yet is still
in person. Its value follows from the provider and the place on every save (see
the conference-sync job).

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
  connect, and where you disconnect. One button per provider, each a plain form
  POST that navigates, the same shape as the Google Calendar connect next door.
  No menu: this bar exists to be acted on once, and a dropdown would put a
  click in front of the only thing anyone comes here to do. A provider that is
  connected says which account ("Connected as ...") and has a Disconnect
  button beside it (see Disconnecting);
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

A provider with no credentials is "not configured". It is not offered on the
Meetings bar, because an organization's admin cannot fix it: it is set up once,
for everyone, by whoever runs Bananasplit. With none set up, the bar says
Google Meet, Zoom and Teams are not switched on yet (and that a link can still
be pasted); to the people in `PLATFORM_ADMIN_EMAILS` it says which variables
are missing, and `docs/setup/meeting-providers.md` has the steps. A connection
an organization already holds, even one that needs reconnecting, always keeps
its row so it can be disconnected. Nothing throws until someone tries to
connect, and the start route then answers "not set up on this platform yet". So
Zoom and Teams can ship dark and light up when the credentials land.

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

### Reconnecting picks up waiting meetings

Three kinds of meeting wait for a provider. One was saved before the provider
was connected: the save path only queues the sync job for a provider that is
connected, so with nothing else to wake it the meeting would stay without a
link for good. Another was left `FAILED` by a connection that expired: the
job stopped, saying that reconnecting would queue the work again, so
connecting has to. The third is a meeting we made at that provider whose
cancellation `FAILED` while it was disconnected: the event was deleted or
merged away, became in person, or moved to another provider. Disconnect
promises that changes reach the provider once it is connected again, and for
these the change is calling our meeting off.

`completeConferenceConnect` (`src/server/conference/connect.ts`) calls
`requeueWaitingMeetings` (`src/server/conference/requeue.ts`) as soon as the
new connection is stored. It queues a meeting only if the sync job could act
on it, and only one that has not ended yet:

- waiting for a link: it is live (not deleted, not merged away), not in
  person, its provider is the one just connected, and it is `FAILED` or has no
  link of any kind. A pasted link is never ours to replace, the same rule the
  job applies, so it is left alone;
- a failed cancellation: we made it (`conferenceManaged`) at the provider just
  connected (`conferenceManagedAt`) and it is `FAILED`, whatever the event
  wants now. The job reads `conferenceManagedAt` to know where to cancel.

The rows are set `PENDING` with raw SQL, as the save does, so `updatedAt`
stays where it was and the meeting does not jump up "recently changed" lists.
The jobs are queued in the same transaction, so a row is never `PENDING` with
no job to resolve it. A run queues at most 500 (`REQUEUE_LIMIT`), soonest
first, so a cut-off drops the ones furthest away.

It is best effort. The connection is already stored by then, so a failed
requeue is logged and the person still lands back on Meetings with
"Connected". The words that used to send people to Settings agree with this:
the reconnect notice and the job's own reason say "reconnect it from Meetings",
and the notice links to Meetings.

### Disconnecting

Each connected provider has a **Disconnect** button on the Meetings bar. It is
for owners and admins (`integrations.write`, the right Connect needs), and it
asks first, because what it costs is not obvious: meetings already made keep
their links, but changing or cancelling them will not reach the provider until
someone connects again. A connection that needs reconnecting keeps its row, so
it can be disconnected too.

`disconnectMeetingProviderAction` (`src/app/app/[orgSlug]/meetings/actions.ts`)
calls `disconnectMeetingProvider` (`src/server/conference/disconnect.ts`). It
takes the shape of the Google Calendar disconnect, without its revoke job:

1. **Revoke** the grant at the provider, best effort, with no transaction open
   and a ten second limit. It is inline, with nothing queued to try again: a
   provider that is down is the admin's cue to remove Bananasplit from that
   account's connected apps, which is what the message tells them.
2. **Mark it disconnected** in one transaction: status `DISCONNECTED`,
   `config.disconnectedAt`, and an `integration.disconnected` audit row (the
   provider, and whether the revoke worked; never a token). This is what stops
   new meetings: the sync job will not create or move one through a provider
   that is not `CONNECTED`.
3. **Forget** the cached access token.
4. **Delete the stored refresh token** only if it was revoked and the person
   may remove secrets, which is an owner. An admin's disconnect leaves a
   revoked, now useless token encrypted until an owner removes it. A token
   that was **not** revoked is never deleted: deleting it would strand a live
   grant that nobody here can revoke any more. An owner's deletion goes through
   `removeSecret`, so it also writes an `integration.secret_removed` audit row
   and alerts the organization's owners, as any removed secret does.

**Teams has no revoke endpoint.** Its connection has nothing to ask, so it
counts as revoked for step 4 and an owner's disconnect deletes the token, but
its message says so plainly: remove Bananasplit from that Microsoft account's
connected apps to revoke access too. Its audit row records
`revokedInline: false`, because nothing was revoked. A Meet or Zoom revoke
that failed still disconnects; the message says what is left to do. The result
is a sentence and never carries a token.

Nothing here touches an event.

### Rotated refresh tokens

A refresh can hand back a new refresh token. Zoom does it on every refresh and
retires the old one, and Microsoft recommends replacing it. A connection that
kept the first token would work once and then fail every time after, so the
new one is stored (`src/server/conference/token.ts`) with `rotateSecret`
(`src/server/secrets/index.ts`):

- it is a compare-and-set against the token we used, under a row lock on the
  `OrgIntegration`, and answers whether it stored. A refresh that lost a race
  never overwrites a newer token, and a reconnect in the middle wins;
- it writes no audit row and alerts no owner, and leaves the status and
  `lastError` alone. This is the provider's routine rotation, not a person
  changing a credential, and `setSecret`'s "was replaced" alert would page
  every owner on every refresh;
- `removeSecret` takes the same lock first (the integration row, then the
  secret), because delete-then-lock would deadlock with a refresh keeping a
  rotated token.

Two refreshes racing one rotating token is the failure this guards against:
the loser presents a token the winner has already retired, gets
`invalid_grant`, and would wrongly send the connection to `NEEDS_REAUTH` while
a valid token sits in the store.

- In one process, callers share a single refresh (keyed by organization,
  provider and a fingerprint of the token). It carries no caller's abort
  signal, so one caller giving up fails only that caller, and a refresh under
  way still stores what the provider rotated.
- Across processes, on `invalid_grant` the stored token is read again. If it
  changed, the refresh is retried once with it, through the same cache and
  single refresh as a caller here that read the newer token itself, so the
  retry and that caller never refresh it twice (the provider would honour one
  and refuse the other). If it did not, the winner may
  not have committed yet, so it waits `ROTATION_SETTLE_MS` (one second) and
  reads once more. Only a token that is still unchanged becomes a real
  `NEEDS_REAUTH`: the grant is gone.
- If storing the rotated token fails, the access token stays cached under the
  token the store still holds, for its lifetime, rather than forcing another
  refresh with a token the provider may already have retired.

The retry is bounded to one, so a pile-up of refreshes across servers can still
end in `NEEDS_REAUTH`. Reconnecting puts that right.

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
meeting **we** made. A link someone pasted by hand is never touched. That
includes a link pasted in place of a meeting we made: editing a Zoom meeting
we made to "A link I'll paste" cancels the Zoom meeting, and the cancellation
clears only our meeting's own fields (`clearedFields` keeps the URL when the
provider is now `OTHER`), so the pasted link stays.

Two columns, not one, because they answer different questions:
`conferenceProvider` is what is **wanted now**, and `conferenceManagedAt` is
**where the meeting actually lives**. They differ for exactly as long as a
teardown takes. Turning the call off, or switching from Zoom to Meet, changes
the want first; the Zoom meeting is still out there and has to be called off.
A switch cancels at the old provider on one run and queues itself again, in
the same transaction that clears our copy and leaves the row `PENDING`
(`commitAndRecreate`), so the next run creates at the new one. Without that
split, turning a meeting in person left a row the database rightly refused
(`conferenceManaged` with no provider), and switching would have sent a Zoom
id to Google.

`Event.format` is **derived on every save** from the provider and the place
(`formatOf` in the event service), never set by hand. It was briefly a column
nothing wrote, which meant every event stayed `IN_PERSON` and the sync job
decided there was nothing to do - the whole feature was a silent no-op.

Saving a meeting with a provider and **no link** is the normal case, not an
error: it means "make it for me". Only `OTHER` still demands a pasted link,
because there is nothing for us to call. The calendar actions
(`conferenceUrlError`, `src/lib/calendar/event-input.ts`) and the event
service (`checkShape`) both hold to this. A link that is there for Meet, Zoom
or Teams (one we made, or one pasted before we could make them) must be https
on a host that provider owns, checked with the same `isAllowedJoinUrl` and
host list as the provider's own answers, so the action and the stored-link
rule cannot drift apart (`teams.live.com` passes for Teams). The picker drops
the link whenever the provider changes, ours or a pasted one, so a Zoom link
never rides into a save for Meet, and a link pasted over a meeting we made is
the only link in that save.

Failure handling:

- `invalid_grant` or a 401 → the connection goes `NEEDS_REAUTH`, owners and
  admins get one notice per failure streak, and the job stops (retrying cannot
  help until someone reconnects, and reconnecting queues the work again; see
  Reconnecting picks up waiting meetings). `invalid_grant` is only believed
  after the rotated-token re-read above.
- A provider that is not `CONNECTED` when the job runs to create or move a
  meeting (`NEEDS_REAUTH`, `DISCONNECTED`, never connected) → the row goes
  `FAILED` with "needs to be reconnected from Meetings" or "is not connected
  for this organization", and the job is `DEAD` rather than burning its
  retries.
- Not configured → `DEAD` at once.
- A 404 on a cancel → the meeting is already gone, which is what was wanted;
  clear our copy.
- A 404 on an update (its host deleted it at the provider, or the connection
  now belongs to another account) → the event still wants a call, so forget
  the dead meeting, leave the row `PENDING` and queue a create, as a switch
  does. The next run makes a new meeting, rather than leaving one with no link
  and nothing to try again.
- 408, 429 and 5xx → retry with the queue's backoff.

## The create flow

There is one create form, `EventFormDialog`
(`src/components/calendar/event-form-dialog.tsx`), and every way of making a
meeting opens it: **New meeting** on Meetings, the Calendar's **New event**,
and the **+** menu. The Calendar and Meetings differ only in what the form
says and where you land afterwards.

**The shape is the first question.** In create mode the form opens with three
cards, a radio group that takes the arrow keys (`ShapePicker`): Online, In
person, Event. It sits at the top of the dialog rather than on a screen of its
own, so typing a title and pressing Enter stays quick and there is still one
flow. A form opened without a hint starts on In person. Editing has no shape:
it asks every question, which is how a meeting gains a call or a place later.

**Each shape asks only what it needs** (`shapeFields` in
`src/lib/meetings/shape.ts`):

| Shape | Asks for | Also |
|---|---|---|
| Online | The video call | |
| In person | The place, and how to find it | |
| Event | The place, how to find it, and the video call | Turns the public sign-up page on when it is saved |

Switching shape keeps what was typed while the form is open, so switching back
finds it, but **Save sends only the answers the chosen shape asks**. Online to
In person never saves a provider, and In person to Online never saves a
location. Without that, a call picked and then abandoned would have been
created at the provider.

**Online starts on a connected provider.** Choosing Online, with no call yet
chosen, picks the first provider the organization has connected, in the order
Meetings lists them (`firstConnectedProvider`; one that needs reconnecting does
not count). If the form opened on Online, it does this once the connections
arrive. It does it only that once: a call taken off, or a provider connected in
another tab, is left alone afterwards. With nothing connected, or with "No
video call" chosen, Save will not go ahead: "Choose a video call or paste a
link, or pick In person." A meeting with no call and no place would be stored
as In person and say nothing about where it happens. The message goes as soon
as a call is chosen (by hand, or by the connections arriving after Save was
pressed) or the shape changes.

**How to find it** is `Event.locationDetails` ("Second floor, past the
elevators"), asked under Location by the shapes that ask for a place. The
meeting's page shows it, and so do the sign-up page and its emails.

**Event goes on to its sign-up settings.** After the save the page is turned
on and you land on `/app/{slug}/meetings/{id}/rsvp?new=1`. If turning it on
fails, you land on the same screen without `?new=1`, which offers it again.
The other shapes go where the page that opened the form says: Meetings goes to
the new meeting's own page (`afterCreate`), and the Calendar stays and
refreshes.

**Reminders** are under More details, starting from the organization's default
(see Reminders). A meeting whose own differ opens that section by itself.

**Where the form opens from.**

- Meetings' header has **New meeting**, and an empty Meetings page repeats it
  quietly (`new-meeting-button.tsx`). The dialog there says "New meeting" and
  "Create meeting". The Calendar keeps "New event" and "Create event", and
  editing says "Edit event" in both, because the wording change is for the
  Meetings section only.
- `?new=1` opens the form on arrival with nothing preset, and
  `?new=online|in-person|event` opens it on that shape. The old `?new=rsvp`
  still means Event. The **+** menu's New meeting is `?new=1` on Meetings,
  offered when Meetings is in the sidebar and the person can create events;
  its New event is the same `?new=1` on the Calendar. Both pages read the same
  values (`newMeetingAsk`), so a link means the same in either.
- The parameter is dropped once it has opened the form, keeping the rest of the
  query (a connect notice), so a reload or Back does not open another.

**Adding a call or a sign-up page later** (spec D5): on the meeting's page, an
in-person meeting has **Add a video call** for people who can edit it, which
opens the edit form, and a meeting with no sign-up page has **Add a sign-up
page**, which goes to the sign-up settings where the page is turned on.

## The meeting's page

`/app/{slug}/meetings/{id}` (`src/app/app/[orgSlug]/meetings/[id]/page.tsx`).
It is the Calendar's event page shown under Meetings: the same loading and the
same `EventDetailView`, given `section="meetings"`. That one prop sends the back
link and Delete to Meetings instead of the Calendar and adds the Reminders
card. Every card on the Meetings list opens it.

- **Join details** (`meeting-join-card.tsx`) replace the plain Join button when
  the meeting has a provider: the provider's name, **Join meeting**, **Copy
  link**, the passcode (with a copy button) and the dial-in numbers
  (`parseDialIn` reads `Event.conferenceDialIn` defensively: it is JSON in
  whatever shape the provider answered, and a bad value is an empty list, not a
  broken page). With nothing yet it says "No join link yet."
- **The state of the call** (`conferenceStatus`,
  `src/lib/meetings/conference-status.ts`) is ready, pending, failed, or
  nothing to say. While the sync job is making it the card says "Getting the
  Zoom link..." with a spinner, and refreshes the page every 2.5 seconds for
  up to 30 (`PENDING_REFRESH_MS`, `PENDING_REFRESH_FOR_MS`), so a meeting made
  a moment ago shows its link without a reload. It stops as soon as the state
  changes or the page is left; one still pending after half a minute is
  retrying, and shows its link on the next visit. If the job gave up it says
  "Couldn't make the Zoom meeting.", and people who can edit also get the
  stored, already sanitized reason and **Try again**. A pasted link is always
  ready, whatever the sync state says: the job never touches one, so a
  `PENDING` or `FAILED` left from before the paste would offer to retry
  something we will not do.
- **Try again** is `retryConferenceSync`
  (`src/app/app/[orgSlug]/meetings/actions.ts`), for people with
  `events.write`. It marks the row `PENDING` and queues the same
  `conference-sync` job a save does, so the job's own rules still decide what
  happens. It refuses a meeting the job could not make anything for (in
  person, a pasted link, `OTHER`) with "This meeting has no video call to
  make."
- **Where** shows the place, **How to find it** (`locationDetails`) and **Open
  in Maps**, a Google Maps search for the location text.
- **Reminders** is a card of its own: the meeting's times, or "No reminders".
  Editors can change them there with the same picker the form has; saving
  sends only the reminders, so nothing else about the meeting is touched.
- **Sign-ups** are managed from the meeting; the screens are described under
  The section.

**The host link.** `conferenceHostUrl` (Zoom's `start_url`) starts the meeting
as its host. The page reads it for everyone, because the event is read whole,
and passes it on only to someone with `events.write`: it is `null` in everyone
else's props, so it is not in the page they are sent. **Start as host** is the
only thing that uses it, and it is never printed or put in a toast. It is also
never on the Meetings list (the list does not select it), never in a reminder,
a notification or an email (the reminder fanout does not select it), and never
on the public sign-up page.

## Reminders

One system reminds members and public guests: the RSVP fanout, generalised
(spec E5), not a second one beside it.

**Offsets.** A meeting says when it reminds people as a list of minutes before
its start: `Event.reminderMinutes`, largest first. The organization's default
is `OrgSettings.meetingReminderMinutes`, which is a day and an hour (1440 and
60) until an admin changes it. A new meeting copies the default when it is
created; changing the default later changes only meetings made after, and a
meeting keeps the reminders it was made with.

A list is valid when it has at most 8 times, each from 1 to 40320 minutes (four
weeks), with no repeats. The database enforces it (`app.reminder_offsets_ok`,
a `CHECK` on both columns) and `reminderOffsetsSchema`
(`src/lib/meetings/reminders.ts`) says the same as a sentence a person can
act on. An empty list is valid and means no reminders.

**Choosing them**, in three places that share one picker (`reminder-picker.tsx`:
a toggle for each of a week, two days, a day, two hours, an hour, 30 minutes
and 10 minutes before; any other time already on a meeting is shown, and can be
turned off):

- the create and edit form, under More details;
- the meeting's page, in its Reminders card;
- **Settings > General > Meeting reminders**, for the default
  (`updateMeetingReminderDefault`, admins and up, audited as
  `settings.meeting_reminders_changed`).

**Queuing.** `scheduleEventReminders` (`src/server/rsvp/service.ts`) queues one
`rsvp-fanout` job per offset, to run at the start minus that offset, keyed
`{eventId}:r{offset}:{startMinute}`. The key carries the start, so scheduling
again for a start that already has its jobs merges into them, and any caller
can call it whenever who or when might have changed. It runs when:

- a meeting is created from the suite (not one brought in by the Google import
  or the website sync, which were not made to remind anyone);
- a save moves the meeting, flips it to or from all-day, or changes its
  offsets;
- someone is added to the invited list (an event that came in from the import
  may have none queued yet);
- a sign-up page is turned on.

A reminder whose moment has already passed is skipped: someone added that late
has just had their invitation or confirmation. An all-day event skips offsets
under a day, because an hour before its midnight start is 11 PM the evening
before.

**Sending.** The fanout (`rsvpFanoutJob`, `src/server/rsvp/jobs.ts`) first asks
whether the reminder still applies: the meeting is not deleted or merged away,
its start is the one this job was queued for, it has not started, it is not an
all-day event with an offset under a day, and the offset is still on the
meeting's list. If not, it sends nothing. That is how a move, a cancellation
and a reminder taken off the list all cancel what is already queued, with
nothing to dequeue. Then:

- **Guests**, the sign-ups that are going (when the page is on): one
  `rsvp-email` each, queued in bulk. The email job checks the same things
  again, claims the send, sends the email, and sends a text with it when
  `SMS_DELIVERY` is live (best effort: a failed text never resends the email).
  A failed email releases the claim so the retry can send.
- **Members**, the invited people who have not declined and are still members
  (an invitation outlives a membership): an in-app `EVENT_REMINDER`
  notification, claimed in the same transaction. Its title says how far off it
  is ("Weekly sync starts in an hour", "Weekly sync is tomorrow"), and its body
  has when and where (`memberReminder`). It links to the meeting's page. As with
  every notification, an email copy goes through the `notify-email` job: it
  follows the member's own setting ("A reminder before a meeting I'm going
  to") and comes from the organization's own sender, or else from the platform
  sender ("<Organization> via Bananasplit").

Online and hybrid meetings put the **join link** in the reminder, for members
and guests. The host link is in neither, and the fanout does not even select it.

**Once per person per offset.** `EventReminderSend` is a log with one row per
recipient, offset and channel (`email` for a guest, `app` for a member). Its
unique index on `(eventId, offsetMinutes, channel, recipientKey)` is the guard:
the send is claimed before it goes out, and a row already there means it went.
The recipient is one non-null value, `u:{userId}` or `g:{registrationId}`,
rather than the two nullable columns: under Postgres's default `NULLS DISTINCT`
a row with a null `userId` is distinct from itself, so an index over the
nullable pair would not have stopped a double send.

**A meeting that moves.** The old time's queued fanout finds the start changed
and sends nothing; the save has queued new ones for the new start. Before a new
fanout sends, it deletes the log rows for its offset that were written before
its own moment (the start minus the offset, less a minute for clock skew).
Those were for the earlier start, so everyone is reminded again for the new
time, once. It does this in the fanout, on the service path, and not in the
save, because the signed-in user's role can only read `EventReminderSend`.

**The old columns.** `EventRegistration.reminderDaySentAt` and
`reminderHourSentAt` are no longer read or written. They are still in the table
because the previous deploy is still serving while this one rolls out, and
dropping them under it would break it. A later migration drops them. Jobs
queued before offsets existed (a `day` or `hour` fanout, a `reminder-day` or
`reminder-hour` email) are still accepted and read as a reminder at 1440 or 60
minutes; nothing queues them any more.

Reminders go out when the job queue drains: every 15 minutes with the Jobs
pinger, or `*/5` on Vercel Pro (`RUNBOOK.md`, Background jobs). With only the
daily backstop cron they arrive late.

## Files

| Path | What |
|---|---|
| `src/server/conference/providers.ts` | The three providers in one table: endpoints, scopes, env, allowed join hosts |
| `src/server/conference/oauth.ts` | PKCE, signed state and cookie, code exchange, refresh, revoke |
| `src/server/conference/token.ts` | Access-token cache and refresh, per org and provider, and keeping a rotated refresh token |
| `src/server/secrets/index.ts` | `rotateSecret`, the compare-and-set that stores a rotated token, beside `setSecret` and `removeSecret` |
| `src/server/conference/clients.ts` | The three APIs behind one interface |
| `src/server/conference/sync.ts` | The `conference-sync` job |
| `src/server/conference/connect.ts` | The callback's checks, route-independent so it is testable |
| `src/server/conference/requeue.ts` | `requeueWaitingMeetings`: queues the meetings waiting for a provider once it is connected |
| `src/server/conference/disconnect.ts` | `disconnectMeetingProvider`: revoke, mark disconnected, delete the token if it may |
| `src/server/conference/reauth.ts` | `NEEDS_REAUTH` plus one alert per streak |
| `src/app/api/integrations/conference/[provider]/` | `start` and `callback` |
| `src/server/conference/connections.ts` | What Meetings needs to draw a provider row (never a secret) |
| `src/components/meetings/video-connections.tsx` | The Video calls card at the top of Meetings: Connect, "Connected as", Disconnect |
| `src/components/meetings/conference-picker.tsx` | Picking a provider while making a meeting |
| `src/components/meeting-logos.tsx` | The providers' own marks |
| `src/app/app/[orgSlug]/meetings/` | The section itself: the list, its actions (connections, Disconnect, Try again) |
| `src/app/app/[orgSlug]/meetings/[id]/` | The meeting's page, with `rsvp/` and `rsvp/door/` (sign-up management) under it |
| `src/components/meetings/meeting-card.tsx` | One meeting on the list |
| `src/components/meetings/copy-link-button.tsx` | Copy link on a card |
| `src/components/meetings/meeting-join-card.tsx` | Join details on the meeting's page |
| `src/components/meetings/new-meeting-button.tsx` | New meeting, opening the create form in place |
| `src/components/meetings/reminder-picker.tsx` | Choosing reminder times (form, meeting page, Settings) |
| `src/components/calendar/event-form-dialog.tsx` | The one create and edit form, with the shape picker |
| `src/components/calendar/event-detail-view.tsx` | The event page; `section="meetings"` makes it the meeting's page |
| `src/lib/meetings/shape.ts` | The three shapes, the questions each asks, the `?new=` values, `FORMAT_LABEL` |
| `src/lib/meetings/reminders.ts` | Reminder offsets: the limits, the validation and the wording |
| `src/lib/meetings/conference-status.ts` | A meeting's call as its page and card say it |
| `src/lib/meetings/connected-provider.ts` | Which provider a new online meeting starts on |
| `src/lib/meetings/dial-in.ts` | Reading `conferenceDialIn` without trusting it |
| `src/server/rsvp/service.ts` | `scheduleEventReminders` |
| `src/server/rsvp/jobs.ts` | The reminder fanout and email jobs, and member reminders |
| `src/app/app/[orgSlug]/settings/general/` | The organization's default reminders (Meeting reminders) |
| `e2e/meetings.spec.ts` | The three ways to start a meeting, and who sees the join link; how to run it is at the top of the file |

## Database

Migrations `20261024120000_meetings` and `20261026120000_event_reminders`.

- `Event` gains `format`, `conferenceManaged`, `conferenceMeetingId`,
  `conferenceHostUrl`, `conferencePasscode`, `conferenceDialIn`, the four
  `conferenceSync*` columns and `reminderMinutes`. Existing rows are backfilled
  from `conferenceProvider` and `location`: a link and a place was already
  hybrid in everything but name.
- `OrgSettings.meetingReminderMinutes` — the organization's default reminders,
  `[1440, 60]`.
- `EventReminderSend` — RLS: owners and admins read it, only the service path
  writes or deletes it (it carries guests' identities by reference, so it
  follows `EventRegistration`).
- `NotificationType.EVENT_REMINDER` — a member's reminder
  (`20261026120000_event_reminders`, the one change that migration makes).
- `EventRegistration.reminderDaySentAt` and `reminderHourSentAt` are unused and
  still there, to be dropped in a later migration (see Reminders).
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
`events.write` to the meeting. Two things follow the move: the camera exemption
for door mode (`DOOR_MODE_SOURCES` in `src/lib/security/csp.ts`; every other
page keeps `camera=()`) names the new path, and the pins resolver
(`src/lib/pins/pages.ts`) describes a meeting, its sign-ups and door mode, so
they can be pinned and show under Recently visited. Pins saved at the old
Calendar path are still described.

The list is not a second calendar. The Calendar is a grid you read by date;
this is the list you work from: the join link one click away, the head count on
whatever is taking sign-ups, and the connections at the top. Hosts see
everything, split into Coming up and Past; everyone else sees what they can act
on - something still to come that has a link to join or a page open for
sign-ups.

Each meeting is a card (`meeting-card.tsx`): its cover and date, its title, when
it is, its format (Online, In person or Hybrid, `FORMAT_LABEL`), whether
sign-ups are on, off or not set up, and where it is. For an online meeting it
names the call, and while the link is being made, or if it could not be, says
so on the card. For hosts the right-hand side is the head count; for everyone
else it is their own sign-up.

The title is the one link to the meeting's page, stretched over the whole card
so the card still clicks through. **Join** and **Copy link** sit above it as its
siblings, because a link or button inside a link is invalid and unreliable for
keyboards and screen readers; each is named for its meeting ("Join Weekly
sync"), so a list of them does not read "Join, Copy link, Join, Copy link". A
past meeting shows neither: there is nothing left to join. The list never
loads the host link.
