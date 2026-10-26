# RSVP pages

> The RSVP page is now one of three shapes a meeting can take, and it is
> reached from the **Meetings** section rather than a section of its own. See
> `docs/features/meetings.md`. The page itself, below, is unchanged; its
> reminders are now the meeting's reminders, which that document describes.

A public sign-up page for an event. An owner or admin turns it on for any
event (every club has them, the Free plan included); anyone with
the link signs up with a name, an email and a phone number. Guests get a
confirmation email (with their ticket and invite link), then reminders
(email, and a text once Twilio is set up) at the times the meeting sets: a
day and an hour before, unless the host chose others.

What sets it apart from Luma and Partiful: guests **split the cost** with
the host's Venmo, Cash App, PayPal or Zelle (no fees, nothing through us),
claim lines on a **bring list**, bring friends with their **own invite
link**, and get a **QR ticket** a host scans in **door mode**; any page
prints as a **flyer** with tear-off tabs; and in a club every check-in lands
in the club's People and Attendance databases.

## Where it lives

- **Public page:** `/e/{code}` (`src/app/e/[slug]`). The code is eight
  lowercase letters and digits, set the first time the page is turned on,
  and kept when the page is turned off and on again, so a shared link
  survives. Pages aren't indexed by search engines.
- **In the suite:**
  - **Meetings** (the sidebar section that was RSVPs, in every club and in
    Personal, `/app/{slug}/meetings`; the old `/calendar/rsvp` redirects
    there): owners and admins see every meeting, with sign-ups at a glance;
    everyone else sees what is still to come and joinable or taking sign-ups.
    Every card opens the meeting's own page, which links to its public page.
    Everyone sees their own tickets there too (in Personal, from every
    space).
  - Each event's page has an **RSVP page** card.
  - _New event_ starts by picking **Online**, **In person** or **Event**.
    An Event also creates the public page and opens its settings.
  - The management screen (`/app/{slug}/meetings/{id}/rsvp`; the old
    `/calendar/{id}/rsvp` redirects there) has two tabs:
    - **Guests:** search, filter, check-in, move guests between going and
      the waitlist, cancel or delete a sign-up, add a guest by hand, and
      export to CSV.
    - **Page settings:** cover image, background, spots, waitlist, open or
      closed, directions, and privacy.
- Managing a page is for owners and admins only (`events.write`).

## What the page shows

- The title, date and time in the club's timezone, and the location with a
  Google Maps link, and a map that loads when the guest taps "Show the map"
  (the keyless embed; CSP `frame-src` allows `https://www.google.com`). It
  isn't loaded up front: the embed is well over a megabyte of scripts, and
  would tell Google about every visitor. An all-day event is dated in the
  club's timezone too (it is stored as midnight there), and its Google
  Calendar link adds it as all day on those dates.
- Directions ("How to find it", `Event.locationDetails`).
- The cover (square WebP crops in the public store, kind `event-covers`).
- **Hosted by:** the club and the event's host.
- **Who's going:** one name a line, in full ("Jackson Lamoureux"), with
  initials avatars and, when the guest shared it, a link to their
  Instagram (`EventRegistration.instagram`, optional on the sign-up form,
  stored without the @). Instagram profile pictures
  aren't pulled in: Instagram offers no way for other sites to load them.
- The online meeting link, only to someone who is going (not the waitlist).

The host's privacy switches:

| Switch                                | Effect                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| Hide the address until people sign up | The address, directions and map show only to guests who are going.                        |
| Hide who's going                      | No names on the page.                                                                     |
| Hide how many are going               | No head count or spots left. This also hides the names, since a list of names is a count. |

Backgrounds (`src/lib/rsvp/backgrounds.ts`):

- Light: banana, cream and peel.
- Dark: night, pine, brick and navy.
- Cover photo: the cover blurred and dimmed behind the page.

The registration card is always paper and ink, whatever the background.

## Spots and the waitlist

- `Event.rsvpCapacity` is the number of spots; null is unlimited.
- When the event is full:
  - with the waitlist on (`rsvpWaitlist`), new sign-ups join the waitlist;
  - without it, registration says the event is full.
