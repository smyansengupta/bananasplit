# Settings: setting up an organization

Everything an organization configures lives in **Settings** (`/app/<your-url>/settings`).
Each org has its own members, keys, sender, privacy rules and data: two clubs never share
credentials or see each other's data. Owners and admins see all sections; members see Members,
Notifications and Calendar feed.

| Section | Who | What |
|---|---|---|
| General | owners, admins | Name, logo, timezone. The URL: owners only. |
| Members | everyone sees the roster; owners, admins manage | Invite, resend, revoke; roles; titles; remove; transfer ownership; leave |
| Integrations | owners, admins (remove: owners) | Email sender, Claude API, Google Calendar, website data (Supabase), website build hook |
| Privacy | owners, admins (individual votes: owners) | Ballots, member and contact emails, database visibility, public events feed |
| Audit log | owners, admins | Every settings, member, integration and export change |
| Danger zone | owners | Export all data, bootstrap the CBC workspace, delete the organization |

## First steps for a new organization

1. **Create it.** From the organization switcher choose **Create organization** (`/app/new`),
   or from `/onboarding` if you have no organization yet. Pick a name, a URL and the timezone.
   You become its owner. Who may create organizations is a platform setting (below).
2. **General.** Upload a logo (PNG, JPEG or WebP up to 4 MB; it is resized and its location
   data removed) and check the timezone: weekly updates, reminders, digests and reports use it.
3. **Members.** Invite people by email with a role (Admin, Treasurer or Member). They get a
   link valid for 7 days and must sign in with the invited address, verified, to join. Set
   each person's **title** ("VP Growth"); titles are separate from roles and from the org chart.
4. **Email sender** (Integrations). Until you connect one, notification email either goes
   out from the platform sender on your behalf (if the platform fallback is on for your org)
   or not at all (in-app notifications only). The Integrations page says which applies.
5. **Privacy.** Decide who sees individual votes, whether members see ballot results and
   each other's emails, which databases members can browse, and whether to publish public
   events for your website.
6. Connect the other integrations you need (below).

The Claude Builders Club can then run **Danger zone > Bootstrap CBC workspace** (owners):
it adds the task defaults (one owner and a due date per task), the "Needs President" and
"Design" labels, the Design Requests intake queue, the published org chart, member titles and
the CBC theme. You confirm which member is which person first (pre-filled by name). It adds no
members, and running it again publishes a fresh chart version.

## Roles

- **Owner**: everything, including the URL, removing integrations, exports, deletion and
  granting or revoking ownership. An organization always keeps at least one owner.
- **Admin**: manages members (never owners), settings, integrations and privacy.
- **Treasurer**: finance authority; otherwise a member.
- **Member**: uses the workspace.

Rules, enforced in the app and again in the database: only an owner grants or revokes the
owner role or changes an owner's row; nobody changes their own role; the last owner cannot be
demoted, removed or leave. To hand over, an owner uses **Transfer ownership** on a member's
row (they become owner, you become admin), then may **Leave**.

Removing a member (or a member leaving) takes away their task assignments and event
invitations, makes the open tasks they owned unowned (completed ones keep their history),
clears them as intake triager, turns their org chart position into a placeholder and drops
them from draft chart suggestions. Notes and comments they wrote stay. Someone with an
unreimbursed expense must settle it first.

## General: changing the URL

Owners can change the organization URL (for example `cbc` to `claude-builders-club`). The old
URL keeps working: it redirects (307) to the new one, and it stays reserved for your
organization forever, so nobody else can take it. The public events feed moves to
`/api/public/<new-url>/events`; if your website reads it, update `SUITE_EVENTS_URL` in the
website's Netlify settings (the old feed URL redirects meanwhile). Reserved words (`app`,
`api`, `new`, `settings`, `admin`, `public`, `poll`, `invite`, `onboarding`, `sign-in`,
`sign-up`, `platform`) can't be used.

## Integrations

