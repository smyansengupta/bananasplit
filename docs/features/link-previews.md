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

**Pages about one club** — an invite link, a poll, an event — say the
club's name in the title and use the logo the club already uploaded as the
picture (`clubShare` in `src/lib/metadata/share.ts`). Every one of those
callers is a layout that has already loaded the club to theme the page, and
the logo's variants are public and cached immutably, so the preview adds no
read and no render. A club that has not uploaded a logo falls back to that
route's drawn card.

| Route                                  | Title                                          | Picture                                 |
| -------------------------------------- | ---------------------------------------------- | --------------------------------------- |
| `/`                                    | The workspace that runs itself                 | the home card                           |
| `/pricing`, `/demo`, `/product/[slug]` | the page's own                                 | that page's card                        |
| `/onboarding/join`                     | Join your club                                 | the join card                           |
| `/invite/[token]`                      | You're invited to join **club** on Bananasplit | the club's logo                         |
| `/poll/[pollId]`                       | **club** is finding a time                     | the club's logo                         |
| `/e/[slug]`                            | the event, hosted by **club**                  | the event's cover, else the club's logo |

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
without a logo, keeps the banana (`src/app/icon.svg`).

## Redrawing a card

```
pnpm dev                       # or any port, with CAPTURE_BASE_URL
node scripts/capture-og.mjs    # all cards, or name the ones you changed
```

`og-cards.test.ts` fails if a drawing has no row in the manifest or a row
points at a drawing that is gone.

## What is not covered

The invite **code** link an officer shares, `/onboarding/join?code=…`,
cannot name the club. The page is behind sign-in, so whatever fetches the
link to build a preview is redirected to `/sign-in` and never sees the
page's metadata; and the lookup from a code to an org
(`app.org_by_join_code`) deliberately answers only a signed-in caller with
a verified email. Naming the club in that preview needs a public landing
page for the code and a definer function that answers anonymously — which
means accepting that holding a code reveals which club it opens. That is a
decision, not an oversight.
