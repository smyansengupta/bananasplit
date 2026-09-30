# Launch: one org tonight, two orgs within two days

A checklist for putting the onboarding build in front of real people. The
first deploy itself (Supabase project, roles, Vercel) is in `RUNBOOK.md`;
this is what comes on top of it.

## Before anyone signs up

1. **Merge the branch** (`suite/onboarding-flow`) into `main` through a PR.
   Vercel's build runs `prisma migrate deploy`, which applies the two
   onboarding migrations:
   - `20260929120000_onboarding_flow`: marks every existing user as
     onboarded, so current members skip profile setup.
   - `20260930120000_private_availability`

   Both only add or move things. Neither changes existing data, apart from
   the onboarded mark.
2. **Production environment (Vercel, Production scope).** Check each of these:

   | Variable | Why it matters tonight |
   | --- | --- |
   | `RESEND_API_KEY`, `EMAIL_FROM` (on a domain verified in Resend) | **Required.** Every new account must verify its email before it can join or create an org, and the link comes by email. Without a sender, new members are stuck. The alternative is Google sign-in (`AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`): Google-verified addresses count as verified. |
   | `BLOB_READ_WRITE_TOKEN`, `BLOB_PUBLIC_READ_WRITE_TOKEN` | Profile pictures (step A1) and org logos. Without them, uploads fail. The rest of the flow still works. |
   | `NEXT_PUBLIC_APP_URL` (https) | The invite link admins share (`/onboarding/join?code=...`). |
   | `AUTH_SECRET`, `CRON_SECRET`, `SECRETS_KEK_V1`, `SECRETS_KEK_CURRENT`, `SECRETS_FINGERPRINT_KEY`, the three role passwords | As in `RUNBOOK.md`. `/api/health` fails without them. |
   | `PLATFORM_ADMIN_EMAILS` | Your address. Only platform admins can create an org while creation is locked. |
   | `SIGNUP_LIMIT_PER_IP_HOUR`, `SIGNIN_LIMIT_PER_IP_15MIN` | Optional. The defaults (40 and 120) fit a room signing up on one campus network. Raise them for a big event. |

3. **Health check.** `curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/health`
   must return `"status":"ok"`.
4. **Background jobs.** Mail goes out right after the request that queues it.
   Reminders, digests and syncs need the jobs drain: either Vercel Pro with
   `/api/cron/jobs` every 5 minutes, or the GitHub `Jobs pinger`
   (`JOBS_DRAIN_URL` + `CRON_SECRET` repository secrets). See `RUNBOOK.md`
   step 8.

## Tonight: your own org

1. Sign in with your platform-admin address and finish profile setup.
2. **If the org doesn't exist in production yet:** choose **Create an
   organization** and walk B1-B5. Skip any connection you don't have
   credentials for; you can connect it later.

   **If it already exists:** open Settings › Members › Invite code.
3. Share the invite link. Members sign up, verify their email, set up their
   profile, enter the code, and see your org's name before they join.
   - Limit the code to your school's email domain if every member has one.
   - Turn the code off after the meeting if you like.
4. **Smoke test with a second account** before the room does: sign up, verify,
   finish profile setup, join with the code. Then check that you, as the
   admin, got the "joined with the invite code" notification.

## Within two days: the second org

Keep creation closed to the public and hand out a single-use code:

1. Set `PLATFORM_ORG_CREATION_ENABLED=true` and `ORG_CREATION_MODE=invite` in
   Vercel, then redeploy.
2. As platform admin, open `/app/platform/org-codes` and issue a code, with a
   note naming the club. Codes are single use and expire after 14 days.
3. The other club's president signs up, verifies, does profile setup, and
   chooses **Create an organization**. They enter the code on B1, walk B2-B5,
   and land on their org as its owner, with their own invite code to share.

Nothing is shared between the two orgs except each person's own profile.
- Each org's data, members' titles, invite code and settings stay in that org,
  enforced by the database.
- Someone in both orgs has one account and switches between orgs from the org
  switcher.
- The details are in `docs/features/onboarding-flows.md`, "Many organizations".

**Before the second org goes live, agree with them who is responsible for
their members' data** (the open question in the handoff). The software keeps
their data separate. It doesn't decide who answers for it.

## If something goes wrong

- **Someone can't join:** the error message says which check failed (email
  not verified, code turned off or replaced, email domain not allowed).
  Admins can make a new code, or send an email invite from Settings › Members.
- **Someone is stuck on "Check your email":** "Resend verification email" is on
  the page. If mail isn't arriving at all, check Resend's dashboard and
  `EMAIL_FROM`.
- **Rolling back:** redeploy the previous build in Vercel. The migrations only
  add or move things, so the older build still runs against the migrated
  database, except that it wouldn't show onboarding.
