# Meetings — design and checklist

Branch `claude/meetings`, worktree `Documents/Claude/bananasplit-meetings`, off `main` a794436.

## Decided (Jack, 2026-10-24)

- **The Calendar stays** exactly as it is. Meetings is where you set things up;
  the Calendar is where you see them.
- **Graphite the preset** becomes the default — neutral greys, near-black primary,
  white page. Not Moonstone. This is a real visual change across the whole app.
- **All three providers get built.** Google Meet works end to end now; Zoom and
  Teams sit behind a Connect button until Jack adds the credentials.
- **Meetings are made in the organization's account.** An admin connects one Zoom
  (or Teams) account in the Admin panel and every meeting anyone creates is made
  there. Per-host accounts are a later addition, so `ConferenceConnection` (A3) is
  keyed by org and provider, not by user.

Still my assumption, say if it is wrong: "organization-based, less club-focused"
is a wording change in this section, not a structural one; and an "event" is the
third shape of a meeting in the same section, not a child record underneath one.

## What this is

Today the sidebar has **RSVPs**, which is one thing: a public sign-up page bolted
onto a calendar event. It becomes **Meetings**: the one place you go to set up
anything that happens at a time, whatever shape it is.

Three shapes, one workflow:

| Shape | What it is | What it needs |
|---|---|---|
| **Online meeting** | A Google Meet, Zoom or Teams call | A real meeting created in that provider, with a join link |
| **In person** | A room, an address | A place, and how to find it |
| **Event** | A talk, a social, a hackathon | All of the above plus the public sign-up page we already have |

You pick the shape first and the form shows only what that shape needs. An
online meeting never asks for a room; an in-person one never asks for a
provider. A meeting can be both (hybrid) by adding the other half later.

## Why reuse `Event` rather than add a `Meeting` model

`Event` already carries `conferenceProvider` and `conferenceUrl`, the whole RSVP
page, the Google Calendar mirror, attendees, attendance, the ICS feed, the public
feed, and the reports and databases that read from it. A second model would split
the calendar in half and duplicate all of it. So a meeting *is* an Event; what is
new is the provider integration, the section, the one create flow, and reminders
for members.

## What is already there (and does not need building)

- `ConferenceProvider` enum (`NONE | MEET | ZOOM | TEAMS | OTHER`) and
  `conferenceUrl` on `Event` — today the provider is only a **label on a link you
  paste by hand** (`src/components/calendar/conference-provider-select.tsx`).
- A working Google OAuth + Calendar two-way sync
  (`src/server/google-calendar/*`, `src/app/api/integrations/google-calendar/*`),
  including a job that **creates the event in Google Calendar**. Google Meet is
  close to free from here: ask for a conference when creating that event and
  Google hands back the Meet link.
- A job queue with retries and compare-and-set marking (`src/server/jobs/*`), and
  an RSVP reminder fanout at a day and an hour before, over email and SMS
  (`src/server/rsvp/jobs.ts`).
- Notifications with a per-recipient dedupe key (`Notification`).
- An Integrations settings area with a provider-form pattern to copy
  (`src/app/app/[orgSlug]/settings/integrations/*`).

## Checklist

A ticked box means the item's job is done. Where an item names a mechanism that
was built differently, it is still ticked, and the difference is here so the
list does not describe something that is not there
(`docs/features/meetings.md` has the full account):

- A2: the join link is the existing `conferenceUrl`, not a new `conferenceJoinUrl`.
- A3: there is no `ConferenceConnection` table. Each provider is an
  `OrgIntegration` row (`GOOGLE_MEET`, `ZOOM`, `MICROSOFT_TEAMS`) with an
  `OrgSecret` refresh token, so its RLS and grants already existed.
- A4: there is no `EventReminder` table. Offsets are `Event.reminderMinutes`,
  with the organization's default in `OrgSettings.meetingReminderMinutes`, and
  `EventReminderSend` logs what was sent.
- B1: the interface is `create`, `update` and `remove` (`ConferenceClient`);
  there is no `getMeeting`.
- B2: Meet is made with the Meet REST API (`POST /v2/spaces`) through its own
  OAuth client, not by extending the Google Calendar insert.
- B6, B7: connecting and disconnecting are on the Meetings page, not under
  Admin panel › Integrations.
- D6: the `+` menu has New meeting (Meetings) and New event (Calendar). Both
  open the same form.
- E2: a member's reminder is always in-app. Its email copy follows the member's
  notification settings and needs the organization's own email sender.
- K2: the e2e covers the three create paths and who sees the join link. A
  meeting made at a provider is covered by `sync.db.test.ts` with the provider's
  HTTP mocked, not by the e2e.

### A. Data model and migrations