Keys are **write-only**: they are encrypted when saved (AES-256-GCM with a per-secret key)
and never shown again; pages show only the status and the last four characters. Owners and
admins can save, replace and test; only owners can remove. Every change is recorded in the
audit log and every owner gets a security notification.

### Email sender (Resend)

1. In [Resend](https://resend.com), add a sending domain, for example `mail.yourclub.org`.
2. Add the records Resend lists at your DNS host: SPF, DKIM, the return path, plus a DMARC
   record. For a domain on Netlify DNS: Netlify > Domains > your domain > DNS records.
3. When Resend shows the domain as **verified**, create an API key with full access (the
   domain check reads your domains).
4. In Settings > Integrations > Email sender, enter the from name, a from address on that
   domain, an optional reply-to, and the key. Save runs the domain check.
5. **Send test email** sends one message from your sender to your own address.

Once the domain check passes, notification email goes out from your sender, and the
**platform fallback** switch turns off by itself. Only an owner can flip that switch by hand.
Invitations always go out: from your sender when verified, else from the platform sender.

### Claude API

Create a key at console.anthropic.com (in a workspace your club pays for) and save it with
the default model (Claude Opus 5 recommended). **Test** lists the models the key can use and
checks the default model is among them. The org chart importer uses this key; with
"Retry declined requests" on, a declined document is re-run on Anthropic's recommended
fallback model.

### Google Calendar

Press **Connect Google Calendar** and sign in with the Google account that owns your club's
calendars (for CBC, the club Gmail). The portal asks only to manage the events it creates and
to list your calendars. Then choose the calendar for public events and, optionally, one for
internal events. **Test and refresh calendars** checks the connection. **Start import dry
run** previews bringing existing Google events in (apply it from Calendar > Sync).
**Disconnect** stops mirroring and revokes the access at Google; an owner's disconnect also
deletes the stored token (**Remove** does the same for owners at any time).

### Website data (Supabase)

1. In the website repository, run `supabase/suite-export.sql` in the Supabase SQL editor. It
   creates the `suite_export` functions and the `cbc_suite_reader` role, which can call only
   those functions (no table access).
2. Give the role a strong password: `ALTER ROLE cbc_suite_reader PASSWORD '...';`
3. From Supabase > Connect > Session pooler, copy the project ref (the 20 letters in
   `https://<ref>.supabase.co`), the pooler region and the host prefix (`aws-0` or `aws-1`, as
   in `aws-0-us-east-1.pooler.supabase.com`).
4. Enter them with the role name and password. **Save and test** connects read-only with
   verified TLS and calls `suite_export.contract_version()`.

The host is built from these fields: the portal never connects to an arbitrary host.

### Website build hook (Netlify)

In Netlify: Site configuration > Build & deploy > Build hooks > **Add build hook**. Paste the
URL (`https://api.netlify.com/build_hooks/...`). When public events change, the portal asks
Netlify to rebuild (at most once a minute). **Trigger a test build** starts one build to prove
the hook works.

## Privacy

- **Who can see individual votes**: owners only (default), owners and admins, or nobody.
  Only an owner can change it. With "nobody", individual ballots are also left out of exports.
- **Members see ballot results**: aggregated results, never who voted for what.
- **Smallest result group shown to members**: choices with fewer votes show as "fewer than N".
- **Members see each other's emails** on the Members page (owners and admins always do).
- **Who sees website contacts' emails** in the People, Attendance and Signups databases.
- **Public events feed**: publishes upcoming public events for your website.
- **Databases**: per database, who can browse it (all members, admins, owners, or hidden
  from the members' list).

## Danger zone

**Export all data** (owners, once a day): a zip with every table as JSON lines and CSV
(spreadsheet-safe: cells starting with `=`, `+`, `-` or `@` are neutralized), uploaded
receipts and org chart files, and a manifest of what was left out. Integration keys are never
included. It is prepared in the background; you get a notification linking to the export
page. The download works only for a signed-in owner, from a link made for you that lasts 24
hours; each download is in the audit log; the file is deleted after 7 days.

**Delete organization** (owners): type the URL to confirm. The organization closes for
everyone at once and is deleted for good after **30 days**: members, tasks, notes, events,
finance records, files, integrations (Google access is revoked) and settings. Until then its
URL shows "scheduled for deletion" and any owner can **Cancel deletion** there (it is also
listed in the organization switcher and on `/onboarding`). Its URL is never reused.

## For the platform operator

| Setting | Where |
|---|---|
| Org creation | `PLATFORM_ADMIN_EMAILS`, `PLATFORM_ORG_CREATION_ENABLED`, `ORG_CREATION_MODE` (below) |
| Secrets keyring | `SECRETS_KEK_V1`, `SECRETS_KEK_CURRENT`, `SECRETS_FINGERPRINT_KEY` |
| Google Calendar | `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` |
| Supabase TLS | `SUPABASE_ROOT_CA` (optional) |
| Platform sender | `RESEND_API_KEY`, `EMAIL_FROM` (see platform-services.md) |
| Jobs | `/api/cron/jobs` with `CRON_SECRET`; locally `pnpm jobs:drain --watch` |

**Who may create organizations.** Platform admins (verified addresses in
`PLATFORM_ADMIN_EMAILS`) always may. For everyone else `PLATFORM_ORG_CREATION_ENABLED` is the
master switch (default `false` in production, `true` on previews and locally); when on,
`ORG_CREATION_MODE` decides:

- `admins` (production default): platform admins only.
- `invite`: anyone with a single-use **org-creation code**. Platform admins issue codes at
  `/app/platform/org-codes` (shown once, stored hashed, valid 14 days). Codes can't be issued
  while the switch is off.
- `open` (default off production): any verified user; in production one new organization
  per user per 30 days and 20 per day platform-wide.

Every mode keeps a limit of 3 new organizations per user per day, and every creator must have
a verified email.

**Secrets keyring.** Generate each key with
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`: `SECRETS_KEK_V1`
(the key-encryption key), `SECRETS_KEK_CURRENT=1`, and `SECRETS_FINGERPRINT_KEY`. Keep a copy of
the KEK outside Vercel (losing it makes every stored key unreadable; orgs would re-enter
them). Previews get their own keyring (`SECRETS_KEK_ENV=preview`), never production's. To
rotate: add `SECRETS_KEK_V2`, set `SECRETS_KEK_CURRENT=2`, run `pnpm secrets:rotate-kek`, and
remove V1 once every secret is rewrapped (RUNBOOK).

**Google OAuth client.** In Google Cloud Console create a project (separate from the sign-in
client), enable the Google Calendar API, and configure the OAuth consent screen: app name,
support email, the authorized domain of the portal, homepage and privacy-policy URLs, and the
scopes `openid`, `email`, `https://www.googleapis.com/auth/calendar.events.owned` and
`https://www.googleapis.com/auth/calendar.calendarlist.readonly`. Publish the app (in Testing
mode refresh tokens expire after about 7 days) and complete Google's verification for the
sensitive scope. Create an OAuth client of type Web application with the authorized redirect
URI `<NEXT_PUBLIC_APP_URL>/api/integrations/google-calendar/callback`, and set
`GOOGLE_CALENDAR_CLIENT_ID` / `_SECRET`.

**Sending domains.** The platform sender needs its own verified domain (for example a
subdomain of the portal's domain, records added by whoever owns the DNS zone, for
claudeneu.com in Netlify DNS). An org's own sender (for example `mail.claudeneu.com` for CBC)
is verified the same way in that org's Resend account. The platform fallback flag
(`OrgSettings.platformMailFallback`) is on for organizations that existed when Phase 1
shipped (CBC) and off for new ones.

**Local development.** Nothing to configure: mail goes to `.data/mail/`, files to
`.data/blob/`, and "Send test email" says it used the mail sink. Google Calendar needs a real
OAuth client, so locally the Connect button is disabled; the flow is covered by tests with a
mocked Google.
