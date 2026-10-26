# Switching on Google Meet, Zoom and Teams

This is a **one-time platform setup**, done by whoever runs Bananasplit — not by
each club. Bananasplit needs an OAuth app with each provider. Once one exists and
its ID and secret are in the deployment's environment, every club's owners and
admins can connect their own account in one click from **Meetings › Video
calls**, and meetings are created in that club's account.

Until then the Video calls bar tells club admins it isn't switched on yet, and
tells platform admins (`PLATFORM_ADMIN_EMAILS`) which variables are missing.

Each provider is independent: set up only the ones you want.

## What every provider needs from you

| | Value |
|---|---|
| App URL | Whatever `NEXT_PUBLIC_APP_URL` is in production, e.g. `https://bananasplit.fyi` |
| Redirect URI | `{App URL}/api/integrations/conference/{provider}/callback` |

The three redirect URIs, for `https://bananasplit.fyi`:

```
https://bananasplit.fyi/api/integrations/conference/google-meet/callback
https://bananasplit.fyi/api/integrations/conference/zoom/callback
https://bananasplit.fyi/api/integrations/conference/microsoft-teams/callback
```

They must match exactly — scheme, host, no trailing slash. For a preview or local
copy, add that copy's URL too (e.g. `http://localhost:3000/...`); the providers
accept several.

---

## Google Meet

In the [Google Cloud console](https://console.cloud.google.com/), in the same
project as Google sign-in or a new one:

1. **APIs & Services › Library** → enable **Google Meet REST API**.
2. **APIs & Services › OAuth consent screen** → External. Add the scope
   `https://www.googleapis.com/auth/meetings.space.created` (plus `openid` and
   `email`).
3. **APIs & Services › Credentials › Create credentials › OAuth client ID** →
   type **Web application**. Under *Authorised redirect URIs*, add the
   google-meet URI above.
4. Copy the client ID and secret into the environment:

```
GOOGLE_MEET_CLIENT_ID=
GOOGLE_MEET_CLIENT_SECRET=
```

This is deliberately a **separate client** from Google Calendar's
(`GOOGLE_CALENDAR_CLIENT_ID`), so connecting one never re-prompts for the other.
It can live in the same Cloud project.

> **Check before launch:** Google rates `meetings.space.created` as a
> [*Sensitive* scope](https://developers.google.com/workspace/meet/api/guides/authenticate-authorize)
> — not *Restricted*, so no third-party security assessment.
>
> - While the consent screen is in *Testing*, only the test users you list can
>   connect, and their grants expire after seven days.
> - Moving it to *Production* means submitting the app for Google's
>   [verification](https://support.google.com/cloud/answer/7454865). Until that
>   finishes, people who connect see an "unverified app" screen first, and the
>   app stops at 100 new users.

## Zoom

In the [Zoom App Marketplace](https://marketplace.zoom.us/develop/create):

1. **Develop › Build App › General App** (user-managed OAuth — *not*
   Server-to-Server, which can't act on behalf of a club's own account).
2. **Basic information**: set the *OAuth Redirect URL* to the zoom URI above, and
   add the same URL to the *OAuth Allow List*.
3. **Scopes**: add
   - `meeting:write:meeting`
   - `meeting:update:meeting`
   - `meeting:delete:meeting`
   - `user:read:user`
4. Copy the client ID and secret:

```
ZOOM_CLIENT_ID=
ZOOM_CLIENT_SECRET=
```

> The scope names above are Zoom's *granular* scopes and must match what the app
> was given. If a club's meeting fails with Zoom error **4700**, the app is
> missing a scope — Bananasplit's error message names which one.
>
> Until the app is published on the Marketplace, only users on your own Zoom
> account can authorise it.

## Microsoft Teams

In the [Azure portal](https://portal.azure.com/) → **Microsoft Entra ID › App
registrations › New registration**:

1. **Supported account types**: *Accounts in any organisational directory and
   personal Microsoft accounts* — this is what lets any club connect. (A
   single-organisation app works too; set `MICROSOFT_TEAMS_TENANT` to its tenant
   ID, below.)
2. **Redirect URI**: platform **Web**, the microsoft-teams URI above.
3. **Certificates & secrets › New client secret** — copy the *Value* straight
   away; Azure only shows it once. Note when it expires.
4. **API permissions › Add a permission › Microsoft Graph › Delegated**:
   `OnlineMeetings.ReadWrite`, `offline_access`, `openid`, `email`.
5. Copy the *Application (client) ID* and the secret:

```
MICROSOFT_TEAMS_CLIENT_ID=
MICROSOFT_TEAMS_CLIENT_SECRET=
# Only for a single-organisation app; leave unset for "common".
MICROSOFT_TEAMS_TENANT=
```

> A Teams meeting needs a work or school account with a Teams licence; personal
> Microsoft accounts can sign in but Graph may refuse to create the meeting.

---

## Putting the values in

On Vercel: **Project › Settings › Environment Variables**, scope **Production**,
then **redeploy** — environment variables are read when the app starts, so a
running deployment won't see new ones.

Locally: the same names in `.env` (`.env.example` lists them), then restart the
server.

## Checking it worked

1. Open **Meetings** as a club owner or admin. The provider now appears in the
   Video calls bar with **Connect**.
2. Press it, sign in with the account that club's meetings should live in, and
   approve. You land back on Meetings with "Connected".
3. Make a meeting, pick that provider as the video call, save. The join link
   appears on the meeting a second or two later.
4. Check that reconnecting picks up what was waiting. Press **Disconnect**
   beside the provider in the Video calls bar and confirm. Meetings already
   made keep their links, and the provider goes back to **Connect**. A meeting
   saved while the provider is disconnected has nothing to join yet (for
   instance one saved from a New meeting form that was already open when you
   disconnected): its page says "No join link yet." Press **Connect** again
   and approve. You land on Meetings with "Connected", and a second or two
   later that meeting has its join link. Meetings left failed by an expired
   connection are picked up the same way.

If step 2 comes back with an error, the message says what went wrong: a wrong
redirect URI, a missing scope, or offline access not granted.

## Disconnecting a club

Owners and admins can press **Disconnect** beside a connected provider on the
same bar. It asks first, because changing or cancelling meetings already made
stops reaching the provider until someone connects again; their links stay.

Disconnect revokes Bananasplit's access at the provider. Teams has no revoke
call, so for Teams, and for any revoke that fails, the message tells the person
to remove Bananasplit from that account's connected apps themselves. Only an
owner's Disconnect also deletes the stored refresh token; an admin's leaves it
encrypted, already revoked, until an owner removes it. A token that could not
be revoked is never deleted, so nobody is left holding a live grant they can
no longer revoke.
