# CRM inbound email (Cloudflare Email Worker)

Replies to CRM email and each member's BCC logging address arrive on one
domain of ours (for example `in.bananasplit.app`). Cloudflare Email Routing
hands every message on that domain to this Worker, which parses it with
`postal-mime` and POSTs it to the app's `/api/crm/inbound` with a shared
secret. The app finds the organization from the address
(`reply+{token}@` or `log+{token}@`) and logs the reply, stops the
sequence, reads bounces and out-of-office replies
(`src/server/crm/outreach/inbound.ts`).

This is set up once per deployment, not per organization. Email Routing and
Workers on the free plan cover it.

## What you need

- A domain (or subdomain) on Cloudflare used only for this, for example
  `in.bananasplit.app`. Its mail (MX) records must point at Cloudflare, so
  don't use a domain that already receives mail elsewhere.
- Node.js 20 or later on the machine you deploy from.
- A long random secret, 24 characters or more. For example:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## Steps

1. **Add the domain to Cloudflare.** In the Cloudflare dashboard, Add a
   domain (or use a subdomain of a domain already there), and switch its
   nameservers if Cloudflare asks.
2. **Turn on Email Routing.** Open the domain, then Email, then Email
   Routing, and select Enable. Let Cloudflare add the MX and TXT records it
   lists.
3. **Deploy this Worker.** From this folder:

   ```sh
   npm install
   npx wrangler login
   ```

   Set `INBOUND_URL` in `wrangler.toml` to your app's address,
   `https://<your app>/api/crm/inbound`. Then set the secret (paste the
   value when asked) and deploy:

   ```sh
   npx wrangler secret put INBOUND_SECRET
   npx wrangler deploy
   ```

4. **Send all of the domain's mail to the Worker.** In Email Routing, open
   Routing rules, edit the Catch-all address, set the action to Send to a
   Worker, pick `bananasplit-crm-inbound`, and save. Make sure the
   catch-all is enabled.
5. **Tell the app.** In the app's environment (Vercel: Settings,
   Environment Variables), set:

   - `CRM_INBOUND_DOMAIN`: the domain from step 1, for example
     `in.bananasplit.app`.
   - `CRM_INBOUND_SECRET`: the same secret as `INBOUND_SECRET` above.

   Redeploy the app so it picks them up.

## Check it

- Send an email from a CRM record, reply to it from the other mailbox, and
  the reply shows on the person's timeline within a minute.
- `npx wrangler tail` shows each message the Worker handles.
- In the app's logs, `/api/crm/inbound` answers 401 when the two secrets
  don't match and 503 when `CRM_INBOUND_DOMAIN` isn't set.

## Who really sent it

The Worker reads the SPF, DKIM and DMARC results Cloudflare records in the
message's `Authentication-Results` (or `ARC-Authentication-Results`)
header, only under Cloudflare's own name (`AUTHSERV_ID` in
`wrangler.toml`, `mx.cloudflare.net` by default) and only the topmost one,
and sends the app a verdict: `pass`, `fail` or `none`. The app acts on a
message as coming from its From address only on `pass`. After deploying,
send yourself a reply and check with `npx wrangler tail` that the verdict
is `pass`: if Cloudflare's results don't reach the Worker, every message
reads as `none` and the app ignores replies.

## How it behaves

- The app answers 200 for mail it takes or deliberately ignores (nobody
  the CRM knows). The Worker accepts it either way.
- A 400 (not a message it can read) or 413 (too large) means the app will
  never take that message; the Worker accepts and drops it rather than
  bouncing mail nobody can fix.
- Anything else (401 when the secrets don't match, 429, 503 when
  `CRM_INBOUND_DOMAIN` isn't set, a 5xx, or no answer): the Worker rejects
  the message, so the sender gets a bounce asking them to send it again.
  Nothing is dropped silently while the setup is wrong.
- Messages over 10 MB are rejected. Text and HTML are trimmed to stay under
  the app's 2 MB limit.

## Rotating the secret

Set a new value on both sides: `npx wrangler secret put INBOUND_SECRET`
here, and `CRM_INBOUND_SECRET` on the app, then redeploy the app. Mail that
arrives between the two changes is bounced with a request to send again.

This folder isn't part of the Next.js app: the app's TypeScript, lint and
tests skip `workers/`.
