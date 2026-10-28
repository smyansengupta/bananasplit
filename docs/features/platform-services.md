# Platform services: setup

The services behind every feature: background jobs and email, encrypted
integration secrets, file storage and images, rate limits and the health
check. Most of this is configured once per deployment by whoever runs the
platform; the only per-org choice is the email sender.

## For an org

**Email.** Until your org connects its own sender (Settings > Integrations >
Email sender, on a domain you have verified in Resend), notification email
(task assignments, reminders, digests, expense status) either:

- goes out from the platform sender "on behalf of" your org, if your org was
  set up with the platform fallback (the Claude Builders Club is); or
- is not sent: members get in-app notifications only. Settings >
  Integrations says which applies.

Invitations always go out (from your sender if you have one, otherwise the
platform sender). Each member chooses which notifications also email them in
Settings > Notifications.

**Integration keys** (Claude, Resend, Google Calendar, the website database,
the website build hook) are encrypted when saved and never shown again:
Settings shows only the last four characters and the status. Owners and
admins can save, replace and test keys; only owners can remove them. Every
change is recorded in the org's audit log and emailed to all owners.

## For the platform operator

| What | Where |
|---|---|
| Job drain | `/api/cron/jobs` with `CRON_SECRET`: Vercel Cron (Pro, every 5 min) or the `Jobs pinger` GitHub workflow (Hobby, every 15 min); see RUNBOOK step 8 |
| Platform sender | `RESEND_API_KEY`, `EMAIL_FROM` on the app's own verified domain; `EMAIL_DELIVERY` = `live`, `sink` or `off` |
| Secrets keyring | `SECRETS_KEK_V1`, `SECRETS_KEK_CURRENT`, `SECRETS_FINGERPRINT_KEY`; rotation with `pnpm secrets:rotate-kek` (RUNBOOK step 9) |
| File storage | Optional. `BLOB_READ_WRITE_TOKEN` (private: receipts, exports, org-chart sources, Notes files), `BLOB_PUBLIC_READ_WRITE_TOKEN` (public: avatars, logos). Without them files are kept in Postgres (`StoredBlob`, reached only through `app.blob_*`, app_service); `FILE_STORAGE=database` forces that |
| Previews | their own Blob stores, KEK and `CRON_SECRET`; no live mail; `PREVIEW_BLOB_STORE_ID`, `PREVIEW_PUBLIC_BLOB_STORE_ID`, `PREVIEW_KEK_FINGERPRINT`, `SECRETS_KEK_ENV=preview`; jobs drain only on a database marked `app.fixture_only = 'on'` |
| Health | `GET /api/health` (details with the `CRON_SECRET` bearer); RUNBOOK step 7 |

Rate limits (Postgres-backed, shared by every instance): sign-in 30 per 15
minutes per IP and 10 per 15 minutes per email; sign-up 5 per hour per IP and
3 per hour per email; invitations 20 per hour per org; poll responses 30 per
minute per IP; receipt uploads 20 per hour per user; the ICS feed 60 per hour
per link; org creation 3 per day per user; new confirmation links 3 per hour
per user; AI connector requests 600 per hour per connected app, and
connecting an app (`/connect`'s Continue) 20 per hour per user
(docs/features/ai-connectors.md). A daily maintenance job prunes old rate-limit buckets and finished
jobs, and deletes password sign-ups never verified within 72 hours (no
Google account, no membership).

**Email verification.** A password sign-up gets a confirmation email from the
platform sender; the link opens `/verify-email/<token>`, where the user
presses "Confirm email" (valid 24 hours; a signed-in user can ask for a new
link there). A verified Google sign-in for the same address replaces an
unconfirmed password account that never joined an org. This needs the
platform sender (`RESEND_API_KEY`, `EMAIL_FROM`) in production.

## Storage limits

Each space's storage is `Organization.storageUsedBytes` (files, receipts,
note history, the trash), kept by database triggers. Uploads check it and
the plan (`PLAN_LIMITS`) before they start and again in the row's
transaction. Notes files over 4 MB go straight from the browser to the
private Vercel Blob store (`POST /api/orgs/{orgId}/files/uploads`, then
`.../upload-token`, then `.../complete`); without `BLOB_READ_WRITE_TOKEN`
the upload route takes files up to 25 MB (4 MB on Vercel). Downloads stream
from the store. A trashed file's row is deleted when the trash is emptied
(the uploader, or an owner or admin for shared files) or by the nightly
purge after `NOTE_TRASH_DAYS`; only trashed rows can be deleted (OrgFile
DELETE policies), and the trigger takes their bytes off the counter. The
daily `storage-reconcile` job (heavy, from the cron) re-adds every space,
repairs a counter that disagrees through `app.storage_reconcile` (service
path, its org context only) and logs `[storage] repaired drift`, and
deletes direct uploads that never got a row after a day.

## Local development

Nothing to configure: with no Resend key, mail is written to the console and
`.data/mail/` (open the `.html` files); with no Blob tokens, files go to
`.data/blob/`. Mail from a click is sent right after the request; everything
scheduled (reminders, digests, maintenance) runs with `pnpm jobs:drain`
(`--watch` to keep it running, `--maintenance` to include the daily jobs).
