# Split: Bananasplit's icons

Every icon in the app comes from here (`@/components/icons`), drawn for Bananasplit. They replace
`lucide-react` and keep its API and names, so `<CalendarDays className="size-4" />` works as before.

## Using them

```tsx
import { CalendarDays, type IconComponent } from "@/components/icons";

<CalendarDays className="size-4" aria-hidden="true" />;
```

- Colour is the text colour (`stroke="currentColor"`); size is a `size-*` class or the `size` prop.
- `strokeWidth` (default 2) and `absoluteStrokeWidth` work as in Lucide; the sidebar draws at 1.75.
- An icon is hidden from screen readers unless you give it an `aria-label`, `title` or `role`.
- Icons have no hooks or context, so they render in server components. A component is still a
  function, so pass one to a client component only from another client component.
- Settings, the sidebar, boards and saved databases store an icon by name ("CheckSquare").
  `index.ts` keeps every name they've stored resolving, under "Second names".

## How they're drawn

- **Grid:** 24 by 24, content inside 2–22 (most bodies 3–21).
- **Stroke:** 2 units, round caps and joins, no fill.
- **Corners:** r3 on anything 12 units or wider, r1.5–2.5 on small boxes. Rounder than Lucide on
  purpose: it matches Bricolage's soft terminals.
- **Circles:** a full circle is r9 at the centre.
- **Seeds:** a detail dot (an "i"'s dot, a bullet, a window, the sun's rays) is a filled circle,
  `<circle … r="1.25" fill="currentColor" stroke="none" />`, r1–1.75. They're the seeds in the
  logo.
- **Arrowheads** are 5 units on each side, **chevrons** 5.5: shorter than Lucide's 7 and 6.
- **Badges** (a plus, a check, a clock, a sync) sit in a corner, and the base shape stops short of
  them instead of running underneath ("the split").
- **Files** are rounded sheets with the top corner sliced off, no folded flap.
- **Brand glyphs:** `Core` (the logo as a one-colour icon), `Banana`, and `Loader` (the logo's
  three seeds; spin it with `animate-spin`).

## Click animations

Every icon acts out what it means when you click the button or link it sits in: the bell rings,
Send flies off, History turns back, Merge's branches join, a letter drops into the Inbox. One
listener on the document (`<IconMotion />` in the root layout) marks the control you clicked with
`data-icon-play`; `motion.css` does the rest. Nothing plays when the visitor has reduced motion on.

An icon carries its own choreography, so a page ships only the choreography of the icons it uses:

- `data-m` names a movement from `motion.css` (`draw`, `ring`, `fly-ur`, `deliver`...), on a part
  of the icon or, as `createIcon`'s third argument, on the whole icon. A `draw` part also sets
  `pathLength="1"`.
- `data-d="1"`–`"7"` delays a part by 70ms steps, so parts can play in turn.
- `data-o` sets the pivot: `t`, `b`, `l`, `r`, `bl`, `c` (the icon's centre), or `v` with an inline
  `transformOrigin` for any other point.
- A part with `opacity="0"` is only seen while it plays (the letter dropping into the Inbox).

To add a movement, add a line to `motion.css` that sets its keyframe (`--m-k`) and the direction
or amount it plays with. Keep to transform, opacity and stroke-dashoffset, under a second, and
ending where the icon started.

## Adding an icon

Each icon is its own file in `glyphs/`, named after it in kebab case, and `index.ts` exports it:

```tsx
// glyphs/ladle.tsx
import { createIcon } from "../create-icon";

export const Ladle = /* @__PURE__ */ createIcon(
  "Ladle",
  <>
    <path d="M…" />
    <circle cx="12" cy="7" r="1.25" fill="currentColor" stroke="none" />
  </>,
);
```

One file per icon, plain JSX and the `/* @__PURE__ */` mark are what keep a page's JavaScript down
to the icons it uses. So does `package.json` in this folder: its `"sideEffects"` tells the bundler
that importing an icon file does nothing but define the icon, so a page that imports two icons from
`index.ts` gets those two and not the other 263. Keep the glyph files free of shared helpers and of
imports from one another. Check a new icon at 16px as well as 24px: details closer
than 2 units fill in at small sizes.
