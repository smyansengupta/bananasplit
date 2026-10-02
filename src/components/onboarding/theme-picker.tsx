"use client";

import {
  Building2,
  Check,
  ChevronDown,
  Eye,
  Monitor,
  Moon,
  Palette,
  SlidersHorizontal,
  Sun,
} from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import {
  COLOUR_SWATCHES,
  matchCustomRoles,
  PAGE_STYLES,
} from "@/lib/theme/custom-builder";
import {
  DEFAULT_CUSTOM_ROLES,
  personalPalettes,
  previewTokens,
  type PersonalMode,
  type PersonalTheme,
} from "@/lib/theme/personal";
import { CUSTOM_PRESET_ID, THEME_PRESETS } from "@/lib/theme/presets";
import { ROLE_KEYS, ROLE_LABELS, type ThemeRoles } from "@/lib/theme/types";

/**
 * The personal theme picker (onboarding A4, Profile > Theme).
 *
 * - "Match my club" (the default) stores nothing: the member sees the org's
 *   theme, and sees it change when an admin changes it in Settings > Theme.
 * - A curated preset, each shown as a small picture of the app.
 * - Custom: one colour and one page style (src/lib/theme/custom-builder.ts,
 *   always readable), with "Fine-tune" for exact colours.
 * - Light, dark or match the device.
 */

/** The picker's "follow the organization" choice (stored as NULL). */
export const FOLLOW_ORG = "org";

export interface ThemeChoice {
  preset: string;
  mode: PersonalMode;
  custom: ThemeRoles;
}

export function initialThemeChoice(
  saved: PersonalTheme | null,
  fallbackPreset: string = FOLLOW_ORG,
): ThemeChoice {
  return {
    preset: saved?.preset ?? fallbackPreset,
    mode: saved?.mode ?? "system",
    custom: saved?.custom ?? DEFAULT_CUSTOM_ROLES,
  };
}

/** The value to save: null means "follow the organization". */
export function toPersonalTheme(choice: ThemeChoice): PersonalTheme | null {
  if (choice.preset === FOLLOW_ORG) return null;
  return {
    preset: choice.preset,
    mode: choice.mode,
    custom: choice.preset === CUSTOM_PRESET_ID ? choice.custom : null,
  };
}

export function choiceName(choice: ThemeChoice): string {
  if (choice.preset === FOLLOW_ORG) return "my club's theme";
  if (choice.preset === CUSTOM_PRESET_ID) return "Custom";
  return THEME_PRESETS.find((p) => p.id === choice.preset)?.name ?? "Default";
}

function previewMode(mode: PersonalMode): "light" | "dark" {
  return mode === "dark" ? "dark" : "light";
}

/** The picked palette's colours (for the preview and the Continue button). */
export function useChoiceColors(choice: ThemeChoice) {
  return useMemo(() => {
    const theme = toPersonalTheme(choice);
    const palettes = theme ? personalPalettes(theme) : null;
    return palettes ? previewTokens(palettes, previewMode(choice.mode)) : null;
  }, [choice]);
}

type Colors = ReturnType<typeof previewTokens>;

/** A tiny picture of the app in one palette: sidebar, a card, a button. */
function MiniApp({ colors, className }: { colors: Colors; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("flex h-16 overflow-hidden rounded-lg border", className)}
      style={{ background: colors.page, borderColor: colors.border }}
    >
      <div className="flex w-1/4 flex-col gap-1 p-1.5" style={{ background: colors.surface }}>
        <span className="h-1.5 w-3/4 rounded-full" style={{ background: colors.primary }} />
        <span className="h-1 w-full rounded-full opacity-40" style={{ background: colors.text }} />
        <span className="h-1 w-2/3 rounded-full opacity-40" style={{ background: colors.text }} />
      </div>
      <div className="flex flex-1 flex-col justify-between p-1.5">
        <div
          className="flex items-center gap-1 rounded px-1.5 py-1"
          style={{ background: colors.surface }}
        >
          <span className="size-1.5 rounded-full" style={{ background: colors.accent }} />
          <span className="h-1 flex-1 rounded-full opacity-60" style={{ background: colors.text }} />
        </div>
        <span
          className="ml-auto h-3 w-8 rounded-full"
          style={{ background: colors.primary }}
        />
      </div>
    </div>
  );
}

