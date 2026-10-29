# Link previews

What a Bananasplit link looks like when it is pasted into iMessage, Slack,
X, WhatsApp or Discord: a title, a line, and a picture. Everything here is
built so that an unfurl costs nothing to serve — no image is rendered per
request.

## The two halves

**Pages whose words never change** get a drawn card committed beside them
as `opengraph-image.png`. The drawings live in
`src/components/marketing/og/og-cards.tsx`, are rendered at `/dev/og/<card>`
and are captured into place by `scripts/capture-og.mjs`, which reads the
card → file list in `scripts/og-cards.json` and writes each image's
`.alt.txt` beside it. They are static files on the CDN.

**Pages about one club** — an invite link, a texted invite code, a poll,
an event — say the club's name in the title and use the logo the club
already uploaded as the picture (`clubShare` in `src/lib/metadata/share.ts`).
Every one of those callers is a layout that has already loaded the club to
theme the page, and the logo's variants are public and cached immutably, so
the preview adds no read and no render. A club that has not uploaded a logo
gets a drawn card from `public/og` (`FALLBACK_CARDS`).

Those club pages must not have an `opengraph-image.png` beside them: a file
there outranks whatever `generateMetadata` says, so the club's logo would
never show. `og-cards.test.ts` fails if one appears.

| Route                                  | Title                                               | Picture                                 |
| -------------------------------------- | --------------------------------------------------- | --------------------------------------- |
| `/`                                    | The workspace that runs itself                      | the home card                           |
| `/pricing`, `/demo`, `/product/[slug]` | the page's own                                      | that page's card                        |
| `/join/[code]` (texted invite code)    | You've been invited to join **club** on Bananasplit | the club's logo                         |
| `/onboarding/join`                     | Join your club                                      | the join card                           |
| `/invite/[token]`                      | You've been invited to join **club** on Bananasplit | the club's logo                         |
| `/poll/[pollId]`                       | **club** is finding a time                          | the club's logo                         |
| `/e/[slug]`                            | the event, hosted by **club**                       | the event's cover, else the club's logo |

`src/app/layout.tsx` holds the floor under all of it: `metadataBase` (so
relative image URLs resolve to the site's own domain rather than the
deployment host) and the site name. It deliberately does **not** name a
title or line inside `openGraph`: metadata is merged shallowly, and Next
fills `og:title` and `og:description` per route from that route's own
title, so naming them there would make every page preview as the home page.

## Favicons

A club's pages wear the club's picture in the browser tab, through the same
stored logo (`clubIcons`): the in-app shell (`/app/[orgSlug]`), the invite
link, the poll and the public event page. Anything else, and any club
without a logo, keeps the banana (`SITE_ICONS`). The banana files live in
`public/` and are declared in the root layout, not as `src/app/favicon.ico`:
Next adds a file-convention favicon to every page, so a club page could never
fully replace it.

## Redrawing a card

```
pnpm dev                       # or any port, with CAPTURE_BASE_URL
node scripts/capture-og.mjs    # all cards, or name the ones you changed
```

`og-cards.test.ts` fails if a drawing has no row in the manifest or a row
points at a drawing that is gone.

## The texted invite code

The link an officer copies (Settings > Members, the club's dashboard,
onboarding's invite step) is `/join/<code>`, a public page: the club's name
and logo, then Continue into the real join at `/onboarding/join?code=`, which
asks for an account if there isn't one and checks everything again for a
verified one (the allowed domain, the member cap). Older
`/onboarding/join?code=` links still work; they preview as the plain join
card, because that page is behind sign-in.

The page learns the club from `app.join_code_org_id` (migration
`20261029120000_join_code_preview`), a service-only definer function that
gives the org's id for a code that is turned on in an org that is not being
deleted, and nothing else. `app.org_by_join_code`, which also returns the
allowed domain and member count, still answers only a signed-in caller with
a verified email. Holding a code now tells you which club it opens before you
sign in, as an emailed invite link already did. Lookups are capped at 60 an
hour per client IP (`join-preview-ip`), so the page can't be used to sweep
codes for club names; over the cap it just doesn't name a club. A string that
can't be a code never reaches the database.
