# Personal space and clubs

Decided 2026-10-13 (Jack), after research on Luma, Notion, Todoist, Trello,
Slack, Discord, Doodle, Heylo and campus tools. Supersedes the "Free club"
plan from a9b3141 and the old free /rsvp pages.

## The model

- **Personal**: every account has one, free forever. It is an Organization
  with `kind = PERSONAL`, `personalOwnerId` = the user, exactly one member
  (the owner). It holds personal tasks, a personal calendar, availability
  polls (When2meet-style), RSVP event pages (Luma-style), (Moonstone,
  2026-10-19) notes and files, and the databases its owner makes (see "Files
  and Databases in Personal" below). No members, invitations, roles,
  people, org chart, finance or reports. It is on **Personal Free** (`FREE`)
  or **Personal Plus** (`PERSONAL_PLUS`, $4 a month or $36 a year: themes,
  calendar sync, AI imports, more storage); its owner switches in Settings ›
  Plan and storage.
- **Organization**: a shared space (`kind = CLUB`). Anyone can start one. A
  new organization gets a **30-day free trial** of everything (Team
  Advanced), no card. When the trial ends it moves to **Free**
  (`TEAM_FREE`, a reverse trial): nothing pauses or is deleted, and what
  Team and Team Advanced add is locked until the owner picks **Team**
  (`CLUB`) or **Team Advanced** (`SOCIETY`). The row stays `TRIAL` until a
  plan is picked; the app reads an ended trial as `TEAM_FREE`
  (`src/lib/billing/space.ts`). Owners and admins see a note that the
  trial ended. Prices: standard per member a month, billed yearly, or for
  a student organization (owner on a school address, within the plan's
  member cap) a flat price per academic year or semester
  (`src/lib/billing/plans.ts`). Billing isn't connected yet: picking a plan
  applies at once, behind the same seam (`changeOrgPlan`) a real checkout
  will call.
- **Joining a club is always free.** A joiner never sees a price, a trial
  or a paywall. Only owners and admins see plan prompts.
- Guests (people who RSVP or answer a poll) never need an account.

## Words

"Personal" and "Club" everywhere. No "workspace", "organization" or "org"
in the UI. "Start a club" (owner, trial) and "Join a club" (free, code or
link). Plans: Personal Free, Personal Plus, Team and Team Advanced (the
database values stay FREE, PERSONAL_PLUS, CLUB, SOCIETY and TRIAL; only
`PLAN_NAMES` says them out loud). Pricing says: "Joining members never pay."

## Plans and storage (Moonstone, redesign guide 11)

Every number lives in `src/lib/billing/features.ts` (`PLAN_LIMITS`,
`PLAN_FEATURES`, `PLAN_NAMES`) and `src/lib/billing/plans.ts` (prices).

| | Personal Free | Personal Plus | Team | Team Advanced (and the trial) |
|---|---|---|---|---|
| Price | $0 | $4/month or $36/year | $4/member/semester | $7/member/semester |
| Storage | 1 GB | 25 GB | 100 GB | 500 GB |
| Largest file | 10 MB | 250 MB | 250 MB | 1 GB |
| Note history | 7 days | 1 year | 90 days | 1 year |
| Data connections | 0 | 1 | 2 | 6 |

- Storage counts Notes files (and images in notes), receipts, note history
  and the trash, until it is emptied (`Organization.storageUsedBytes`, kept
  by database triggers; the app never writes it).
- Every upload passes one gate (`src/server/storage/quota.ts`): the space
  has the feature, the file is within the plan's largest
  file, and it fits. Refusals say the numbers. Files over 4 MB go straight
  to Vercel Blob with a short-lived, size-capped token
  (`src/server/storage/direct.ts`); the browser side is `uploadNoteFile()`
  in `src/lib/files/upload.ts`.
- At 80% owners and admins (or the Personal owner) see a banner on the
  storage page and the Files page (`SpaceStorageBanner`) and get one notice
  (in-app and email) per crossing. At 100% uploads stop. Nothing is ever
  deleted for being over; a downgrade that leaves a space over its limit
  only stops uploads.
- Settings › Plan and storage › Storage: the meter, the largest files and
  Empty trash.
- **Send to a club** (`src/server/storage/send-to-club.ts`): a copy of a
  Personal note or file into one of your clubs, shared there and counted
  toward the club's storage.

## Sign-up and onboarding

1. Sign up: name, email, password (or Google).
2. Your profile (onboarding Flow A, all steps, everything after step 1
   skippable): photo/name/pronouns/time zone -> school -> bio and links ->
   when you can't meet -> review. This is a real profile about yourself.
   Saving step 1 creates the Personal space and marks onboarding done.
3. Then the **Personal dashboard** (below). Pending email invites show at
   the top of it.

If sign-up started from a specific place (an invite link, a poll, an event
page, "Start a club" on pricing), the user returns there after step 1 of
the profile; the rest of the profile can be finished later from the
dashboard ("Finish your profile" card).

- **Joining a club** (code or link): a club preview, Join, then one small
  club step: your role/title in this club (and confirm availability is
  shared). Then into the club.
- **Starting a club**: the full club setup (Flow B: name, data, labels,
  finance, teams, invite). The trial starts at creation. At the end, a
  "Bring anything in?" step lists your Personal events (RSVP pages), polls
  and tasks; checked ones move into the club one way, keeping their ids,
  links, RSVPs, tickets and responses.

## Personal dashboard (/app/{personal slug} home)

- The page uses the full width, like a club's Overview, and every block is
  the same card (icon, title, a link to its page), so both columns' headings
  line up. Shortcuts to Tasks, Calendar, Files, Databases, Find a time and
  RSVPs sit on the
  same muted track as the Tasks layouts.
- Your clubs (one row each: name, logo, role, next meeting, open tasks,
  unread), then Join a club (a code, right there) or Start a club.
- When you meet next: upcoming events across all your clubs and Personal.
- Your RSVPs: events you're going to (public pages you RSVP'd to with this
  email) and the event pages you host.
