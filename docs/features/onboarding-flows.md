# Onboarding: profile setup and creating an organization

Two flows, from the design in the "Onboarding flows" flowchart:

- **Flow A, profile setup.** Every new member runs it once, right after
  signing up. People who already had an account before it shipped skip it.
- **Flow B, create an organization.** Only for the person creating one. They
  become its owner.

Both flows are one card per step, with a segmented progress bar and a label
above the card (`A1 · Basics`, `B3 · Label sources`). They use the app's theme
tokens, so they look like the rest of the app in light and dark. Every step
saves when you press **Continue**, so leaving halfway loses nothing, and each
step has its own URL.

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

**Availability.** It is stored on your own row. Other members only ever see
busy or free for each hour of a typical week, on your people page, and never
the labels ("Lab section"), the dates, or the reasons. Org admins can turn
that off for members (B5). Admins and you always see it.

## Joining (A7, `/onboarding/join`)

There are two ways in, and both are checked against the organization before
anyone joins:

1. **Invite code.** Each org has one shareable code (`ABCD-EFGH`) and a link
   that fills it in (`/onboarding/join?code=...`). The person enters it, sees
   which organization it belongs to (name, logo, member count), then presses
   **Join**. The server checks that:
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

Lookups are rate limited per user (10 every 15 minutes). The code comes from a
31-letter alphabet with no look-alikes (0/O, 1/I/L, U), so there are about
8.5 × 10¹¹ possible codes.

**Managing the code:** **Settings › Members › Invite code**, owners and admins
only. From there you can copy the code or the link, turn it off, limit it to an
email domain, or **make a new code**. A new code stops the old one working
immediately. The same card appears on the org's overview right after org setup
finishes (the flowchart's "invite link shown on first load").

## Flow B: create an organization

| Step | Page                                  | What it does                                                                                                                                                                                                                                                                                                     |
| ---- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1   | `/onboarding/organization`            | Name, portal URL (checked as you type) and default time zone, plus an org-creation code where the platform requires one. Creates the org, with you as owner.                                                                                                                                                     |
| B2   | `/onboarding/organization/<url>/data` | The org's real connections (club website data, Google Calendar, email sender, Claude), with live status. **Connect** opens the guided setup for that service, which tests it; you come back with **← Back to organization setup**. **Continue** unlocks once one works. **Skip for now** marks the rest skipped. |
| B3   | `.../labels`                          | A label and a tag (Finance, People, Operations, Events, Other) for each database, and **who can see** each tag's data. That sets the databases' member visibility, which the database enforces.                                                                                                                  |
| B4   | `.../finance`                         | Which sections the finance dashboard shows, and when the fiscal year starts. An owner or treasurer can start that year's budget period here, with the usual categories at $0.                                                                                                                                    |
| B5   | `.../teams`                           | Teams, each with a lead and a regular meeting. They're published as the org chart: the first team is the top and the rest report to it. The meetings are added to the calendar for the next 12 weeks, and mirror to Google Calendar when it's connected. Also: whether members see each other's busy times.      |
| End  | `/app/<url>?welcome=1`                | The org's overview, as its admin, with the invite code ready to share.                                                                                                                                                                                                                                           |

B2-B5 are for owners and admins. Anyone else who opens them is told so.
Everything can be changed later in Settings, the Org Chart, Finance and
Databases.

## Where it lives

- Pages: `src/app/onboarding/**`. Shared cards and controls:
  `src/components/onboarding/`.
- Step lists and input rules: `src/lib/onboarding/`. Availability rules:
  `src/lib/availability`. Personal theme: `src/lib/theme/personal.ts`.
  Invite-code format: `src/lib/join-code.ts`.
- Server: `src/server/onboarding/` (profile saves, invite codes, org setup).
- Database: migration `20260929120000_onboarding_flow`.
  - The new user columns are `onboardedAt`, `preferredTitle`,
    `themePreference` and `availability`. Users can update them on their own
    row only.
  - The `OrgJoinCode` table is read and written by owners and admins only.
    Someone who isn't a member yet reaches it only through
    `app.org_by_join_code(code)`, which answers verified callers only.
  - New columns: `DatabaseDefinition.tag`, and on `OrgSettings`,
    `financeDashboardCards` and `showMemberAvailability`.
  - The database-security suite (`pnpm test:rls`) covers all of it: tests
    `P-ONB-01` to `P-ONB-05`.
