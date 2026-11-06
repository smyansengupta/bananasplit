# Meeting links

Meetings has three parts: **Meetings**, **Find a time** and **Meeting links**
(`/app/{slug}/meetings/booking`; the address, tables and code keep the old word
"booking"). A meeting link is a page anyone can open (`/book/{link}`) to pick a
time with you. What they book goes straight onto the host's calendar as a real
meeting, into the host's Inbox, and to the guest by email.

## Who gets what

| Link | Who has it | Plan | Who changes it |
| --- | --- | --- | --- |
| **The organization's link** | Exactly one per organization: "Meet with {organization}", the heading of the page. It's the organization's, never a person's: it rotates among its hosts, the owners and admins to start. Made the first time someone who runs links (an owner, admin or CRM manager) opens Meeting links, switched off. A Personal space has none. | Any plan, no CRM needed | Its hosts, whoever made it, owners, admins and CRM managers |
| **Your meeting link** | Every member of every space, and every Personal space. Made the first time you open Meeting links. | Any plan, no CRM needed | Only you |
| **More organization links** | Shared links anyone in the organization can send, like "Coffee with the president". One named host, or several taking turns (round-robin). The CRM uses them. | The CRM: on the plan and added in Integrations and apps, the same gate as `/crm`. A Personal space has none. | Its hosts, whoever made it, owners, admins and CRM managers |

If the CRM comes off the plan or is removed, the more organization links stop
taking bookings (the public page says it isn't open); the organization's own
link and personal links keep working. The CRM side of a booking (below) runs
only when the CRM is also set up.

**How the main link is marked:** its id is `main-{organizationId}`
(`mainLinkId`, `src/server/booking/access.ts`). A known primary key needs no
column or migration, the database itself keeps it to one per organization
(two people opening the page at once both land on the same row), and the
editor can't change it, so its slug, name and hosts stay free to edit. Its
address is the organization's own slug when that's free (`/book/{slug}`),
else one made from its name. A link that was there first, even one named for
someone, stays one of the more organization links.

The CRM keeps pointing here: `/crm/settings/booking`, `/crm/settings/booking/{id}`,
`/crm/outreach/booking` and `/crm/outreach/booking/{id}` redirect to it
(with `?edit={id}` opening that link's editor), You shows your own link and
turns it on in place, "Get your CRM started" on Today does the same, and
the person card's `/` menu inserts your link or any organization link.

## The page

**An organization** has four zones, top to bottom:

1. **The organization's link** as one bar across the top, the shape of Video
   calls on Meetings: the organization's picture or initials, its name ("Meet
   with Claude Builders Club"), a short line ("30 minutes with whoever's
   free"), the hosts as a small stack of faces, the short link as a quiet
   pill, and one button. Open, Edit and Turn off are in its menu. It stays on
   one line wherever there's room (it goes by its own width; the pill gives
   way first), and stacks in two rows on a phone. Until someone who runs links
   has opened the page there's no strip.
2. **The other organization links** wait behind one quiet control at the end
   of the strip ("2 more links"), which opens them in a window with New link
   at its foot. With none yet there's no control, and New link is in the
   strip's menu (with the CRM).
3. **Everyone's links**, three to a row (two on a tablet, one on a phone; the
   grid goes by its own width, since the sidebar takes some of the page). A
   card is a person: their face, name and title, their next seven days as a
   picture, the hours in words, their next free time, and Copy link. A click
   anywhere on the card opens that link's page. Yours comes first, with Open,
   Edit and Turn off in its menu, then links that are on, each by name. A
   member whose link is off stays in the grid, quietly, as "Hasn't turned
   theirs on". Past nine people, the first nine show with Show everyone and a
   search field.
4. **Coming up**: the booked meetings, drawn like Meetings' cards: the date
   tile, the guest, when, the link, the host's face, one action at most, and
   Join and Cancel in a menu. What needs a host comes first. Members see the
   ones they host; owners and admins see them all.

**A Personal space** is a different page: no grid and no organization strip.
Your link is the strip, your week is a larger picture inside it (each day's
hours in words on a wider screen), then Coming up.

A link that's off shows when you're free to nobody, so the loader sends nothing
of it to anyone else's browser: no address, no hours, no title. Its owner's
card is all that shows. Faces, names and titles are `userPublicSelect` and
`Membership.title`, never an email.

### One action

Every link and every booking has exactly one visible action. A link's is Copy
link, which says Copied on the button for two seconds (no toast). The rest sits
in one quiet menu. An ambient button shows only where something needs doing,
and it takes Copy link's place rather than joining it. Reason lines don't go
under them: the state on the card already says it, and the reason is on hover.

### Ambient buttons

Decided in `src/lib/ambient/booking.ts` (on the server, so the first paint and
the browser agree). Each goes when that stops being true.

