# Themes: setup

Each org picks its own colours, logo display and light or dark default in
**Settings > Theme** (owners and admins). A change applies to every member as
soon as it is saved: no rebuild, no redeploy. The org's public poll and invite
pages wear the same theme and logo.

## For an org

1. Open **Settings > Theme**.
2. **Palette.** Pick a preset, or **Custom** to choose the five colours yourself:
   - **Moonstone** (the Default, id `default`): graphite and pearl with no fill
     colour of its own, lit by a banana glow (the light behind the page top, the
     halo on create buttons, the active item and focus). Dark first: an org with
     no theme opens in dark mode. Primary and accent are one colour (pearl in
     dark, ink in light).
   - **Banana night** (id `night`): graphite greys with banana as the accent.
   - **Banana cream** (id `cream`): the look before the redesign: cream paper,
     ink type and an ink primary with a banana highlighter; in dark mode,
     ink-dark paper with a banana primary. A row saved as `default` with the
     cream (or the earlier raspberry) palette follows the brand onto Moonstone
     (`isFormerDefault`, `presets.ts`).
   - **Paper & Coral** (id `cbc`): warm paper, ink text, terracotta links and a
     coral highlighter, from the Claude Builders Club website's design system. In
     dark mode the coral becomes the primary with an ink label.
   - **Harbor** (blue), **Evergreen** (green), **Orchid** (violet), **Sunset**
     (orange), **Midnight** (indigo).
   - **Graphite**: neutral greys with a near-black primary, the built-in look
     before Bananasplit. An org that saved the old Default keeps it: those rows
     still say `default` with the grey palettes, and `savedPresetId`
     (`presets.ts`) reports them as Graphite.

   Every preset passes WCAG AA in light and dark.

3. **Custom colours.** Five roles per mode: primary (buttons, links, focus ring),
   accent (highlights, hover tints; a fill, rarely text), background (the page),
   surface (cards, dialogs, menus) and text. Each has a colour picker and a hex
   field; only six-digit hex values like `#a34a2a` are accepted. Dark is derived
   from Light (a near-black page, primary and accent lightened until they read on
   it) until you switch off **Derive dark from light** and pick the dark colours
   yourself. Everything else (borders, muted text, hover states, success and
   warning colours, the chart palette) is derived from the five roles.
4. **Preview.** Both modes render side by side with unsaved changes. **Preview on
   the whole app** applies the draft to the real app until you save, discard or
   leave the page.
5. **Contrast check.** The important text and background pairs are checked in both
   modes against WCAG AA (4.5:1 for text, 3:1 for the focus ring and chart colours).
   A failing pair shows its ratio, the ratio it needs, and a suggested colour;
   **Apply fix** changes that role just enough to pass every pair it controls. You
   can still save a failing theme (the spec says warn, not block); the warnings are
   stored with it.
6. **Light and dark mode.** Match device (the default), Light or Dark. This is the
   default only: each member can still choose Light, Dark or System in the user
   menu. **Lock the mode for everyone** (Light or Dark only) removes that choice.
7. **Logo display.** Logo and name, Logo only (for a wordmark) or Name only. The
   logo itself is uploaded in **Settings > General**; until there is one, the
   sidebar shows the org's initials in the primary colour.
8. **Save theme.** **Reset to default** returns the org to the Default preset,
   device mode and logo beside the name.

Seeded data: the Claude Builders Club org starts on the Paper & Coral preset.
In production an admin picks it on the Theme page.

## How it works (developers)

