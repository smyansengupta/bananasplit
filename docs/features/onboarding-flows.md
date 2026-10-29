# Onboarding: an account, then joining or creating an organization

Organization first, with as little to fill in as possible. Every step is one
screen in the home page's look (Graphite, Geist headlines, the banana for the
one action, `src/components/onboarding/setup-shell.tsx`): one card holding
the step, nothing beside or above it. Where a picture helps, the picture is
the editor (meeting types are named right on a week of the calendar). No
stepper and no step counts. Each step has its own URL and saves when you press
**Continue**; anyone can get through it in about three minutes.

## 1. The account

Sign up with Google, or a name, email and password. The first visit to
`/onboarding` posts `readyAccountAction` from the page (rendering writes
nothing, so a prefetch can't): the device's time zone when the account has
none, onboarded, and its Personal space in that zone, with its 14-day trial
of Personal Plus; there is no profile to fill in first. Then:

- where sign-up started, when it started somewhere (`?callbackUrl=`: an invite
  link, "Get started" on the home page, which goes straight to creating an
  organization);
- otherwise **What are you here for?** (`/onboarding/start`): join an
  organization, create one, or just me. Email invites to the address show
  above the three choices, one click to join.

An unverified email can look around; joining or creating an organization
still needs a verified address.

## 2. Joining (`/onboarding/join`, then `/onboarding/join/<org>/profile`)

The 8-character invite code (or its link, or an emailed invite), checked
against the organization before anyone joins (verified email, the code turned
on, the allowed domain, Free's 10-member limit). Then your profile, one
screen: photo, name, time zone (detected from the device), pronouns, bio
and links. Your title there is the admins' to set. Then in.

## 3. Creating an organization

1. **Basics** (`/onboarding/organization`): name, web address (checked as you
   type) and time zone (detected). This creates it with you as owner and
   starts its 14-day trial of Team Advanced, no card.
2. **Setting it up**, `ORG_STEPS` under `/onboarding/organization/<org>/`. No
   step counts or stepper; every step but the profile can be skipped.

| Step       | What it does                                                                                                                                                                                                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `basics`   | Only before Import, for Back: the name and time zone again (the web address changes in Settings › General). Back never offers to make a second organization.                                                                                                                                          |
| `import`   | First after creating it. **Start fresh** (picked to begin with: "Continue in a new workspace"), or one of the apps people leave, with its logo. A CSV or Excel file imports now, into a database; picking an app says its importer is coming soon, and every step still follows (nothing is skipped). |
| `picture`  | The organization's logo, the same upload and crop as Settings › General.                                                                                                                                                                                                                              |
| `labels`   | Task tags: four to start, more one click away, ten colours in a picker over each row.                                                                                                                                                                                                                 |
| `events`   | Meeting types (team meeting, 1:1, standup...), named right on a week of the calendar (`OrgSettings.eventTypes`). A meeting picks one (`Event.meetingType`) and the calendar draws it in that colour.                                                                                                  |
| `teams`    | Team names only, published as the org chart. Leads come later, once people join.                                                                                                                                                                                                                      |
| `emails`   | Your own email notifications (all on for someone who has never chosen, else what you chose; they are account-wide) and the weekly recap for everyone.                                                                                                                                                 |
| `imessage` | Running it all by text (tasks, meetings, money, answers), shown as a thread. The screen only: the texting service isn't connected yet.                                                                                                                                                                |
| `tools`    | The home page's integrations, as buttons; connecting each is in Settings › Integrations.                                                                                                                                                                                                              |
| `invite`   | The invite code and link, and email invites; the box takes a whole pasted list.                                                                                                                                                                                                                       |
| `bring`    | Events, polls, tasks, notes and files from your Personal space. Skipped when there's nothing to bring.                                                                                                                                                                                                |
| `profile`  | Last: your profile, as when joining. Then the organization's Overview, as its owner.                                                                                                                                                                                                                  |

## 4. Just me (`/onboarding/personal/<step>`)

Setting up your personal workspace, `PERSONAL_STEPS`: import, tags, emails,
iMessage, then your profile (no pronouns). No meeting types.

## Previewing locally

`/dev/onboarding/start` (development only) shows every screen with sample
data, no account or database needed; every button moves to the next screen
instead of saving.

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

| Data                                                                                                                               | Belongs to | Who can see it                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account: email, password, verification                                                                                             | the person | only the sign-in system. Email is never on people pages.                                                                                                                                     |
| Profile: name, picture, pronouns, major, year, bio, links, time zone                                                               | the person | the person, and members of any org they share. It's the same profile in every org.                                                                                                           |
| Personal theme                                                                                                                     | the person | only changes their own view.                                                                                                                                                                 |
| Availability rules and labels                                                                                                      | the person | only the person (their own table).                                                                                                                                                           |
| Busy hours                                                                                                                         | the person | the person; the admins of orgs they belong to; other members of an org that shares busy times. Asked per org.                                                                                |
| Membership: role and title                                                                                                         | one org    | that org. The title starts as the one picked in profile setup, and each org's admins can change it separately.                                                                               |
| Everything else: tasks, notes, calendar, polls, finance, databases, reports, org chart, invite code, integrations, settings, audit | one org    | only that org's members, with each feature's own rules (finance: owners, admins and treasurers, and a member sees only their own expenses; invite code and integrations: owners and admins). |

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
