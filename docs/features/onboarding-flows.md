# Onboarding: profile setup and creating an organization

Two flows, from the design in the "Onboarding flows" flowchart:

- **Flow A, profile setup.** Every new member runs it once, right after
  signing up. People who already had an account before it shipped skip it.
- **Flow B, create an organization.** Only for the person creating one. They
  become its owner.

Both flows use one step screen (the design handoff's "Onboarding"): a top bar
with what's being set up, a stepper of numbered steps, and a card with the
step on the left and a live preview on the right
(`src/components/onboarding/setup-shell.tsx`). Like sign-in and sign-up, it is
Bananasplit's own look (Moonstone, dark first, inside `BrandRoot`), not a
club's theme: the screens use the app's tokens and shared components, sentence
case and pill buttons (docs/design/moonstone.md). Every step saves when you press
**Continue**, so leaving halfway loses nothing (**Save and exit** goes to the
club), and each step has its own URL.

## How someone gets in

Signing up (or signing in without an organization) lands on `/onboarding`,
which answers the flowchart's first question, **Profile complete?**:

- **No:** go to A1. The org layout and `/app` send anyone who hasn't finished
  here too. That includes someone who joined through an emailed invite link
  before setting up their profile.
- **Yes, and they belong to an org:** go to that org.
- **Yes, and no org:** the A7 choice. Join with an invite code, accept an
  email invite, or create an organization.

An unverified email can go through profile setup, and A1 shows the "check your
email" notice. Joining or creating an organization still needs a verified
address, the same rule as before.

## Flow A: profile setup (`/onboarding/profile/<step>`)

| Step | Page           | What it saves                                                                                                                                                       |
| ---- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1   | `basics`       | Picture (upload, or go back to the Google photo), full name, pronouns (preset or custom), time zone (detected from the device).                                     |
| A2   | `school`       | Major and an optional second major or minor (stored together in the one major field), grad year, and **your role**, which becomes your title in every org you join. |
| A3   | `bio`          | A short bio (280 characters here, the profile page allows more) and up to 8 links. The type (LinkedIn, GitHub, X...) is detected from the URL.                      |
| A4   | `theme`        | A personal theme: a preset or five custom colours, light or dark, with a live preview. It only changes your own view.                                               |
| A5   | `availability` | When you can't meet: click or drag hours on the week grid, or add rules (a recurring event, an hour or day you never meet, a specific date).                        |
| A6   | `review`       | Everything above at a glance. **Next:** join with an invite code, or create an organization. Someone who already joined an org gets **Go to <org>** instead.        |

Pressing a **Next** button on A6 marks the profile complete (`User.onboardedAt`).

All of it stays editable afterwards on the **Profile** page. The profile page
has two new sections, **Theme** and **When you can't meet**, which use the same
controls.

**Personal theme.** The org layout puts your palette and light/dark choice on
top of the org's theme. If an org locks light or dark, the lock still wins.
"Use the organization's theme" on the profile page clears your choice.

**Availability.** It lives in its own table that only you can read or write,
enforced by the database. Other members only ever see busy or free for each
hour of a typical week, on your people page. They never see the labels ("Lab
section"), the dates or the reasons. Each org decides whether its members see
busy times (the Teams step). That org's admins, and you, always do.

## Joining (A7, `/onboarding/join`)

There are two ways in, and both are checked against the organization before
anyone joins:

1. **Invite code.** Each org has one shareable eight-character code (like
   `RPKA-YWSF`) and a link that fills it in (`/onboarding/join?code=...`).
   The person types or pastes it into eight boxes, in two groups of four;
   once all eight are in, the page shows which club it belongs to (name,
   logo, member count), then they press **Join**. Six-character codes (like
   `ROBO26`), issued for a short while, still work when pasted or opened from
   their link. The server checks that:
   - their email is verified;
   - the code matches an org, the org isn't being deleted, and the code is
     turned on;
   - their email is on the org's allowed domain, if the admins set one (for
     example `northeastern.edu`, including subdomains).

   People who join with the code become **members**, with the role they picked
   in A2 as their title. Admins are notified.

2. **Email invite.** Invites sent to the person's verified address are listed
   on the same page with a **Join** button. This works exactly as it did
   before: the invite only works for the address it was sent to.

Lookups are rate limited per user (10 every 15 minutes) and need a verified
email. Codes come from a 30-character alphabet with no look-alikes (0/O, 1/I/L,
U), so there are about 7.3 × 10⁸ of them. Codes made before the six-box screen
are `XXXX-XXXX`; they keep working (a pasted or linked one gets eight boxes)
until an admin makes a new code.

**Managing the code:** **Settings › Members › Invite code**, owners and admins
only. From there you can copy the code or the link, turn it off, limit it to an
email domain, or **make a new code**. A new code stops the old one working
immediately. The same card appears on the org's overview right after org setup
finishes (the flowchart's "invite link shown on first load").

## Flow B: create an organization

The steps, in the order of `ORG_STEPS` (`src/lib/onboarding/steps.ts`); the
stepper numbers them 1 to 8.

| #   | Page                                    | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `/onboarding/organization`              | Club basics: name, web address (checked as you type) and time zone, plus a club-creation code where the platform requires one. Creates the club, with you as owner.                                                                                                                                                                                                                                                                                                                |
| 2   | `/onboarding/organization/<url>/labels` | The club's tags (the same ones as Settings › Labels): keep, rename, recolour, remove or add. A new club starts with four suggestions. The preview shows the newest tasks wearing them.                                                                                                                                                                                                                                                                                             |
| 3   | `.../finance`                           | Which sections the finance dashboard shows, and when the fiscal year starts. An owner or treasurer can start that year's budget period here, with the usual categories at $0.                                                                                                                                                                                                                                                                                                      |
| 4   | `.../teams`                             | Teams, each with a lead and a regular meeting. They're published as the org chart: the first team is the top and the rest report to it. The meetings can be added to the calendar for the next 12 weeks (off until asked for). Also: whether members see each other's busy times.                                                                                                                                                                                                  |
| 5   | `.../pulse`                             | The weekly pulse: the day (a Mon to Sun segmented control, Friday by default), the time (5 PM), who gets it (Everyone, or Officers: owners, admins and treasurers) and how (in the app, email). Saved to `OrgSettings` (`pulseEnabled`, `pulseDay`, `pulseHourLocal`, `pulseAudience`, `pulseInApp`, `pulseEmail`) through `src/server/onboarding/pulse.ts`, the same saver as Admin panel › Weekly pulse. **Don't send one** turns it off. The pulse itself: `src/server/pulse/`. |
| 6   | `.../invite`                            | Invite officers by email (the same invites as Settings › Members, valid for 7 days, as Admin, Treasurer or Member) and share the invite code.                                                                                                                                                                                                                                                                                                                                      |
| 7   | `.../data`                              | Connect tools: the club's real connections (club website data, Google Calendar, email sender, Claude), with live status. **Connect** opens the guided setup for that service, which tests it; you come back with **← Back to organization setup**. All optional: the club's data is stored in Bananasplit from the start, so **Continue** always works (with nothing connected it marks them skipped).                                                                             |
| 8   | `.../bring`                             | Bring things in: events, polls and tasks from the creator's Personal space. Skipped when there's nothing to bring.                                                                                                                                                                                                                                                                                                                                                                 |
| End | `/app/<url>?welcome=1`                  | The club's Overview, as its admin, with the invite code ready to share.                                                                                                                                                                                                                                                                                                                                                                                                            |

Steps 2 to 8 are for owners and admins. Anyone else who opens them is told so.
Everything can be changed later in Settings, the Org Chart, Finance and
Databases.

## Many organizations

Any number of clubs can use the same Bananasplit. One person can belong to
several of them: the org switcher lists them, and it has **Join with invite
code** and **Create organization**, which runs this same org setup for every
new org.

Anyone with a verified account can create a club. Platform settings can
narrow that:

| Setting                               | What it does                                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `ORG_CREATION_MODE=open`              | The default. Any verified account may. Limits: 3 a day per person, and in production also 1 every 30 days per person and 20 a day overall. |
| `ORG_CREATION_MODE=invite`            | Only people holding a single-use org-creation code from a platform admin.                                                                  |
| `ORG_CREATION_MODE=admins`            | Only `PLATFORM_ADMIN_EMAILS` may create orgs.                                                                                              |
| `PLATFORM_ORG_CREATION_ENABLED=false` | Stops new clubs: only `PLATFORM_ADMIN_EMAILS` may create orgs.                                                                             |

### What is shared and what stays in one org

| Data                                                                                                                               | Belongs to | Who can see it                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Account: email, password, verification                                                                                             | the person | only the sign-in system. Email is never on people pages.                                                                                |
| Profile: name, picture, pronouns, major, year, bio, links, time zone                                                               | the person | the person, and members of any org they share. It's the same profile in every org.                                                      |
| Personal theme                                                                                                                     | the person | only changes their own view.                                                                                                            |
| Availability rules and labels                                                                                                      | the person | only the person (their own table).                                                                                                      |
| Busy hours                                                                                                                         | the person | the person; the admins of orgs they belong to; other members of an org that shares busy times. Asked per org.                           |
| Membership: role and title                                                                                                         | one org    | that org. The title starts as the one picked in profile setup, and each org's admins can change it separately.                          |
| Everything else: tasks, notes, calendar, polls, finance, databases, reports, org chart, invite code, integrations, settings, audit | one org    | only that org's members, with each feature's own rules (finance: owner and treasurer; invite code and integrations: owners and admins). |

**How the database keeps orgs apart.** Every org-owned row carries its org's
id. The app runs each request as one of four restricted database roles.
Row-level security then lets a query see and change only rows of the org the
person is in right now, and only if they're a member of it. A bug in a page
can't show another org's data, because the database won't return it.

`pnpm test:rls` checks this for every table on every change:

- isolation between orgs;
- one role check per command;
- a catalog that fails when a table is added without a reviewed policy.

The multi-org test (`src/server/onboarding/multi-org.db.test.ts`) runs the
whole story end to end: two founders, one member in both orgs, nothing
crossing between them.

**Leaving and deleting.**

- **Leaving an org** removes only that membership. The profile, the
  availability and the other orgs are untouched.
- **Deleting an org** removes everything it owns after a 30-day grace period.
  Its people keep their accounts.
- **Org exports** contain only that org's rows. They never include anyone's
  profile, availability or the invite code.

## Where it lives

- Pages: `src/app/onboarding/**`. Shared cards and controls:
  `src/components/onboarding/`.
- Step lists and input rules: `src/lib/onboarding/`. Availability rules:
  `src/lib/availability`. Personal theme: `src/lib/theme/personal.ts`.
  Invite-code format: `src/lib/join-code.ts`.
- Server: `src/server/onboarding/` (profile saves, invite codes, org setup,
  the weekly pulse settings).
- Database: migrations `20260929120000_onboarding_flow` and
  `20260930120000_private_availability`.
  - The new user columns are `onboardedAt`, `preferredTitle` and
    `themePreference`. Users can update them on their own row only.
  - Availability is in `UserAvailability`, which is owner-only. Other members
    get busy hours through `app.member_busy_hours(user)`, which checks that
    both people are in the same org and applies the org's setting.
  - The `OrgJoinCode` table is read and written by owners and admins only.
    Someone who isn't a member yet reaches it only through
    `app.org_by_join_code(code)`, which answers verified callers only.
  - New columns: `DatabaseDefinition.tag`, and on `OrgSettings`,
    `financeDashboardCards` and `showMemberAvailability`.
  - The database-security suite (`pnpm test:rls`) covers all of it: tests
    `P-ONB-01` to `P-ONB-07`.
