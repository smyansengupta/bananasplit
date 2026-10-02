# Themes: setup

Each org picks its own colours, logo display and light or dark default in
**Settings > Theme** (owners and admins). A change applies to every member as
soon as it is saved: no rebuild, no redeploy. The org's public poll and invite
pages wear the same theme and logo.

## For an org

1. Open **Settings > Theme**.
2. **Palette.** Pick a preset, or **Custom** to choose the five colours yourself:
   - **Bananasplit** (the Default, id `default`): vanilla paper, fudge ink, a
     raspberry primary and a banana highlighter; in dark mode, chocolate paper
     with a banana primary and a strawberry highlighter.
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
  the shadcn tokens in `globals.css` plus `--primary-hover`, `--brand-accent`
  (`-foreground`), `--success` (`-foreground`), `--warning` (`-foreground`),
  `--destructive-foreground` and `--chart-1..5`. Tailwind exposes them as
  `bg-primary-hover`, `text-success`, `bg-warning/10`, `bg-brand-accent`,
  `bg-chart-3` and so on. The math is hand-rolled OKLab/OKLCH (`color.ts`), shared
  by the server and the browser, so the preview equals the saved result.
- **Charts.** `chart.ts` builds `--chart-1..5` with the data-viz method: the
  validated reference palette in its fixed order (an achromatic theme like
  Graphite starts `#2a78d6`, `#eb6834` in light, `#3987e5`, `#d95926` in dark;
  Bananasplit leads with its raspberry), each slot's lightness snapped
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

## The look: "Riso bulletin" (developers)

Every theme is printed like a two-ink risograph zine: the org's **primary** and
**accent** are the two inks, so the same marks suit any preset or custom theme.
The look lives in `src/app/globals.css` (after the token blocks) and never names
a colour: utilities mix the tokens where they paint, so the scoped previews on
Settings > Theme restyle them too. Only palette-free values sit on `:root` (the
paper grain, the highlighter's strength per mode, the motion curve).

- **Type** (`src/app/layout.tsx`, all variable): **Anybody** for headings and
  figures, pushed to the ends of its width (50-150%) and weight (100-900) axes;
  **Atkinson Hyperlegible Next** for body text; **Martian Mono** for labels,
  dates and keyboard shortcuts.
- **Utilities.** `page-title` (every page's `<h1>`: wide, heavy, over a
  highlighter stroke drawn as a thick underline, so it moves no layout),
  `heading` (card, dialog and sheet titles), `eyebrow` (mono caps labels),
  `numeral` (thin, condensed big figures), `figure` (mono tabular money in
  text), `ink-mark` (highlight inline words), `misregister` (the accent ink
  printed off register), `paper` (grain over an element's background), `sheet` (a card lifted off the
  page), `ink-edge` (a primary button's darker bottom edge) and `crop-marks`
  (printer's marks outside an element's corners; not on an `overflow-hidden`
  element, which would clip them).
- **Motion.** `reveal` staggers its children in on mount; the app's `<main>`
  has `reveal-page`, which staggers the blocks of whatever page is inside it.
  Both are zero-specificity base styles (an `animate-*` utility on a block wins)
  and switch off under `prefers-reduced-motion`. The landing wordmark's
  ink-register and split animations are `motion-safe:` only.
- **Pieces.** `src/components/print-marks.tsx` (`RegistrationMark`,
  `SplitWordmark`), `src/components/auth/auth-frame.tsx` (sign-in and sign-up),
  `src/app/not-found.tsx`.
- **Logo.** A banana, split, in two inks. `src/components/bananasplit-mark.tsx`
  draws the mark inline in the tokens (`--mark-top`, default the primary;
  `--mark-under`, default the accent), so in a club it prints in the club's
  inks: the sidebar's signature under Settings, and the sign-in and sign-up
  pages. The fixed-colour files are in `public/brand/` (the mark, which follows
  the viewer's light or dark mode; the app icon; the lockup for light and dark
  backgrounds, with Anybody embedded). `src/app/icon.svg`, `apple-icon.png` and
  `favicon.ico` are the app icon. The paper grain's alpha is sparse on purpose: a denser
  grain would darken the page under the text and undo the measured contrast.

## Converted colours

The sites that other sections left hard-coded now use tokens:

| Was                                                          | Now                                                        | Where                                                                    |
| ------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| `border-amber-500/40 bg-amber-500/10` callouts               | `border-warning/40 bg-warning/10`                          | databases definitions, org-chart import, calendar detail and form, profile feed, CSV import, data table, detail panels, position editor |
| `text-amber-600`, `text-amber-700 dark:text-amber-400`       | `text-warning`                                             | the same callouts, member picker, prompts, task editor, due label        |
| `bg-amber-100 ... dark:bg-amber-900/40` flag badge           | `bg-warning/15 text-warning`                               | `tasks/task-badges.tsx`                                                  |
| `text-emerald-600`, `text-emerald-700 dark:text-emerald-300` | `text-success`                                             | finance transactions, org-chart draft editor, databases cell and forms   |
| `bg-emerald-500`, `bg-amber-500`, `bg-rose-500` poll brushes | `bg-success`, `bg-warning`, `bg-destructive`               | `calendar/poll-responder.tsx`                                            |
| `rgba(16, 185, 129, a)` heat map                             | `color-mix(in oklab, var(--success) N%, transparent)`      | `calendar/poll-responder.tsx`                                            |
| `bg-red-500` / `bg-amber-400` / `bg-slate-300` priority dots | `bg-destructive` / `bg-warning` / `bg-muted-foreground/40` | `tasks/task-badges.tsx`                                                  |
| `bg-amber-500` outline warning dot                           | `bg-warning`                                               | `org-chart/editor/outline-tree.tsx`                                      |
| `bg-emerald-500/15`, `bg-amber-500/15` badge tones           | `bg-success/15`, `bg-warning/15`                           | `databases/cell.tsx`                                                     |

Not converted on purpose: `google-icon.tsx` (Google's brand colours), email HTML
in `src/server/email/**` (mail clients have no CSS variables), label colours
(`src/lib/label-colors.ts`, data chosen per label) and the CBC seed's label hexes.