- [x] A1. `Event.format` — `ONLINE | IN_PERSON | HYBRID`, derived for existing rows
      (`conferenceProvider != NONE` → ONLINE, else IN_PERSON). Drives which half of
      the form shows and what the list and reminders say.
- [x] A2. Provider meeting fields on `Event`: `conferenceMeetingId`,
      `conferenceJoinUrl`, `conferenceHostUrl`, `conferencePasscode`,
      `conferenceDialIn` (JSON), `conferenceSyncState`, `conferenceSyncAttempts`,
      `conferenceSyncedAt`, `conferenceSyncError` (sanitized — no tokens).
      Mirrors the `google*` fields already on `Event`, same compare-and-set on
      `syncVersion`.
- [x] A3. New table `ConferenceConnection`: one row per org (or per member — see
      question 5) per provider, holding the OAuth refresh token encrypted at rest,
      the account label, scopes, and `revokedAt`. Follow the existing Google token
      storage. **Needs RLS policies, GRANTs and a row in `prisma/rls/phases.mjs`.**
- [x] A4. New table `EventReminder`: which offsets an event sends (e.g. 1 day,
      1 hour, 10 minutes) and over which channel. Replaces the RSVP job's
      hardcoded day/hour pair for both guests and members. RLS as above.
- [x] A5. New table `UpNextDismissal` (user, org, block kind, block id) for
      hiding a stale Up next card. RLS as above.
- [x] A6. Migrations written with `prisma migrate diff` and hand-added RLS SQL
      (`migrate dev` is blocked here), `pnpm test:rls` green.

### B. Provider integration

- [x] B1. One provider-agnostic interface — `createMeeting`, `updateMeeting`,
      `deleteMeeting`, `getMeeting` — in `src/server/conference/`, so the event
      service never knows which provider it is talking to.
- [x] B2. **Google Meet**: extend the existing Google Calendar insert with
      `conferenceData.createRequest` and `conferenceDataVersion=1`, read back
      `hangoutLink`. Reuses the OAuth connection the org already has.
- [x] B3. **Zoom**: OAuth start/callback routes, token refresh,
      `POST /v2/users/me/meetings`, update and delete. Dark until Jack creates the
      Zoom app (question 4).
- [x] B4. **Teams**: Microsoft Graph OAuth, `POST /me/onlineMeetings`, update and
      delete. Dark until Jack creates the Azure app (question 4).
- [x] B5. A `conference-sync` job: creates the meeting after the event is saved,
      updates it when the time or title changes, deletes it when the event is
      cancelled. Retries, and never blocks saving the event — a provider being
      down must not lose the meeting.
- [x] B6. Reauth and revoke paths, and a clear state in the UI when a connection
      has expired (copy the Google Calendar reauth pattern).
- [x] B7. Connect/disconnect screens under Admin panel › Integrations, one per
      provider, showing which account is connected.
- [x] B8. Tests with the provider HTTP mocked: create, move, cancel, token
      refresh, expired connection, provider error.

### C. The Meetings section

- [x] C1. Sidebar: the `rsvps` section becomes `meetings`, label "Meetings", path
      `/meetings`. Saved sidebars that hid RSVPs must keep hiding it — the
      `ADDED_FROM` / retired-id machinery in `src/lib/nav/sidebar.ts` already
      handles this kind of rename; add `rsvps` to it.
- [x] C2. `/app/{slug}/meetings` — upcoming and past, each row showing the shape,
      the join link (one click, and a copy button), where it is, who is coming,
      and whether a sign-up page is on.
- [x] C3. Old paths keep working: `/calendar/rsvp` and `/calendar/{id}/rsvp`
      redirect into the new section.
- [x] C4. `/app/{slug}/meetings/{id}` — the one meeting: join details, the guest
      or attendee list, reminders, and the sign-up page settings if it has one.
- [x] C5. The sign-up page itself (`/e/{slug}`) gains the join link for online and
      hybrid meetings, shown only after someone signs up.
- [ ] C6. Plan gating: `SECTION_FEATURES` entry, and decide whether provider
      integration is a paid feature.
      Not ticked: decided, so nothing was built. Meetings has its entry
      (`meetings: "rsvp"`), and provider integration stays on that free feature
      with no paid gate.

### D. The one create workflow

- [x] D1. A single "New meeting" flow that opens with the three shapes, then shows
      only the fields that shape needs. Centred dialog, matching the task editor
      the app already uses.
- [x] D2. Online: pick the provider from the ones the org has connected, and the
      meeting is created on save. "Paste a link instead" stays, for anything we
      do not integrate with.
- [x] D3. In person: place, how to find the room, map.
- [x] D4. Event: turns on the sign-up page, capacity, waitlist, cost split, bring
      list — everything the RSVP page does now, reached from the same flow instead
      of a separate screen.
- [x] D5. Promote in place: an in-person meeting can gain a join link, and any
      meeting can gain a sign-up page, without being recreated.