| Where | Button | Shows when | Goes when |
| --- | --- | --- | --- |
| A link | Add a host | Nobody hosts an organization link (it can't go on until someone does) | It has a host |
| A link | Turn it on | It's off and you may edit it | It's on |
| Someone's card | Ask them | Their link is off and nobody has asked yet | It's asked, for everyone |
| A booking | Take it | Owners and admins, when its host left (before Join, when both apply) | Someone takes it |
| A booking | Join | It has a call, from 10 minutes before until it ends | It ends |

A link nobody can book in the next two weeks says "No open times" on its strip
or card, and Edit is in its menu. Unconfirmed bookings say "Unconfirmed", with
the reason on hover: only the guest can confirm, and the meeting is on the
calendar either way.

**Ask them** sends one Inbox line (`MEETING_BOOKED`, so it follows the same
email preference) that opens Meeting links, which makes the link if they've
never been there. It's one per member per space however many people ask: the
line's dedupe key is the member's, not the asker's.

## A link

- **When you're free**: each weekday's time ranges ("Monday 9 AM to 12 PM and
  1 PM to 5 PM"), plus one-off dates (not free that day, or other hours that
  day), in the link's own time zone. A new personal link starts switched off (a live link shows when you're
  free, so you turn it on), at weekdays 9
  to 5 in your time zone. An organization link can instead use each host's
  availability grid from Find a time (the older behavior, kept for existing
  links).
- **Your real calendar always wins**: anything you host, or were asked to and
  didn't decline, in any space you're in, blocks the time, and so does
  everything on your Personal calendar (its Google import included). Read
  fresh at the moment of booking (`app.booking_host_busy`, times only).
- Lengths (a default and up to three more the guest can pick), a gap between
  meetings, least notice, how far ahead, the most a day, questions, video (the
  organization's connected Meet, Zoom or Teams makes a link per booking; or a
  standing link; or a place), reminders, and the link's address.
- Editor: the app's centered dialog, the New event dialog's look
  (`src/components/booking/link-dialog.tsx`).

## A booking

1. The guest picks a length and a time. Times show in their own time zone
   (their browser's), with the link's one a click away.
2. In one transaction: every host free then is locked (a per-host advisory
   lock), the time is checked again under the lock, a host is picked
   (round-robin), and then:
   - a calendar event (Meetings, the host's calendar, and Google Calendar when
     the organization mirrors there) with the host attending, the video link
     being made, and the link's
     reminders;
   - a `Booking` row (the guest, their answers, the event, the hash of their
     manage link);
   - a `MEETING_BOOKED` Inbox line for the host (emailed too, per their
     notification preferences);
   - the guest's email, queued (`booking-email`).
3. The guest's email has **Confirm it's me** and **Move or cancel**, both on
   their own page `/book/m/{token}`. Opening the page changes nothing; every
   change is a button, so mail scanners can't confirm or cancel anything.
4. When they confirm, and the CRM is on: they're matched to a person by
   address (or added, owned by the host), the meeting goes on their timeline,
   an organization link's pipeline gets a deal, sequences that stop on booking
   stop, campaigns are marked booked, and automations hear `meeting.booked`.
   **Nothing in the CRM happens before they confirm**, so a stranger typing a
   real contact's address can't attach a meeting to them or stop their
   follow-ups.

Emails come from the organization's own verified sender when it has one,
otherwise from Bananasplit's own transactional sender as itself (the one
that sends sign-up checks and password resets, `getPlatformMailer`). They
never go through the CRM's mailbox, never read "<Org> via Bananasplit" and
never carry the host's name as the sender: whoever booked typed the address.
So a space with no sender of its own still confirms every booking. The page
also says "You're booked" with the time and an **Add it to your calendar**
file made on the spot (no link back to the booking in it), so the guest has
it even when no email reaches them.

## Audit: nobody misses an important call