- When someone going cancels (or a host cancels or deletes their sign-up),
  the person who has waited longest moves up and is emailed. Raising the
  capacity or removing the limit moves people up the same way.
- A host moving a going guest to the waitlist frees their spot the same
  way: the next person in line moves up. The moved guest goes to the back
  of the line and is skipped, so the spot never comes straight back to
  them. A host who wants someone particular in moves that guest to going
  (hosts may go past capacity).
- The line is ordered by `EventRegistration.queuedAt`, when the guest last
  joined the going list or the waitlist (then `id`), and so is the place in
  line a waitlisted guest sees. Someone who cancels and signs up again goes
  to the back.
- Hosts can add a guest past capacity, and can move anyone to going.
- Sign-ups are counted under a per-event advisory lock
  (`pg_advisory_xact_lock`), so a rush for the last spots can't overbook
  (`src/server/rsvp/rsvp.db.test.ts`).
- Registration closes when the host turns off **Taking sign-ups** or when
  the event ends.

## Guests and their sign-up

- The same email can sign up once per event (`@@unique([eventId, email])`).
- Typing an email that is already signed up doesn't reveal or take over
  that sign-up. The page only says the confirmation was re-sent (at most
  hourly), and the email goes to its owner.
- A guest's browser keeps a signed key in an httpOnly cookie on
  `/e/{code}`: the registration id plus an HMAC of it under `AUTH_SECRET`
  (`src/server/rsvp/token.ts`). The links in their emails carry the same
  key (`/e/{code}/manage?key=...` sets the cookie), so any device they open
  the email on shows "You're going" with **Can't go**.
- Sign-up and cancel are Server Actions on the service path, scoped to the
  page's event (`app.rsvp_page(code)`, SECURITY DEFINER, service role
  only). They are rate limited per IP and have a honeypot field.

## Messages

Job kinds in `src/server/jobs/registry.ts`:

- `rsvp-email`: one email per guest. The templates are confirmation,
  waitlist, a spot opened, a reminder (one per reminder time), and the event
  was cancelled.
- `rsvp-fanout`: queues one `rsvp-email` per guest, in bulk
  (`enqueueRsvpEmails`: the same keys, with `app.enqueue_job` run per guest
  inside the database in one statement), so a big guest list fits in its
  short transaction.
  It may run in the request's `after()`, so a cancellation goes out right
  after the delete.
  - Reminders are one fanout per reminder time the meeting sets
    (`Event.reminderMinutes`, a day and an hour unless the host chose
    others), queued with `runAt` that long before the start; an all-day
    event skips any under a day. The same fanout reminds invited members
    in-app, so members and guests have one reminder system
    (`docs/features/meetings.md`, Reminders). Its key includes the time and
    the start, so moving the event queues new reminders, and the old ones
    find the start changed and do nothing.
  - Moving the event also lets the new time's reminders reach everyone: the
    fanout forgets the sends logged for the old time
    (`EventReminderSend`) before it sends.
  - A reminder still waiting when the event starts (a retry, a late drain)
    is dropped, and so is one for a time since taken off the meeting.
  - The event service queues a `cancelled` fan-out when an event with a
    page is deleted. A merge sends none, so `mergeEvents` refuses to merge
    away an event whose page is on with people signed up (sign-ups don't
    move): merge the other way round, or turn the page off first.

Emails follow the page's rules: the online meeting link goes only to
someone going, and an address the host hides (with its directions) only to
someone going too (`guestPlace` in `src/server/rsvp/email.ts`).

Emails come from the club's own sender if it has one, otherwise from
"<Club> via Bananasplit". The text goes out with each reminder when
`SMS_DELIVERY` is live (`src/server/sms`, set up with `TWILIO_*` in
`.env.example`). It is best effort: a failed text never resends the email.
Each reminder is claimed in `EventReminderSend` (one row per guest and
reminder time) before it is sent, so a retried job never reminds twice; a
failed send releases the claim so the retry can send. The old
`reminderDaySentAt` and `reminderHourSentAt` columns on the registration are
unused now.

Reminders depend on the job drain: every 15 minutes with the Jobs pinger,
or `*/5` on Vercel Pro (RUNBOOK, Background jobs). With only the daily
backstop cron, they arrive late.

## Data and access