- [x] D6. The Calendar's existing "New event" dialog and the `+` create menu both
      point at this one flow, so there is only one way to make these.
- [x] D7. Wording pass: "club" → "organization" through this section (question 3).

### E. Reminders

- [x] E1. Reminder offsets editable per meeting, with an org default.
- [x] E2. Remind **members** (`EventAttendee`), not just public sign-ups: email
      plus an in-app notification, deduped per recipient.
- [x] E3. Online meetings put the join link in the reminder.
- [x] E4. Rescheduling or cancelling re-queues or cancels the pending reminders.
- [x] E5. Reuse the RSVP fanout rather than adding a second reminder system.

### F. The tool capsule (the floating bar, top right)

- [x] F1. Build **three variations** as clickable prototypes for Jack to pick from
      (`src/components/shell/tool-capsule.tsx`). My starting sketches:
      - **Command bar** — the pill grows into a real search field with recent and
        suggested results, and the icons move into it.
      - **Context bar** — the pill carries what is happening right now: the next
        meeting with a Join button, unread count, then search and you.
      - **Split** — a slim always-there pill, and search as a full-width overlay
        on the command key, with scoped tabs.
- [x] F2. Build the one he picks for real, keeping the keyboard shortcuts and the
      phone layout working.

### G. Overview — stale "Up next"

- [x] G1. Root cause: an open poll with no close date is given a fake date 30 weeks
      out (`src/server/overview/up-next.ts`), so it never ages out. Give polls a
      real cutoff.
- [x] G2. Drop anything already past from Up next, whatever kind it is.
- [x] G3. A "Hide this" on each card, per member, stored (A5).
- [ ] G4. A way to see what you hid and bring it back.
      Not ticked: only "show all" exists (`showHiddenUpNextCards` puts every
      hidden card back); there is no list of what was hidden.

### H. Tasks

- [x] H1. Fix the filters on medium screens. There are two toolbars today — a
      desktop one and a phone one — and the band between them (a MacBook) gets the
      desktop one, which wraps the filters onto a second row. Rebuild as one
      toolbar that degrades on **container width, not viewport**: layout picker
      always visible, then scope, then filters and search collapse into buttons
      with counts.
- [x] H2. Remove the **Week** layout (`src/app/app/[orgSlug]/tasks/week/`), and
      send `?view=week` and `?view=mine` to the List with scope "mine" so existing
      links still work.
- [ ] H3. The weekly update is reached from the Week today — give it another way in
      (the dashboard keeps its link; add one to the toolbar's overflow).
      Not ticked: Tasks work, outside the plan that finished the Meetings
      providers, so it was not built or checked there.
- [ ] H4. Remove the **Epics** button next to New task
      (`src/components/tasks/workspace-header.tsx`).
      Not ticked: Tasks work, outside the plan that finished the Meetings
      providers, so it was not built or checked there.
- [x] H5. Turn **Roadmap** into the epics section: the epics view and the timeline
      become one place (`tasks/roadmap/` absorbs `tasks/epics/`), with `/tasks/epics`
      redirecting there.

### I. Theme

- [x] I1. Make graphite the default everywhere — new orgs, personal spaces,
      marketing, auth, onboarding (question 2 decides exactly which preset).
- [x] I2. Orgs that already saved a theme keep it.
- [x] I3. Keep both modes passing WCAG AA (`presets.test.ts`,
      `theme-css.test.ts` keeps `globals.css` and the default preset identical).

### J. People

- [x] J1. Dense **list** is the default view, not the grid
      (`src/components/profile/people-directory.tsx`).
- [x] J2. Clicking a name opens a **centred dialog**, not the right-hand sheet —
      matching the task editor and New event.
- [x] J3. `/people/{userId}` stays as the full page for deep links and sharing.
- [x] J4. Keep the keyboard navigation (up and down arrows between people) working.

### K. Keeping it green

- [ ] K1. `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:rls`, `pnpm build`.
- [x] K2. e2e covering the three create paths and a provider-backed meeting.
- [x] K3. `docs/features/meetings.md` replacing `docs/features/rsvp.md`.
- [ ] K4. Production preview on :3570, database `bananasplit_meetings`, so Jack can
      open it.
- [ ] K5. Branch, push, PR — never straight to `main`.

## My calls, for you to correct

- A meeting is an `Event`, not a new model (reasons above).
- An "event" is the third shape of a meeting in the same section, not a child record
  under a meeting. If you meant a meeting should literally contain sub-events — a
  series, or an agenda with its own items — tell me, because that is a different model.
- The provider meeting is created by a background job, not during the save, so a Zoom
  outage can never lose the meeting you just typed in.
- Reminders are one system for members and public guests, not two.
- "Organization" replaces "club" in the wording of this section only; the rest of the
  app keeps its current language until asked.