- **Tokens.** `src/lib/theme/derive.ts` maps the five roles to the full token set:
  the shadcn tokens in `globals.css` plus `--primary-hover`, `--create` (the
  create button: the accent, or the white surface where the accent is the
  ink itself, as Moonstone's is in light), `--brand-accent`
  (`-foreground`), `--success` (`-foreground`), `--warning` (`-foreground`),
  `--destructive-foreground` and `--chart-1..5`. Tailwind exposes them as
  `bg-primary-hover`, `text-success`, `bg-warning/10`, `bg-brand-accent`,
  `bg-chart-3` and so on. The math is hand-rolled OKLab/OKLCH (`color.ts`), shared
  by the server and the browser, so the preview equals the saved result.
- **Charts.** `chart.ts` builds `--chart-1..5` with the data-viz method: the
  validated reference palette in its fixed order (an achromatic theme like
  Graphite starts `#2a78d6`, `#eb6834` in light, `#3987e5`, `#d95926` in dark,
  and so does Bananasplit's light ink), each slot's lightness snapped
  (hue held) to 3:1 on the page and the cards, a chromatic brand primary as slot 1,
  and every adjacent pair checked for colour-blind separation (deltaE >= 8) and
  normal-vision separation (>= 15). Use the slots in order; never style text with
  a chart colour.
- **Rendering.** The org layout (`src/app/app/[orgSlug]/layout.tsx`) reads the
  `OrgTheme` row with the per-request org context and renders
  `src/components/theme/org-theme-root.tsx`: a server `<style>` with
  `html:root{...}` and `html.dark{...}` (they beat the `globals.css` defaults and
  reach Radix portals on `<body>`), and next-themes with the org's default mode
  (`forcedTheme` when locked). `globals.css` ships the Default preset's derived
  values, so an org without a row looks the same as one on Default.
- **Security.** Every colour is strict hex (`/^#[0-9a-f]{6}$/i`): checked by the
  save action's schema and again when the `<style>` is rendered (`css.ts`). One
  bad value drops the whole sheet and the default theme shows, so nothing in a row
  can inject CSS. Writes are OWNER/ADMIN only in the action and in RLS.
- **CSP.** Unchanged from 0A: `script-src` with the per-request nonce and
  `'strict-dynamic'`, `style-src 'self' 'unsafe-inline'` with no style nonce. The
  theme `<style>` needs no nonce; next-themes gets the nonce for its inline script
  from `getNonce()`. The ThemeProvider is no longer in the root layout (next-themes
  makes a nested provider a pass-through): the org layout, the poll and invite
  layouts (`PublicOrgFrame`) and the other page families (`PublicThemeRoot` in the
  sign-in, sign-up, onboarding, verify-email and `/dev` layouts and on the home
  page) each mount one and pass the nonce.
- **Public pages.** `/poll/[pollId]` and `/invite/[token]` resolve the owning org
  on the service path (`app.poll_org_id`, `app.invitation_by_token_hash`) and read
  its name, logo and theme through `getOrgBranding(orgId)`, an `unstable_cache`
  loader tagged `tags.theme(orgId)` (5-minute backstop). Saving or resetting the
  theme invalidates that tag after commit and refreshes the client router.
- **Libraries.** `globals.css` maps FullCalendar's `--fc-*` and React Flow's
  `--xy-*` variables to the tokens, so the calendar and the org chart restyle
  with the theme. Buttons and badges hover with `--primary-hover` (Tailwind's
  `bg-primary/80` dropped some labels below AA).
- **Tests.** Unit: `src/lib/theme/*.test.ts` (colour math and the documented
  ratios, derive, the chart palette, contrast and fixes, strict hex and render-time
  validation, presets and `globals.css`) and the save/reset actions. RLS:
  `prisma/rls/phases.mjs` P8-01..03. Browser: `e2e/themes.spec.ts` (presets,
  portals, FullCalendar, default mode vs stored choice, lock, the themed public
  poll page, zero CSP violations); it mints sessions for the seeded fixture users
  and resets their orgs to the default theme afterwards.
- **Lint.** `theme/no-raw-colors` (eslint.config.mjs) is an `error` on Tailwind
  palette classes (`text-green-600`) and raw colour values in `.tsx` files. Every
  site is converted; the only exceptions are the two ignores below.

## The look (developers)

The Moonstone redesign (the working contract is docs/design/moonstone.md).
The look lives in `src/app/globals.css` (after the token blocks) and never
names a colour, so any theme an org picks or builds restyles it, the scoped
previews on Settings > Theme included. No grain on the page.

- **The glow.** Look and feel's Glow (`ThemeStyle.glow`), else the preset's own
  (`ThemePreset.glow`, Moonstone's banana), else each mode's accent. It is
  only ever light: the corona behind the page top (`.corona`), halos
  (`glow-halo`), the focus ring (`focus-glow`), gauges and selection.
- **Derived layer** (`derive.ts`): `glow`, `haze`, `raised`, `muted-strong`,
  `thumb`, `chrome` (+foreground, the glass rail, toasts and menu button), the four
  block cards (`block-quiet|alert|answer|goal` with `-foreground` and `-meta`;
  alert and goal hold fixed red and green hue families), chip tints
  (`tint-danger|accent|success|info` with inks) and avatar tints
  (`avatar-1..5`). Every label is nudged to 4.6:1; the contrast checker covers
  the chrome, block and chip pairs. Charts take the first coloured role
  (primary, accent, glow) as slot 1; monochrome themes try quiet slots first.
- **Type** (`src/app/layout.tsx`, loaded once for every page): **Bricolage
  Grotesque** (`font-heading`, via `--font-display`) for page titles, block
  titles and big figures; **Hanken Grotesk** (`font-sans`) for everything you
  read and click; **JetBrains Mono** (`font-mono`) only for codes and `kbd`.
  Young Serif stays loaded for the logo's wordmark (`font-logo`) and the
  "Serif" heading choice. A stored heading font of `serif` predates the
  choice and reads as Bricolage; `young-serif` is the deliberate pick.
- **Shape and depth.** `rounded-shell|card|block|tile|field` (32/28/24/18/14px
  times `--radius-scale`, which Corner roundness sets: round 1, the default;
  soft 0.7; sharp 0.4), `shadow-e1|e2|e3`, `edge` (card shadow plus a top
  highlight), `glass` and `glass-light` (floating chrome only; Chromium also
  refracts through `#lg-refract` when <html> has `.has-refract`; solid under
  "Reduce transparency"), `hatch` ("not yet").
- **Utilities.** `page-title` (every page's `<h1>`), `display-title`,
  `heading` (card, dialog and sheet titles: the grotesk, semibold), `eyebrow`
  (a small muted label in sentence case), `numeral` (big figures) and
  `figure` (tabular numbers in text).
- **Motion.** The app's `<main>` has `reveal-page`, which staggers the blocks
  of whatever page is inside it in on mount: a zero-specificity base style (an
  `animate-*` utility on a block wins) that switches off under
  `prefers-reduced-motion`.
- **Default palette.** Moonstone (`DEFAULT_PRESET`): dark `#0c0d10` page,
  `#15161b` cards, pearl `#eef0f4` primary, accent and text; light `#eff1f4`
  page, white cards, ink `#111318`; glow banana `#f2c230`. Rows saved with a
  former default (the raspberry or the cream Bananasplit) resolve to it.
- **Logo.** Unchanged by the redesign. "The Core", a banana cut across: a
  banana ring, cream flesh and three seeds. `src/components/brand/logo.tsx`
  (`CoreMark`, `Logo`) draws it in fixed logo colours (`--color-logo-*` in
  brand.css, never re-pointed at a club's accent) with the Young Serif
  wordmark, and `src/components/bananasplit-mark.tsx` wraps it for
  the app shell. The files are in `public/brand/` (the mark, the app icon, and
  the lockup for light and dark backgrounds with Young Serif embedded).
  `src/app/icon.svg`, `apple-icon.png` and `favicon.ico` are built from them.

## Bananasplit's own pages (developers)

Sign-in, sign-up, password help, email confirmation, checkout and the 404
page belong to no club, so they never take an org theme. They
mount `BrandRoot` (`src/components/brand/brand-root.tsx`), which since the
Moonstone redesign uses the app's own tokens as they are (globals.css): the
same Moonstone colours, type and components as the app, **dark by default**
(redesign guide 17). A visitor's stored choice wins (the footer's Light / Dark
/ System switch, `src/components/brand/theme-switch.tsx`, stores the same
choice as the user menu in the app), and "System" follows the device.
`BrandRoot` also puts `.corona` (the drifting banana glow) on its box.

`src/app/brand.css` adds only what these pages need on top of the tokens:
the logo's fixed colours (`--color-logo-*`, plus `logo-lockup`: ink type on
light, the dark lockup's cream on dark), glow utilities built from tokens
(`hero-light` behind the hero, `glow-corner` and `glow-rise` on panels,
`glow-text`), and the `focus-banana` field ring (a text-colour border and a
glow halo). Pages here build from Moonstone pieces: cards (`bg-card edge`),
block colours, the glass-light header, 40px fields (`brandInputClass`) and
pill buttons (`pill()`: `ink` is the primary, `glow` the one create action,
`outline`).

The older cream-and-banana palette stays in brand.css as Tailwind colours
(`bg-ink`, `bg-cream`, `bg-banana` ...) for the pages that still use it (the
home page, the RSVP flyer, the theme preview). The home page keeps its
original cream-and-banana sections (the hero screenshots, the feature
bento, ripeness, finance), with Moonstone's floating glass header and the
four-plan pricing on top; its decoration (`bg-hero`, `bg-peel`,
`bg-glow-banana-*`, the paper shadows) lives at the end of brand.css.
`<BrandRoot look="cream">`
gives a page that look whole: always light, with the tokens pointed at the
cream palette, so token-based components (the pill buttons, the brand
fields, Input) print in ink on cream.

Emails (`src/server/email/templates.ts`) can't read CSS variables, so the
layout spells out Moonstone's light palette (`EMAIL_COLORS`): a white card on
a soft grey page, ink text and an ink pill, with the standard lockup on top
(`public/brand/bananasplit-logo.png`, the SVG rendered as is, since Gmail
and Outlook don't show SVG images).

## Converted colours

The sites that other sections left hard-coded now use tokens:

| Was                                                          | Now                                                        | Where                                                                                                                                   |
| ------------------------------------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `border-amber-500/40 bg-amber-500/10` callouts               | `border-warning/40 bg-warning/10`                          | databases definitions, org-chart import, calendar detail and form, profile feed, CSV import, data table, detail panels, position editor |
| `text-amber-600`, `text-amber-700 dark:text-amber-400`       | `text-warning`                                             | the same callouts, member picker, prompts, task editor, due label                                                                       |
| `bg-amber-100 ... dark:bg-amber-900/40` flag badge           | `bg-warning/15 text-warning`                               | `tasks/task-badges.tsx`                                                                                                                 |
| `text-emerald-600`, `text-emerald-700 dark:text-emerald-300` | `text-success`                                             | finance transactions, org-chart draft editor, databases cell and forms                                                                  |
| `bg-emerald-500`, `bg-amber-500`, `bg-rose-500` poll brushes | `bg-success`, `bg-warning`, `bg-destructive`               | `calendar/poll-responder.tsx`                                                                                                           |
| `rgba(16, 185, 129, a)` heat map                             | `color-mix(in oklab, var(--success) N%, transparent)`      | `calendar/poll-responder.tsx`                                                                                                           |
| `bg-red-500` / `bg-amber-400` / `bg-slate-300` priority dots | `bg-destructive` / `bg-warning` / `bg-muted-foreground/40` | `tasks/task-badges.tsx`                                                                                                                 |
| `bg-amber-500` outline warning dot                           | `bg-warning`                                               | `org-chart/editor/outline-tree.tsx`                                                                                                     |
| `bg-emerald-500/15`, `bg-amber-500/15` badge tones           | `bg-success/15`, `bg-warning/15`                           | `databases/cell.tsx`                                                                                                                    |

Not converted on purpose: `google-icon.tsx` (Google's brand colours), email HTML
in `src/server/email/**` (mail clients have no CSS variables), label colours
(`src/lib/label-colors.ts`, data chosen per label) and the CBC seed's label hexes.
