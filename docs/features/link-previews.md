# Link previews

What a Bananasplit link looks like when it is pasted into iMessage, Slack,
X, WhatsApp or Discord: a title, a line, and a picture. Everything here is
built so that an unfurl costs nothing to serve — no image is rendered per
request.

## Three kinds of page

**Thirteen pages have a drawn card of their own**: the home page, pricing,
the demo, the five product pages, log in ("Welcome back"), sign up, and the
fallbacks for an invite, an invite code and a poll. The drawings live in
`src/components/marketing/og/og-cards.tsx`, are rendered at `/dev/og/<card>`
(`/dev/og` shows them all as Messages draws a link) and are captured by
`scripts/capture-og.mjs` into the files `scripts/og-cards.json` lists. Static
files on the CDN: nothing runs per unfurl.

**Pages about one club** (an invite link, a texted invite code, a poll, an
event) say the club's name in the title and use the logo the club already
uploaded as the picture (`clubShare` in `src/lib/metadata/share.ts`). Each
caller is a layout that has already loaded the club to theme the page, and
the logo's variants are public and cached immutably, so this adds no read
and no render. A club with no logo gets its drawn fallback card from
`public/og`; an event with neither a cover nor a logo gets the main card.

**Everything else shows the main card** (`src/app/opengraph-image.png`):
privacy, the password and email pages, connect, checkout, onboarding,
tickets, flyers, and every link into the app (signed out, those reach the
log-in page, which then previews as the main card rather than "Welcome
back"; `signInPreviewFor`). Those pages use `mainShare`, which sets a title
and line but deliberately no `openGraph`: metadata merges shallowly, so a
page with an `openGraph` of its own replaces the root's and loses the main
card's picture.

| Link                                   | Title                                               | Picture                                    |
| -------------------------------------- | --------------------------------------------------- | ------------------------------------------ |
| `/`                                    | Bananasplit: the workspace that runs itself         | the main card                              |
| `/pricing`, `/demo`                    | the page's own                                      | that page's card                           |
| `/product/<slug>`                      | the product's name                                  | that product's card (`public/og`)          |
| `/sign-in`, `/sign-up`                 | Log in, Create your account                         | Welcome back, Start your workspace         |
| `/invite/[token]`, `/join/[code]`      | You've been invited to join **club** on Bananasplit | the club's logo, else the invite/join card |
| `/poll/[pollId]`                       | **club** is finding a time                          | the club's logo, else the poll card        |
| `/e/[slug]`                            | the event, hosted by **club**                       | the cover, else the club's logo, else main |
| anything else, and every `/app/…` link | the page's own, or the site's                       | the main card                              |

Pages that pick their picture in metadata (club pages, product pages,
log in) must not have an `opengraph-image.png` beside them: a file there
outranks `generateMetadata`. `og-cards.test.ts` fails if one appears.

`src/app/layout.tsx` holds the floor: `metadataBase` (so image URLs resolve
to the site's own domain rather than the deployment host), the site name,
and the banana icons.

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

`og-cards.test.ts` fails if a drawing has no row in the manifest, a row
points at a drawing that is gone, or a card in `public/og` isn't named in
`share.ts`.

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