function ModeSwitch({
  value,
  onChange,
}: {
  value: PersonalMode;
  onChange: (mode: PersonalMode) => void;
}) {
  const modes = [
    { id: "light", label: "Light", icon: Sun },
    { id: "dark", label: "Dark", icon: Moon },
    { id: "system", label: "Auto", icon: Monitor },
  ] as const;
  return (
    <div className="bg-muted/60 flex rounded-lg p-0.5" role="radiogroup" aria-label="Light or dark">
      {modes.map((m) => {
        const Icon = m.icon;
        const on = value === m.id;
        return (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(m.id)}
            title={m.id === "system" ? "Match your device" : undefined}
            className={cn(
              "focus-visible:ring-ring/50 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors outline-none focus-visible:ring-3",
              on
                ? "bg-background text-foreground font-medium shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

function ColourField({
  role,
  value,
  onChange,
}: {
  role: keyof ThemeRoles;
  value: string;
  onChange: (hex: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value);
  }
  return (
    <label className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value.toLowerCase())}
        className="size-8 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
        aria-label={`${ROLE_LABELS[role]} colour`}
      />
      <span className="w-20 text-xs">{ROLE_LABELS[role]}</span>
      <input
        value={draft}
        onChange={(e) => {
          const next = e.target.value.trim().toLowerCase();
          setDraft(next);
          if (/^#[0-9a-f]{6}$/.test(next)) onChange(next);
        }}
        spellCheck={false}
        maxLength={7}
        aria-label={`${ROLE_LABELS[role]} hex code`}
        className="border-input focus-visible:ring-ring/50 h-8 w-24 rounded-md border bg-transparent px-2 font-mono text-xs outline-none focus-visible:ring-3"
      />
    </label>
  );
}

function CustomBuilder({
  value,
  onChange,
}: {
  value: ThemeRoles;
  onChange: (roles: ThemeRoles) => void;
}) {
  const matched = matchCustomRoles(value);
  const [fineTune, setFineTune] = useState(!matched.colour || !matched.page);

  return (
    <div className="bg-muted/30 space-y-4 rounded-xl border p-3.5">
      <div className="space-y-2">
        <span className="text-xs font-medium">Main colour</span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Main colour">
          {COLOUR_SWATCHES.map((c) => {
            const on = matched.colour === c.id;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={c.name}
                title={c.name}
                onClick={() => onChange({ ...value, primary: c.primary, accent: c.accent })}
                className={cn(
                  "focus-visible:ring-ring/50 relative size-8 rounded-full outline-none focus-visible:ring-3",
                  on && "ring-foreground ring-offset-background ring-2 ring-offset-2",
                )}
                style={{ background: c.primary }}
              >
                <span
                  className="border-background absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2"
                  style={{ background: c.accent }}
                />
                {on && <Check className="text-background absolute inset-0 m-auto size-3.5" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <span className="text-xs font-medium">Page</span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Page style">
          {PAGE_STYLES.map((p) => {
            const on = matched.page === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() =>
                  onChange({ ...value, background: p.background, surface: p.surface, text: p.text })
                }
                className={cn(
                  "focus-visible:ring-ring/50 flex items-center gap-2 rounded-lg border p-1.5 text-left text-xs outline-none focus-visible:ring-3",
                  on ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted/60",
                )}
              >
                <span
                  className="grid size-6 shrink-0 place-items-center rounded border"
                  style={{ background: p.background }}
                >
                  <span className="h-1 w-3 rounded-full" style={{ background: p.text }} />
                </span>
                {p.name}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setFineTune((v) => !v)}
          aria-expanded={fineTune}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs font-medium"
        >
          <SlidersHorizontal className="size-3.5" aria-hidden="true" />
          Fine-tune exact colours
          <ChevronDown
            className={cn("size-3.5 transition-transform", fineTune && "rotate-180")}
            aria-hidden="true"
          />
        </button>
        {fineTune && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {ROLE_KEYS.map((k) => (
              <ColourField
                key={k}
                role={k}
                value={value[k]}
                onChange={(hex) => onChange({ ...value, [k]: hex })}
              />
            ))}
            <p className="text-muted-foreground text-[11px] sm:col-span-2">
              The dark version is worked out for you. Colours that are hard to read are flagged
              when you save.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export function ThemePicker({
  value,
  onChange,
}: {
  value: ThemeChoice;
  onChange: (next: ThemeChoice) => void;
}) {
  const colors = useChoiceColors(value);
  const shown = previewMode(value.mode);
  const followOrg = value.preset === FOLLOW_ORG;
  const customColors = useMemo(() => {
    const palettes = personalPalettes({ preset: CUSTOM_PRESET_ID, mode: "light", custom: value.custom });
    return palettes ? previewTokens(palettes, shown) : null;
  }, [value.custom, shown]);

  const tile = (on: boolean) =>
    cn(
      "focus-visible:ring-ring/50 relative flex flex-col gap-2 rounded-xl border p-2 text-left transition-all outline-none focus-visible:ring-3",
      on ? "border-primary ring-primary/20 bg-primary/5 ring-2" : "hover:border-foreground/20 hover:bg-muted/40",
    );
  const tick = (
    <span className="bg-primary text-primary-foreground absolute top-1.5 right-1.5 grid size-4 place-items-center rounded-full">
      <Check className="size-2.5" aria-hidden="true" />
    </span>
  );

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Theme" className="space-y-2">
        <button
          type="button"
          role="radio"
          aria-checked={followOrg}
          onClick={() => onChange({ ...value, preset: FOLLOW_ORG })}
          className={cn(tile(followOrg), "flex-row items-center gap-3 p-3")}
        >
          <Building2 className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">
              Match my club{" "}
              <span className="text-muted-foreground text-xs font-normal">· recommended</span>
            </span>
            <span className="text-muted-foreground block text-xs">
              Your club&apos;s colours, updated whenever an admin changes them.
            </span>
          </span>
          {followOrg && tick}
        </button>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {THEME_PRESETS.map((p) => {
            const on = value.preset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={on}
                title={p.description}
                onClick={() => onChange({ ...value, preset: p.id })}
                className={tile(on)}
              >
                <MiniApp colors={previewTokens({ light: p.light, dark: p.dark }, shown)} />
                <span className="px-0.5 text-xs font-medium">{p.name}</span>
                {on && tick}
              </button>
            );
          })}
          <button
            type="button"
            role="radio"
            aria-checked={value.preset === CUSTOM_PRESET_ID}
            onClick={() => onChange({ ...value, preset: CUSTOM_PRESET_ID })}
            className={tile(value.preset === CUSTOM_PRESET_ID)}
          >
            {customColors ? (
              <MiniApp colors={customColors} />
            ) : (
              <span className="grid h-16 place-items-center rounded-lg border border-dashed">
                <Palette className="text-muted-foreground size-5" aria-hidden="true" />
              </span>
            )}
            <span className="flex items-center gap-1 px-0.5 text-xs font-medium">
              <Palette className="size-3" aria-hidden="true" />
              Custom
            </span>
            {value.preset === CUSTOM_PRESET_ID && tick}
          </button>
        </div>
      </div>

      {value.preset === CUSTOM_PRESET_ID && (
        <CustomBuilder value={value.custom} onChange={(custom) => onChange({ ...value, custom })} />
      )}

      {!followOrg && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs font-medium">Appearance</span>
          <ModeSwitch value={value.mode} onChange={(mode) => onChange({ ...value, mode })} />
        </div>
      )}

      {colors && (
        <div className="space-y-1.5">
          <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
            <Eye className="size-3.5" aria-hidden="true" />
            Preview
          </span>
          <div
            className="space-y-2 rounded-xl border p-3"
            style={{ background: colors.page, borderColor: colors.border }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold" style={{ color: colors.text }}>
                This week
              </span>
              <span
                className="rounded-md px-2 py-1 text-[10px] font-semibold"
                style={{ background: colors.primary, color: colors.onPrimary }}
              >
                New task
              </span>
            </div>
            {["Q3 budget review", "Plan the kickoff social"].map((title, i) => (
              <div
                key={title}
                className="flex items-center gap-2.5 rounded-lg border px-3 py-2"
                style={{ background: colors.surface, borderColor: colors.border }}
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: i === 0 ? colors.accent : colors.muted }}
                />
                <span className="flex-1 text-xs font-medium" style={{ color: colors.text }}>
                  {title}
                </span>
                <span className="text-[10px]" style={{ color: i === 0 ? colors.primary : colors.muted }}>
                  {i === 0 ? "Due Friday" : "Next week"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