- Due soon: your tasks across Personal and every club (labelled by club).
- Polls waiting on you, and your own find-a-time polls' responses, with a
  Find a time button.
- Finish your profile, when steps were skipped.

## Switching

The foot of the sidebar always lists **Personal & clubs**: Personal first
(your avatar), then your clubs, the one you're in marked; one click
switches (and is remembered). The menu at the top of the sidebar lists the
same, then Join a club / Start a club. Home (`/app`) opens the last space
used, else Personal.

Personal's sidebar: Home, Tasks, Calendar, Files, Databases, Find a time,
RSVPs. A club's
default sidebar puts RSVPs right under Calendar and Find a time under Club,
right after Polls; a club that saved its own sidebar before they existed
gets them next to those sections too (wherever it moved them), hidden if it
had hidden Polls (Find a time) or Calendar (RSVPs).

## Migration of existing data

- One-member FREE clubs (yesterday's converted personal spaces) become
  `kind = PERSONAL` again with `personalOwnerId` = their owner. If a user
  ends up with two, keep the oldest as Personal and leave the other a club
  on trial.
- Clubs with real members stay clubs on their current plan (SOCIETY).
- Every onboarded user without a Personal space gets one.
- The `plan = FREE` value now means "Personal". Clubs are TRIAL, CLUB or
  SOCIETY (trial end date stored on the club).

## Bring anything in (built)

The last club setup step (`/onboarding/organization/{slug}/bring`, B7)
lists the creator's Personal event pages, other calendar events (upcoming
and the last month), availability and question polls, and open top-level
tasks and epics in one list, none ticked; skipped when there's nothing to bring.
`?bring={id}`, or the item remembered by "Start a club" on
`/app/{personal slug}/move?item={id}` (Move to a club), starts ticked.
`/app/{personal slug}/move` also lists the clubs you own or run, each
opening the same list with `?from=move`.

The move is `app.move_personal_items` (migration
`20261013190000_move_personal_items`, which documents every row it
touches): one transaction, ids kept, the caller must own the Personal space
and be OWNER or ADMIN of the organization. Events move with
sign-ups, tickets, bring list and pending RSVP jobs, and become INTERNAL
(nothing lands on the club's public feed by itself). Polls move with slots,
responses, options and votes; a poll's scheduled event comes along. Tasks
move with subtasks, comments, activity and reminders; labels are matched in
the club by name or made there. (Projects became epics, which move like
any top-level task.)

## Files and Databases in Personal

Files and Databases are on both Personal plans (`files` and `databases` are
FREE in `src/lib/billing/features.ts`), with only what makes sense for one
person:

- **Files**: notes, uploads and folders are always private to the owner.
  Nothing asks who can see a note or upload (the New menu and the drop zone
  make them private), there's no Share button, no "who can see it" or
  "added by" filter, and no lock or "shared" marks. "Make tasks from this
  note" needs AI, so it shows on Personal Plus and not on Personal Free.
- **Databases**: only the ones the owner makes (the Blank and Spreadsheet
  templates, or an imported CSV/TSV/XLSX). Every space still gets the
  built-in Sessions, Attendance, Signups, Ballots and People definitions at
  creation (`app.ensure_org_defaults`), but a Personal space never lists
  them: `LISTED_DEFINITIONS` (`src/server/databases/types.ts`) filters the
  index, opening one by URL (404), search and pin search. No data source
  (Personal Plus's data connection is for calendar sync), no Reports tab,
  and the settings dialog doesn't ask who can see or edit it.
- **Into a club**: Send to a club copies a note or file. Moving a Personal
  database into a club isn't built yet.