- `EventRegistration` holds names, emails and phones. RLS lets only owners
  and admins read or change sign-ups in the suite (app_user). The public
  page and the jobs use app_service, scoped to the event's org.
- The org export includes sign-ups. It is owner-only.
- Turning a page off keeps its sign-ups. Deleting the event soft-deletes
  it, and its guests are emailed that it's cancelled.

## The Meetings list

The sidebar's Meetings (it was RSVPs) lists meetings as cards in a grid, like
Files: the event's cover (or its first letter on its kind's tint) with a
calendar-leaf date, the kind and time, and the head count (hosts) or your
status. The next upcoming one is a wide **Next up** card. Your tickets are
cards too, the event's picture on the left like a stub, with **Show ticket**.
`docs/features/meetings.md` has the rest of what a card shows.

## Part of every club

RSVP pages come with every club, the Free plan included; there is no
separate personal product. To make one, sign up and join or start a club.
Free personal spaces (`Organization.kind = PERSONAL`, /rsvp) were retired
in `20261013160000_retire_personal_spaces`: each became an ordinary club on
the Free plan, owned by the person who made it and named after them
("Maya's events" unless it had a name), so its event pages, guests and
links carry on. `Organization.kind` stays, and a check keeps it `CLUB`.

Every public page ends with **Make RSVP pages for your club, free**, which
goes to sign-up.

## Split the cost

- `Event.rsvpCostMode`: `NONE`, `EACH` (a price per guest) or `SPLIT` (a
  total shared by everyone going, rounded up to the cent, so a guest's share
  drops as people sign up). `rsvpCostCents`, `rsvpCostNote`.
- `Event.rsvpPayTo`: `{venmo, cashapp, paypal, zelle}` handles
  (`src/lib/rsvp/pay.ts` validates them). Guests going get buttons that open
  each app with their share and a note filled in; Zelle shows who to send to.
- A guest taps **I've paid** (`paidCents`, `paidClaimedAt`); a host confirms
  it, or marks cash at the door (`paidConfirmedAt`). The host screen shows
  what's collected, and door mode and tickets show who still owes.

## The bring list

`RsvpItem` (label, how many people it needs) and `RsvpItemClaim`. Hosts edit
the list in Page settings; guests who signed up claim lines on the page. A
claim counts under the event's advisory lock, so the last slot goes to one
guest; `app.rsvp_claim_same_event` keeps a claim on its own event. A guest
who cancels (or is cancelled by a host) lets go of their lines. Names show
in full, and not at all when the host hides who's going.

## Invite links

Every sign-up has an `inviteCode`: `/e/{slug}?via={code}`. A visitor through
it sees "Maya Patel invited you"; signing up records `invitedById` (the first
inviter keeps the credit). The guest's card counts who joined with their
link; the host's list shows "Invited by" and who brought the most friends.

## Tickets, door mode and check-in

- Every sign-up has a `ticketCode` (12 characters): `/e/{slug}/t/{code}`,
  a QR on the guest's card and in their emails. A guest sees their ticket;
  a host of the event (signed in, owner or admin) who opens the same URL,
  for instance by scanning it with the phone's camera, gets a one-tap
  check-in (and "Mark paid"). `app.rsvp_ticket` finds it on the service path.
- **Door mode** (`/app/{slug}/meetings/{id}/rsvp/door`; the old
  `/calendar/{id}/rsvp/door` redirects there):
  search and tap, or scan tickets in the browser where it has
  `BarcodeDetector`. Scanning a waitlisted guest's ticket doesn't check
  them in: it warns they're on the waitlist, and the host can tap their name
  to let them in anyway. That route allows the camera
  (`DOOR_PERMISSIONS_HEADER`); every other page keeps `camera=()`.
- A check-in also finds or makes the guest's `Contact` (by
  email) and an `Attendance` row (method QR or MANUAL), linked through
  `EventRegistration.attendanceId`; undoing it removes only that row. A
  check-in the club already had is left alone. This is best effort: if the
  club's databases refuse it, the check-in still stands.

## The flyer

`/e/{slug}/flyer`: a US Letter poster with the event in big type, a QR to
the page and seven tear-off tabs. It shows only what the page shows anyone,
so any guest can print one.