| Risk | How it's handled | Test |
| --- | --- | --- |
| Two guests race for one time | Each host free then is locked (`pg_advisory_xact_lock`, sorted, in the booking transaction) and the time is checked again under the lock; a partial unique index on (host, start) for live bookings backs it up; the loser is told "That time was just taken" | `booking.db.test.ts` "lets only one of two guests racing for the same time have it", "tells the guest the time was taken when only the unique index stops the second booking" |
| A meeting overlaps an existing calendar event | Busy times come from every space the host is in: hosted, attending (not declined), and the whole Personal calendar with its Google import | `slots.test.ts` "never overlaps a meeting, even partly"; RLS `P-BOOK-02` |
| An event added after the page loaded | The check at booking time reads the calendar fresh, under the lock | `booking.db.test.ts` "refuses a time that a meeting added after the page loaded now covers, even one in another space" |
| Guest in another time zone | Slots are instants; the page groups them in the guest's zone; their emails use the zone they booked in | `slots.test.ts` "shows a guest in another zone the same instants on their own days"; `booking.db.test.ts` (guestTimeZone kept) |
| Slots across a DST change | Hours are matched by the wall clock in the link's zone, so 9 AM stays 9 AM; times that don't exist (spring forward) are never offered | `slots.test.ts` "keeps the wall-clock hours across the fall DST change", "...spring DST change, and offers no time that doesn't exist" |
| Minimum notice and how far ahead | Enforced in the slot engine, which booking re-runs, so a direct request can't skip it | `slots.test.ts` "holds minimum notice and how far ahead"; `booking.db.test.ts` "holds minimum notice and the buffer when booking directly" |
| Buffers | The gap is kept clear on both sides of every busy time | `slots.test.ts` "keeps the buffer clear around meetings already on the calendar"; `booking.db.test.ts` (buffer) |
| Too many in a day | The link's "most a day" per host | `slots.test.ts` "stops at the daily cap"; `booking.db.test.ts` "holds the most a day, and a time already booked..." |
| Guest cancels | Booking cancelled, meeting deleted, host told in the Inbox, guest gets a receipt | `booking.db.test.ts` "lets the guest move and cancel" |
| Guest reschedules | Same host's open times (its own time not blocking itself), checked under the lock; booking and meeting move, reminders re-armed, host told every time (even back to a time they had before), guest emailed | `booking.db.test.ts` "lets the guest move and cancel", "tells the host every time a guest moves..." |
| Host cancels | Cancel in Meeting links (with a note), or delete the meeting anywhere: the guest is emailed, the booking marked cancelled by the host | `booking.db.test.ts` "lets the host cancel from Meeting links...", "follows the host moving or deleting the meeting on the calendar" |
| Host (or an admin) moves the meeting on the calendar | The event service queues `booking-sync`; the booking follows and the guest is emailed the new time and the host gets an Inbox line | `booking.db.test.ts` "follows the host moving or deleting the meeting on the calendar, and tells the guest" |
| Host removed from the organization | Their own link stops at once, they come off organization links (a link left with nobody stops), and `booking-host-left` gives each upcoming booking to another free host of the same link (guest told) or flags it "Needs a host" with every owner and admin told; admins can Take it or Cancel; Take it refuses, in words, a time the taker already has booked | `booking.db.test.ts` "moves a leaving host's bookings to another host, flags what nobody can take, and stops their own link", "says so when Take it lands on a time..." |
| Host deactivated | Bananasplit has no deactivation separate from leaving; a host who isn't a member is never offered or booked (`liveHosts`, `app.booking_host_busy` joins Membership) | Covered by the removal test |
| Round-robin fairness | Fewest bookings on the link in 30 days, then whoever was booked longest ago, then link order | `slots.test.ts` "spreads 30 bookings evenly over three free hosts" |
| A host with no free time | Left out of the slots; others take the bookings; a link nobody can book in the next two weeks says "No open times" in Meeting links | `slots.test.ts` "leaves out a host with no free time..." |
| Reminders before the meeting | The meeting's reminder fan-out (`rsvp-fanout`) reminds the host in-app as for any meeting, and now queues the guest's email; each is sent once per start (claimed in `Booking.remindedOffsets`), released if sending fails, re-armed when it moves | `booking.db.test.ts` "sends each reminder once, releases it when sending fails..." |
| Email sending fails, or the space has no sender of its own | The guest email is a job on the app's own transactional sender (not the CRM mailbox) that retries (8 tries); the guest also sees the booking and gets a calendar file on the page; the host's Inbox line and the calendar event are written in the booking transaction, so they're there regardless | `booking.db.test.ts` (same test) |
| Spam and abuse on the public page | Honeypot field; 10 bookings per visitor per hour, 3 per guest address per day; per link: 40 in 24 hours, 10 unconfirmed made in 24 hours (a burst cap, so old unconfirmed ones never keep a link shut), 2 upcoming per address; page views and manage links rate-limited; input caps (name 80, answers 1000, ten questions) | `booking.db.test.ts` "refuses links in the name, and caps one address and one link" |
| The page used to email someone else's words | The name can't hold links, addresses or markup; emails repeat only a first name that looks like one and never the answers; fixed copy | `guest.test.ts`, `emails.test.ts` "never repeats a name that isn't one" |
| A stranger books with a real contact's address | Nothing in the CRM changes until the guest confirms from the email | `booking.db.test.ts` "waits for the guest to confirm before the CRM matches them..."; `outreach.db.test.ts` |
| A booking the host can't see | It's a real event in the space's calendar with the host attending, so it shows on Calendar, Meetings, the meeting's page, Personal's "when you meet next" and Google Calendar when mirrored; plus the Inbox line | `booking.db.test.ts` "gives every member a personal link..."; `view.db.test.ts` "on a personal link...", "in a Personal space..." |
| The other hosts of a shared link can't see one | Round-robin gives a booking to one host. The others aren't made attendees (that would block their own time and ask them to reply), so `coHostedEventIds` hands `meetingsWhere` those events and they stay on those hosts' Meetings list and its tab count; the Calendar shows them to everyone already. Members still read only the bookings they host, so they aren't in those hosts' Coming up | `view.db.test.ts` "on a shared link..." |
| Who reads guests' details | `Booking` RLS: the host, and owners and admins; members write nothing (service path only). The calendar event carries none of it (every member reads events): the meeting page shows the guest from the `Booking`. Coming up's cards don't carry the guest's address at all. `coHostedEventIds` reads bookings on the service path but hands back event ids only | RLS `P-BOOK-01`; `view.db.test.ts` "counts a link's bookings..." |
| A link that's off shows someone's hours | Every member can read a space's links (`CrmBookingPage` RLS), so the loader is what stops it: only links that are on leave `loadBookingLinks` | `view.db.test.ts` "shows every member, with nothing of a link that's off..." |
| Nagging a member to turn their link on | Ask them is one Inbox line per member per space, whoever asks, and it isn't offered again | `view.db.test.ts` "sends one Inbox line however many people ask..." |
| Someone made host without asking | Only owners, admins and CRM managers add other people as hosts of an organization link; anyone may add or remove themselves. The main link starts with the owners and admins, so it starts off, and they're told in the Inbox when someone turns it on | `booking.db.test.ts` "lets only admins and CRM managers put someone else on an organization link"; `view.db.test.ts` "tells its other hosts when it goes on..." |
| CRM turned off | The more organization links stop taking bookings; the organization's own link and personal links keep working | `booking.db.test.ts` "closes organization links when the CRM comes off"; `view.db.test.ts` "keeps the main link when the CRM comes off..." |
| The first open from two tabs at once | Your own link and the main link are made with `skipDuplicates`, so the second tab finds the first's row instead of ending the page's transaction | `view.db.test.ts` "stays one link when two people open the page at the same moment" |
| A link in its own time zone | Its hours, its next free time, the public page and the host's Inbox lines all read the link's zone; the guest's emails read the zone they booked in | `slots.test.ts`; `view.db.test.ts` "says the next free time in the link's zone..." |

