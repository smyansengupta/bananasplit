"use client";

import { Check, Eye, Moon, Sun } from "lucide-react";
import { useMemo } from "react";

import { cn } from "@/lib/utils";
import {
  DEFAULT_CUSTOM_ROLES,
  personalPalettes,
  previewTokens,
  type PersonalTheme,
} from "@/lib/theme/personal";
import { CUSTOM_PRESET_ID, THEME_PRESETS } from "@/lib/theme/presets";
import { ROLE_KEYS, ROLE_LABELS, type ThemeRoles } from "@/lib/theme/types";

/**
 * The personal theme picker (onboarding A4, profile page): a preset or five
 * custom colours, light or dark, and a live preview of a task row. The
 * picked colours are data from src/lib/theme, shown as swatches.
 */

export interface ThemeChoice {
  preset: string;
  mode: "light" | "dark";
  custom: ThemeRoles;
}

export function initialThemeChoice(
  saved: PersonalTheme | null,
  fallbackPreset = "default",
): ThemeChoice {
  return {
    preset: saved?.preset ?? fallbackPreset,
    mode: saved?.mode === "light" ? "light" : "dark",
    custom: saved?.custom ?? DEFAULT_CUSTOM_ROLES,
  };
}

export function toPersonalTheme(choice: ThemeChoice): PersonalTheme {
  return {
    preset: choice.preset,
    mode: choice.mode,
    custom: choice.preset === CUSTOM_PRESET_ID ? choice.custom : null,
  };
}

export function choiceName(choice: ThemeChoice): string {
  if (choice.preset === CUSTOM_PRESET_ID) return "Custom";
  return THEME_PRESETS.find((p) => p.id === choice.preset)?.name ?? "Default";
}

/** The picked palette's primary and its label colour (for the Continue button). */
export function useChoiceColors(choice: ThemeChoice) {
  return useMemo(() => {
    const palettes = personalPalettes(toPersonalTheme(choice));
    return palettes ? previewTokens(palettes, choice.mode) : null;
  }, [choice]);
}

function Swatches({ roles }: { roles: ThemeRoles }) {
  return (
    <div className="flex h-3.5 overflow-hidden rounded border">
      {ROLE_KEYS.map((k) => (
        <span key={k} className="flex-1" style={{ background: roles[k] }} />
      ))}
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
  const options = [
    ...THEME_PRESETS.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      light: p.light,
      dark: p.dark,
    })),
    (() => {
      const palettes = personalPalettes({
        preset: CUSTOM_PRESET_ID,
        mode: "light",
        custom: value.custom,
      });
      return {
        id: CUSTOM_PRESET_ID,
        name: "Custom",
        description: "Your own five colours.",
        light: palettes?.light ?? value.custom,
        dark: palettes?.dark ?? value.custom,
      };
    })(),
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <div className="flex rounded-lg border p-0.5" role="group" aria-label="Light or dark">
          {(["light", "dark"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={value.mode === m}
              onClick={() => onChange({ ...value, mode: m })}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs capitalize transition-colors",
                value.mode === m
                  ? "bg-muted text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "light" ? (
                <Sun className="size-3.5" aria-hidden="true" />
              ) : (
                <Moon className="size-3.5" aria-hidden="true" />
              )}
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Theme">
        {options.map((t) => {
          const on = t.id === value.preset;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange({ ...value, preset: t.id })}
              className={cn(
                "focus-visible:ring-ring/50 flex flex-col gap-1.5 rounded-xl border p-2.5 text-left transition-colors outline-none focus-visible:ring-3",
                on ? "border-primary bg-primary/5" : "hover:bg-muted/50",
              )}
            >
              <span className="flex items-center justify-between">
                <span className="text-sm font-semibold">{t.name}</span>
                {on && <Check className="text-primary size-3.5" aria-hidden="true" />}
              </span>
              <span className="text-muted-foreground min-h-8 text-[11px] leading-snug">
                {t.description}
              </span>
              <Swatches roles={t.light} />
              <Swatches roles={t.dark} />
            </button>
          );
        })}
      </div>

      {value.preset === CUSTOM_PRESET_ID && (
        <div className="space-y-1.5">
          <span className="text-xs font-medium">Your five colours</span>
          <div className="grid grid-cols-5 gap-1.5">
            {ROLE_KEYS.map((k) => (
              <label
                key={k}
                className="text-muted-foreground flex flex-col gap-1 font-mono text-[10px]"
              >
                <input
                  type="color"
                  value={value.custom[k]}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      custom: { ...value.custom, [k]: e.target.value.toLowerCase() },
                    })
                  }
                  className="h-7 w-full cursor-pointer rounded-md border bg-transparent p-0"
                  aria-label={`${ROLE_LABELS[k]} colour`}
                />
                <span>{ROLE_LABELS[k]}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {colors && (
        <div className="space-y-1.5">
          <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
            <Eye className="size-3.5" aria-hidden="true" />
            Preview
          </span>
          <div
            className="rounded-xl border p-3"
            style={{ background: colors.page, borderColor: colors.border }}
          >
            <div
              className="flex items-center gap-2.5 rounded-lg px-3 py-2.5"
              style={{ background: colors.surface }}
            >
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: colors.accent }}
              />
              <span className="flex-1 text-xs font-medium" style={{ color: colors.text }}>
                Q3 budget review
              </span>
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap"
                style={{ background: colors.primary, color: colors.onPrimary }}
              >
                Needs your input
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
