"use client";

import { CheckCircle2, TriangleAlert } from "@/components/icons";
import { useId, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { contrastRatio, formatRatio } from "@/lib/theme/color";
import type { DerivedTheme } from "@/lib/theme/derive";
import { HEX_RE } from "@/lib/theme/hex";
import {
  BODY_FONT_LABELS,
  BODY_FONT_OPTIONS,
  HEADING_FONT_LABELS,
  HEADING_FONT_OPTIONS,
  RADIUS_LABELS,
  RADIUS_OPTIONS,
  RADIUS_VALUES,
  TEXT_SIZE_LABELS,
  TEXT_SIZE_OPTIONS,
  type ThemeStyle,
} from "@/lib/theme/style";
import { cn } from "@/lib/utils";

import { choiceClass } from "./choice";

/** Below this the accent barely shows against the page (a highlight, not text). */
const FAINT_ACCENT = 1.25;
const TEXT_AA = 4.5;

/**
 * Settings > Theme > Look and feel: an accent colour on top of the palette
 * (any hex; the labels and accent-coloured text on it are derived until
 * they clear AA, and the ratios are shown), corner roundness, text size and
 * the type pairing. Every choice previews live (the Preview section and the
 * optional whole-app preview) and is saved with the theme.
 */
export function LookAndFeel({
  groupId,
  style,
  paletteAccent,
  paletteGlow,
  tokens,
  onChange,
}: {
  groupId: string;
  style: ThemeStyle;
  /** The palette's own (light) accent, shown for "From the palette". */
  paletteAccent: string;
  /** The preset's own glow, else the accent, shown for "From the palette". */
  paletteGlow: string;
  /** The draft's derived tokens, with the accent applied. */
  tokens: DerivedTheme;
  onChange: (style: ThemeStyle) => void;
}) {
  const set = (patch: Partial<ThemeStyle>) => onChange({ ...style, ...patch });

  return (
    <div className="divide-border/70 -my-1 divide-y">
      <Row
        id={`${groupId}-accent`}
        title="Accent colour"
        hint="Highlights, badges, selected states, progress and the RSVP page's date tile."
      >
        <AccentField
          group={`${groupId}-accent-mode`}
          value={style.accent}
          paletteAccent={paletteAccent}
          tokens={tokens}
          onChange={(accent) => set({ accent })}
        />
      </Row>
      <Row
        id={`${groupId}-glow`}
        title="Glow"
        hint="The light behind the top of the page, and the soft halo on create buttons, the selected item and focus."
      >
        <GlowField
          group={`${groupId}-glow-mode`}
          value={style.glow}
          paletteGlow={paletteGlow}
          onChange={(glow) => set({ glow })}
        />
      </Row>
      <Row id={`${groupId}-radius`} title="Corners" hint="Cards, buttons, fields and menus.">
        <Choices
          name={`${groupId}-radius`}
          labelledBy={`${groupId}-radius`}
          options={RADIUS_OPTIONS.map((value) => ({ value, ...RADIUS_LABELS[value] }))}
          value={style.radius}
          onChange={(radius) => set({ radius })}
          render={(value) => (
            <span
              aria-hidden="true"
              className="border-foreground/60 size-5 shrink-0 border-t-2 border-l-2"
              style={{ borderTopLeftRadius: `calc(${RADIUS_VALUES[value]} * 1.8)` }}
            />
          )}
        />
      </Row>
      <Row
        id={`${groupId}-size`}
        title="Text size"
        hint="Scales text and spacing together, so it also sets how dense the app feels."
      >
        <Choices
          name={`${groupId}-size`}
          labelledBy={`${groupId}-size`}
          options={TEXT_SIZE_OPTIONS.map((value) => ({ value, ...TEXT_SIZE_LABELS[value] }))}
          value={style.textSize}
          onChange={(textSize) => set({ textSize })}
          render={(value) => (
            <span
              aria-hidden="true"
              className={cn(
                "w-5 shrink-0 text-center leading-none font-semibold",
                value === "small" ? "text-xs" : value === "large" ? "text-lg" : "text-sm",
              )}
            >
              A
            </span>
          )}
        />
      </Row>
      <Row id={`${groupId}-heading`} title="Headings" hint="Page titles and big numbers.">
        <Choices
          name={`${groupId}-heading`}
          labelledBy={`${groupId}-heading`}
          options={HEADING_FONT_OPTIONS.map((value) => ({ value, ...HEADING_FONT_LABELS[value] }))}
          value={style.headingFont}
          onChange={(headingFont) => set({ headingFont })}
          render={(value) => (
            <span
              aria-hidden="true"
              className={cn(
                "w-5 shrink-0 text-center text-base leading-none",
                value === "sans" ? "font-sans font-bold" : "font-medium",
              )}
              style={
                value === "display"
                  ? { fontFamily: "var(--font-bricolage)" }
                  : value === "young-serif"
                    ? { fontFamily: "var(--font-young-serif)", fontWeight: 400 }
                    : undefined
              }
            >
              Aa
            </span>
          )}
        />
      </Row>
      <Row id={`${groupId}-body`} title="Body text" hint="Everything you read and click.">
        <Choices
          name={`${groupId}-body`}
          labelledBy={`${groupId}-body`}
          options={BODY_FONT_OPTIONS.map((value) => ({ value, ...BODY_FONT_LABELS[value] }))}
          value={style.bodyFont}
          onChange={(bodyFont) => set({ bodyFont })}
          render={(value) => (
            <span
              aria-hidden="true"
              className="w-5 shrink-0 text-center text-base leading-none"
              style={
                value === "system"
                  ? { fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif" }
                  : undefined
              }
            >
              Aa
            </span>
          )}
        />
      </Row>
    </div>
  );
}

function Row({
  id,
  title,
  hint,
  children,
}: {
  id: string;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-3 py-5 first:pt-1 last:pb-1 lg:grid-cols-[12rem_1fr] lg:gap-6">
      <div className="space-y-1">
        <p id={id} className="heading text-sm">
          {title}
        </p>
        <p className="text-muted-foreground text-xs">{hint}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Choices<T extends string>({
  name,
  labelledBy,
  options,
  value,
  onChange,
  render,
}: {
  name: string;
  labelledBy: string;
  options: { value: T; label: string; hint: string }[];
  value: T;
  onChange: (value: T) => void;
  render?: (value: T) => React.ReactNode;
}) {
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="grid gap-2.5 sm:grid-cols-3">
      {options.map((option) => (
        <label key={option.value} className={choiceClass(value === option.value)}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="sr-only"
          />
          {render?.(option.value)}
          <span className="space-y-0.5">
            <span className="block font-semibold">{option.label}</span>
            <span className="text-muted-foreground block text-xs">{option.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function AccentField({
  group,
  value,
  paletteAccent,
  tokens,
  onChange,
}: {
  group: string;
  value: string | null;
  paletteAccent: string;
  tokens: DerivedTheme;
  onChange: (accent: string | null) => void;
}) {
  const id = useId();
  const custom = value !== null;
  const current = value ?? paletteAccent;
  const [text, setText] = useState(current);
  // Follow outside changes (a preset switch, an applied fix, the picker).
  const [seen, setSeen] = useState(current);
  if (current !== seen) {
    setSeen(current);
    setText(current);
  }
  const invalid = !HEX_RE.test(text);

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Accent colour" className="grid gap-2.5 sm:grid-cols-2">
        {[
          { custom: false, label: "From the palette", hint: "The accent the palette comes with." },
          { custom: true, label: "Custom", hint: "Any colour. Labels on it stay readable." },
        ].map((option) => (
          <label key={option.label} className={choiceClass(custom === option.custom)}>
            <input
              type="radio"
              name={group}
              checked={custom === option.custom}
              onChange={() => onChange(option.custom ? current : null)}
              className="sr-only"
            />
            <span
              aria-hidden="true"
              className="ring-foreground/15 size-5 shrink-0 rounded-full ring-1"
              style={{ backgroundColor: option.custom ? current : paletteAccent }}
            />
            <span className="space-y-0.5">
              <span className="block font-semibold">{option.label}</span>
              <span className="text-muted-foreground block text-xs">{option.hint}</span>
            </span>
          </label>
        ))}
      </div>

      {custom && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="color"
            aria-label="Accent colour picker"
            value={HEX_RE.test(current) ? current : paletteAccent}
            onChange={(event) => onChange(event.target.value.toLowerCase())}
            className="border-input size-10 shrink-0 cursor-pointer rounded-full border bg-transparent p-1"
          />
          <Label htmlFor={`${id}-hex`} className="sr-only">
            Accent colour hex
          </Label>
          <Input
            id={`${id}-hex`}
            value={text}
            spellCheck={false}
            autoComplete="off"
            maxLength={7}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? `${id}-error` : undefined}
            onChange={(event) => {
              const next = event.target.value.trim();
              setText(next);
              if (HEX_RE.test(next)) onChange(next.toLowerCase());
            }}
            onBlur={() => setText(current)}
            className={cn("w-28 font-mono text-sm", invalid && "border-destructive")}
          />
          {invalid && (
            <p id={`${id}-error`} className="text-destructive text-xs">
              Use #rrggbb
            </p>
          )}
        </div>
      )}

      <AccentContrast tokens={tokens} />
    </div>
  );
}

/**
 * The guard: the label on an accent fill in each mode (derived to clear AA
 * where any colour can), and a note when the accent nearly vanishes into
 * the page.
 */
function AccentContrast({ tokens }: { tokens: DerivedTheme }) {
  const rows = (["light", "dark"] as const).map((mode) => {
    const t = tokens[mode];
    return {
      mode,
      label: contrastRatio(t["brand-accent-foreground"], t["brand-accent"]),
      visible: contrastRatio(t["brand-accent"], t.background),
      fill: t["brand-accent"],
      ink: t["brand-accent-foreground"],
    };
  });
  return (
    <ul className="grid gap-2 sm:grid-cols-2" aria-live="polite">
      {rows.map((row) => {
        const ok = row.label >= TEXT_AA;
        const faint = row.visible < FAINT_ACCENT;
        return (
          <li
            key={row.mode}
            className="bg-muted/40 rounded-tile flex items-center gap-2.5 p-2.5 text-xs"
          >
            <span
              aria-hidden="true"
              className="ring-foreground/10 flex h-7 w-10 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ring-1"
              style={{ backgroundColor: row.fill, color: row.ink }}
            >
              Aa
            </span>
            <span className="min-w-0 space-y-0.5">
              <span
                className={cn(
                  "flex items-center gap-1 font-medium",
                  ok ? "text-success" : "text-warning",
                )}
              >
                {ok ? (
                  <CheckCircle2 className="size-3.5" aria-hidden="true" />
                ) : (
                  <TriangleAlert className="size-3.5" aria-hidden="true" />
                )}
                {row.mode === "light" ? "Light" : "Dark"}: label {formatRatio(row.label)}
              </span>
              <span className="text-muted-foreground block">
                {faint
                  ? "Very close to the page colour: highlights will be faint."
                  : `${formatRatio(row.visible)} against the page.`}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** The glow: the palette's own (the preset's, else its accent), or any colour. */
function GlowField({
  group,
  value,
  paletteGlow,
  onChange,
}: {
  group: string;
  value: string | null;
  paletteGlow: string;
  onChange: (glow: string | null) => void;
}) {
  const id = useId();
  const custom = value !== null;
  const current = value ?? paletteGlow;
  const [text, setText] = useState(current);
  const [seen, setSeen] = useState(current);
  if (current !== seen) {
    setSeen(current);
    setText(current);
  }
  const invalid = !HEX_RE.test(text);

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Glow" className="grid gap-2.5 sm:grid-cols-2">
        {[
          {
            custom: false,
            label: "From the palette",
            hint: "The preset's own glow, or its accent.",
          },
          { custom: true, label: "Custom", hint: "Any colour. It only ever shows as light." },
        ].map((option) => (
          <label key={option.label} className={choiceClass(custom === option.custom)}>
            <input
              type="radio"
              name={group}
              checked={custom === option.custom}
              onChange={() => onChange(option.custom ? current : null)}
              className="sr-only"
            />
            <span
              aria-hidden="true"
              className="ring-foreground/15 size-5 shrink-0 rounded-full ring-1"
              style={{
                backgroundColor: option.custom ? current : paletteGlow,
                boxShadow: `0 0 10px 2px ${option.custom ? current : paletteGlow}`,
              }}
            />
            <span className="space-y-0.5">
              <span className="block font-semibold">{option.label}</span>
              <span className="text-muted-foreground block text-xs">{option.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {custom && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="color"
            aria-label="Glow colour picker"
            value={HEX_RE.test(current) ? current : paletteGlow}
            onChange={(event) => onChange(event.target.value.toLowerCase())}
            className="border-input size-10 shrink-0 cursor-pointer rounded-full border bg-transparent p-1"
          />
          <Label htmlFor={`${id}-hex`} className="sr-only">
            Glow colour hex
          </Label>
          <Input
            id={`${id}-hex`}
            value={text}
            onChange={(event) => {
              const next = event.target.value.trim();
              setText(next);
              if (HEX_RE.test(next)) onChange(next.toLowerCase());
            }}
            aria-invalid={invalid}
            className="w-32 font-mono"
            spellCheck={false}
          />
          {invalid && <p className="text-destructive text-xs">Use #rrggbb</p>}
        </div>
      )}
    </div>
  );
}