## Where things live

- Data: `CrmBookingPage` (the link; `ownerUserId` set for a personal one, id `main-{organizationId}` for the organization's own) and
  `Booking` (migration `20261107090000_booking_links`, with
  `app.booking_host_busy` and the `booking-guest` kind of
  `app.crm_public_target`).
- Engine: `src/lib/crm/outreach/booking.ts` (slots, round-robin),
  `src/lib/booking/hours.ts`, `src/lib/booking/week.ts` (the week as a
  picture), `src/lib/booking/guest.ts`, `src/lib/ambient/booking.ts`.
- Server: `src/server/booking/` (`book.ts` public side, `links.ts`,
  `manage.ts` host side and sync, `jobs.ts`, `emails.ts`, `view.ts`,
  `co-hosted.ts`).
- Pages: `/app/{slug}/meetings/booking`, `/book/{link}`, `/book/m/{token}`
  (and its `calendar.ics`).
- The page's parts: `src/components/booking/` (`booking-links-view.tsx`,
  `link-strip.tsx`, `other-links.tsx`, `people-grid.tsx`, `coming-up.tsx`,
  `week-bars.tsx`, `link-ambient.tsx` (a link's one action and its menu),
  `copy-button.tsx`, `link-dialog.tsx`).
- Jobs: `booking-email`, `booking-sync`, `booking-host-left`.

## Not done yet

- Members can't connect their own outside calendar (Google is connected per
  organization and imported into its calendar, or into a Personal space); a
  personal Google calendar counts only once it's imported into the member's
  Personal space.
- All-day events don't block bookings (holidays and birthdays would close
  whole days); a member who's away marks the date as not free on the link.
- A guest can't pick another host when rescheduling an organization link; the
  same host's times are offered.
- Unconfirmed bookings are kept (a real guest may never click); they're
  marked "Unconfirmed" in Meeting links, and capped per link.
- Open times are worked out for the first 20 links on the page (yours, then
  the organization's own, its others, then the members'): past that a card
  shows its hours but no next free time.
- The main link's name is set when it's made: renaming the organization
  doesn't rename it (edit it in its menu).
- A new owner or admin isn't added to the main link's hosts by themselves;
  add them in its editor.
