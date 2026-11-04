"use client";

import {
  Check,
  CheckCircle2,
  Flag,
  Loader2,
  Palette,
  Plus,
  TriangleAlert,
  Undo2,
} from "@/components/icons";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import {
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { accentScale, withAccent } from "@/lib/theme/accent";
import { formatRatio } from "@/lib/theme/color";
import { tokenStyle } from "@/lib/theme/css";
import { contrastWarnings, type ContrastWarning } from "@/lib/theme/contrast";
import { deriveDarkRoles, deriveTheme, type DerivedTheme, type TokenMap } from "@/lib/theme/derive";
import {
  CUSTOM_PRESET_ID,
  UNTHEMED_PRESET_ID,
  findPreset,
  presetGlow,
  THEME_PRESETS,
  type ThemePreset,
} from "@/lib/theme/presets";
import { DEFAULT_THEME_STYLE, type ThemeStyle } from "@/lib/theme/style";
import {
  ROLE_LABELS,
  type ColorMode,
  type LogoDisplayValue,
  type ThemeModeValue,
  type ThemeRoles,
} from "@/lib/theme/types";
import { cn } from "@/lib/utils";

import { resetOrgTheme, saveOrgTheme } from "./actions";
import { THEME_SECTION } from "./choice";
import { LookAndFeel } from "./look-and-feel";
import { ThemePreview } from "./theme-preview";

// Only admins who open Custom download the editor.
const CustomThemeEditor = dynamic(() => import("./custom-editor"), {
  ssr: false,
  loading: () => <p className="text-muted-foreground text-sm">Loading the editor…</p>,
});

const noopSubscribe = () => () => {};

export interface ThemeDraft {
  preset: string;
  mode: ThemeModeValue;
  lockMode: boolean;
  logoDisplay: LogoDisplayValue;
  light: ThemeRoles;
  /** null = derived from light. */
  dark: ThemeRoles | null;
  /** Look and feel: accent override, corners, text size, fonts. */
  style: ThemeStyle;
}

const MODE_OPTIONS: { value: ThemeModeValue; label: string }[] = [
  { value: "SYSTEM", label: "Device" },
  { value: "LIGHT", label: "Light" },
  { value: "DARK", label: "Dark" },
];

export function ThemeSettings({
  orgId,
  orgName,
  initial,
  isDefault,
  personalThemeName = null,
}: {
  orgId: string;
  orgName: string;
  initial: ThemeDraft;
  isDefault: boolean;
  /** The viewer's own theme, which is what they see instead of this one. */
  personalThemeName?: string | null;
}) {
  const { setTheme, resolvedTheme } = useTheme();
  const [usingOwn] = useState(personalThemeName !== null);
  const [draft, setDraft] = useState<ThemeDraft>(initial);
  const [saved, setSaved] = useState<ThemeDraft>(initial);
  const [savedIsDefault, setSavedIsDefault] = useState(isDefault);
  // What the theme was before each change, newest last: Undo walks back.
  const [history, setHistory] = useState<{ draft: ThemeDraft; wasDefault: boolean }[]>([]);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const savedRef = useRef(initial);
  const savedDefaultRef = useRef(isDefault);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Radio groups are named per instance: a page Next keeps hidden (Activity)
  // or a streamed copy must not share a group with the visible one.
  const groupId = useId();
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // What the app paints with: the palettes plus Look and feel's accent (as
  // the save action and resolve.ts compute it).
  const palettes = useMemo(
    () => withAccent(draft.light, draft.dark ?? deriveDarkRoles(draft.light), draft.style.accent),
    [draft.light, draft.dark, draft.style.accent],
  );
  const glow = draft.style.glow ?? presetGlow(draft.preset);
  const tokens = useMemo(() => deriveTheme(palettes.light, palettes.dark, glow), [palettes, glow]);
  const accents = useMemo(
    () => ({ light: accentScale(palettes.light), dark: accentScale(palettes.dark) }),
    [palettes],
  );
  // The fix search re-derives the theme many times: keep typing responsive.
  const deferredPalettes = useDeferredValue(palettes);
  const warnings = useMemo(
    () => contrastWarnings(deferredPalettes.light, deferredPalettes.dark),
    [deferredPalettes],
  );

  /** Saves `next` for everyone; with `remember`, the theme before it goes on the Undo stack. */
  async function persist(next: ThemeDraft, remember: boolean) {
    setStatus("saving");
    setError(null);
    try {
      const result = await saveOrgTheme(orgId, next);
      if (!result.ok) {
        setStatus("error");
        setError(result.error);
        return;
      }
      const presetId = findPreset(next.preset) ? next.preset : CUSTOM_PRESET_ID;
      const stored = { ...next, preset: presetId };
      if (remember) {
        const before = { draft: savedRef.current, wasDefault: savedDefaultRef.current };
        setHistory((h) => [...h.slice(-19), before]);
      }
      savedRef.current = stored;
      savedDefaultRef.current = false;
      setSaved(stored);
      setSavedIsDefault(false);
      setStatus("saved");
      // The admin sees the mode they just chose (a mode picked earlier
      // from the user menu would otherwise keep winning in this browser).
      if (!usingOwn)
        setTheme(next.mode === "LIGHT" ? "light" : next.mode === "DARK" ? "dark" : "system");
    } catch {
      setStatus("error");
      setError("Couldn't save the theme. Try again.");
    }
  }

  /**
   * Every change applies for everyone as soon as it's made (Jack's call):
   * no Save, no preview-then-commit, and Undo in the bar takes it back.
   * Typing a colour is debounced so a half-typed hex isn't sent.
   */
  function update(patch: Partial<ThemeDraft>, delay = 450) {
    setDraft((current) => {
      const next = { ...current, ...patch };
      if (next.mode === "SYSTEM") next.lockMode = false;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void persist(next, true), delay);
      return next;
    });
  }

  function choosePreset(preset: ThemePreset) {
    update({ preset: preset.id, light: preset.light, dark: preset.dark }, 0);
  }

  function chooseCustom() {
    update({ preset: CUSTOM_PRESET_ID }, 0);
  }

  function applyFix(warning: ContrastWarning) {
    const fix = warning.fix;
    if (!fix) return;
    // The accent is Look and feel's while it overrides the palette.
    if (fix.role === "accent" && draft.style.accent) {
      if (fix.mode === "light") update({ style: { ...draft.style, accent: fix.value } }, 0);
      return;
    }
    if (fix.mode === "light") {
      update({ preset: CUSTOM_PRESET_ID, light: { ...draft.light, [fix.role]: fix.value } }, 0);
    } else {
      const dark = draft.dark ?? deriveDarkRoles(draft.light);
      update({ preset: CUSTOM_PRESET_ID, dark: { ...dark, [fix.role]: fix.value } }, 0);
    }
  }

  /** Back one change: the theme as it was before the last one, saved again. */
  async function undo() {
    const last = history.at(-1);
    if (!last) return;
    if (timer.current) clearTimeout(timer.current);
    setHistory((h) => h.slice(0, -1));
    setDraft(last.draft);
    if (last.wasDefault) {
      setStatus("saving");
      const result = await resetOrgTheme(orgId);
      if (!result.ok) {
        setStatus("error");
        setError(result.error);
        return;
      }
      savedRef.current = last.draft;
      savedDefaultRef.current = true;
      setSaved(last.draft);
      setSavedIsDefault(true);
      setStatus("saved");
      return;
    }
    await persist(last.draft, false);
  }

  /** Back to the default theme, with Undo to bring this one back. */
  async function reset() {
    if (timer.current) clearTimeout(timer.current);
    const before = { draft: savedRef.current, wasDefault: savedDefaultRef.current };
    setStatus("saving");
    try {
      const result = await resetOrgTheme(orgId);
      if (!result.ok) {
        setStatus("error");
        setError(result.error);
        return;
      }
      const defaults = findPreset(UNTHEMED_PRESET_ID)!;
      const next: ThemeDraft = {
        preset: UNTHEMED_PRESET_ID,
        mode: "LIGHT",
        lockMode: false,
        logoDisplay: saved.logoDisplay,
        light: defaults.light,
        dark: defaults.dark,
        style: DEFAULT_THEME_STYLE,
      };
      setHistory((h) => [...h.slice(-19), before]);
      savedRef.current = next;
      savedDefaultRef.current = true;
      setDraft(next);
      setSaved(next);
      setSavedIsDefault(true);
      setStatus("saved");
      if (!usingOwn) setTheme("light");
    } catch {
      setStatus("error");
      setError("Couldn't reset the theme. Try again.");
    }
  }

  const isCustom = draft.preset === CUSTOM_PRESET_ID || !findPreset(draft.preset);
  const lightWarnings = warnings.filter((w) => w.mode === "light");
  const darkWarnings = warnings.filter((w) => w.mode === "dark");
  // Preset cards render in the mode the viewer is in, like the app around them
  // (light, the default, until the client knows).
  const cardMode: ColorMode = hydrated && resolvedTheme === "dark" ? "dark" : "light";
  const savedPreset = findPreset(saved.preset) ? saved.preset : CUSTOM_PRESET_ID;

  return (
    <div className="space-y-4.5 pb-4">
      <section aria-labelledby="theme-presets" className={THEME_SECTION}>
        <SectionHeading id="theme-presets" title="Palette">
          Every preset passes WCAG AA.
        </SectionHeading>
        <div
          role="radiogroup"
          aria-labelledby="theme-presets"
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
        >
          {THEME_PRESETS.map((preset) => (
            <PresetCard
              key={preset.id}
              group={`${groupId}-preset`}
              name={preset.name}
              description={preset.description}
              tokens={presetTokens(preset)[cardMode]}
              mode={cardMode}
              badge={savedPreset === preset.id ? "In use" : null}
              selected={draft.preset === preset.id}
              onSelect={() => choosePreset(preset)}
            />
          ))}
          <PresetCard
            group={`${groupId}-preset`}
            name="Custom"
            description="Your own colours."
            tokens={tokens[cardMode]}
            mode={cardMode}
            badge={savedPreset === CUSTOM_PRESET_ID ? "In use" : null}
            selected={isCustom}
            onSelect={chooseCustom}
            icon
          />
        </div>
      </section>

      {isCustom && (
        <section aria-labelledby="theme-custom" className={THEME_SECTION}>
          <SectionHeading id="theme-custom" title="Custom colours">
            Everything else is derived from these.
          </SectionHeading>
          <CustomThemeEditor
            light={draft.light}
            dark={draft.dark}
            onChange={({ light, dark }) => update({ preset: CUSTOM_PRESET_ID, light, dark })}
          />
        </section>
      )}

      <section aria-labelledby="theme-look" className={THEME_SECTION}>
        <SectionHeading id="theme-look" title="Look and feel" />
        <LookAndFeel
          groupId={`${groupId}-look`}
          style={draft.style}
          paletteAccent={draft.light.accent}
          paletteGlow={presetGlow(draft.preset) ?? draft.light.accent}
          tokens={tokens}
          onChange={(style) => update({ style })}
        />
      </section>

      <section aria-labelledby="theme-mode" className={THEME_SECTION}>
        <SectionHeading id="theme-mode" title="Light and dark" />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Segmented
            label="Default mode"
            value={draft.mode}
            onSelect={(mode) => update({ mode: mode as ThemeModeValue }, 0)}
            options={MODE_OPTIONS}
          />
          {draft.mode !== "SYSTEM" && (
            <div className="flex items-center gap-3">
              <Switch
                id="lock-mode"
                checked={draft.lockMode}
                onCheckedChange={(lockMode) => update({ lockMode }, 0)}
              />
              <Label htmlFor="lock-mode" className="font-normal">
                Lock it for everyone
              </Label>
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="theme-preview" className={THEME_SECTION}>
        <SectionHeading id="theme-preview" title="Preview" />
        <div className="grid gap-5">
          <ThemePreview
            tokens={tokens.light}
            accents={accents.light}
            style={draft.style}
            mode="light"
            orgName={orgName}
          />
          <ThemePreview
            tokens={tokens.dark}
            accents={accents.dark}
            style={draft.style}
            mode="dark"
            orgName={orgName}
          />
        </div>
      </section>

      {warnings.length > 0 && showIssues && (
        <section aria-labelledby="theme-contrast" className={THEME_SECTION}>
          <SectionHeading id="theme-contrast" title="Contrast">
            Text needs 4.5:1.
          </SectionHeading>
          <div className="grid gap-4 lg:grid-cols-2">
            <WarningList mode="light" warnings={lightWarnings} onApply={applyFix} />
            <WarningList
              mode="dark"
              warnings={darkWarnings}
              onApply={applyFix}
              derived={draft.dark === null}
            />
          </div>
        </section>
      )}

      {/* Changes apply as they're made; this bar says so and holds Undo. */}
      <div className="glass-light text-foreground sticky bottom-[calc(var(--shell-bottom,0px)+1rem)] z-10 flex flex-wrap items-center gap-2 rounded-[1.75rem] p-2 sm:rounded-full">
        <span
          role="status"
          aria-live="polite"
          className="inline-flex items-center gap-1.5 px-2 text-sm font-medium"
        >
          {status === "saving" ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Saving
            </>
          ) : status === "error" ? (
            <span className="text-destructive">{error}</span>
          ) : (
            <>
              <Check className="text-success size-4" aria-hidden="true" />
              {status === "saved" ? "Saved for everyone" : "Changes apply for everyone"}
            </>
          )}
        </span>
        {warnings.length === 0 ? (
          <Badge variant="success">
            <CheckCircle2 aria-hidden="true" />
            Passes AA
          </Badge>
        ) : (
          <button
            type="button"
            onClick={() => setShowIssues((s) => !s)}
            aria-expanded={showIssues}
            className="focus-glow rounded-full outline-none"
          >
            <Badge variant="accent">
              <TriangleAlert aria-hidden="true" />
              {warnings.length} contrast {warnings.length === 1 ? "issue" : "issues"}
            </Badge>
          </button>
        )}
        <span className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => void undo()}
          disabled={status === "saving" || history.length === 0}
        >
          <Undo2 aria-hidden="true" />
          Undo
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void reset()}
          disabled={status === "saving" || savedIsDefault}
        >
          Reset to default
        </Button>
      </div>
    </div>
  );
}

/** A preset's tokens, derived once (presets never change at runtime). */
const presetTokenCache = new Map<string, DerivedTheme>();
function presetTokens(preset: ThemePreset): DerivedTheme {
  let derived = presetTokenCache.get(preset.id);
  if (!derived) {
    derived = deriveTheme(preset.light, preset.dark, preset.glow ?? null);
    presetTokenCache.set(preset.id, derived);
  }
  return derived;
}

function SectionHeading({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <h2 id={id} className="heading text-[17px]">
        {title}
      </h2>
      {children && <p className="text-muted-foreground max-w-prose text-sm">{children}</p>}
    </div>
  );
}

const BLOCKS = [
  { label: "Coming up", className: "bg-block-quiet text-block-quiet-foreground" },
  { label: "Act now", className: "bg-block-alert text-block-alert-foreground" },
  { label: "Your answer", className: "bg-block-answer text-block-answer-foreground" },
  { label: "Progress", className: "bg-block-goal text-block-goal-foreground" },
] as const;

/**
 * One preset (guide section 18): its own page, buttons, block colours and
 * chart slots, rendered from its tokens in a scoped wrapper. The radio is
 * the whole card; the sample is decorative (the name and description label
 * the radio).
 */
function PresetCard({
  group,
  name,
  description,
  tokens,
  mode,
  badge,
  selected,
  onSelect,
  icon = false,
}: {
  group: string;
  name: string;
  description: string;
  tokens: TokenMap;
  mode: ColorMode;
  badge?: string | null;
  selected: boolean;
  onSelect: () => void;
  icon?: boolean;
}) {
  return (
    <label
      className={cn(
        "rounded-card group/preset relative block cursor-pointer transition-[transform,box-shadow] duration-200 ease-(--ease-ink) hover:-translate-y-0.5 motion-reduce:transform-none",
        "has-focus-visible:outline-foreground has-focus-visible:outline-2 has-focus-visible:outline-offset-4",
        selected ? "ring-foreground ring-offset-card ring-2 ring-offset-2" : "hover:shadow-e2",
      )}
    >
      <input type="radio" name={group} checked={selected} onChange={onSelect} className="sr-only" />
      <span
        style={{ ...tokenStyle(tokens), colorScheme: mode }}
        className={cn(
          "bg-background text-foreground ring-foreground/8 rounded-card relative isolate flex h-full flex-col gap-3 overflow-hidden p-4.5 ring-1",
          mode === "dark" && "dark",
        )}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -top-16 -z-10 h-40 bg-[radial-gradient(70%_80%_at_30%_0%,color-mix(in_oklab,var(--glow)_22%,transparent),transparent_75%)]"
        />
        <span className="flex items-center gap-2 pr-7">
          {icon && <Palette className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />}
          <span className="heading text-[17px] break-words">{name}</span>
          {badge && (
            <Badge variant="secondary" className="ml-auto">
              {badge}
            </Badge>
          )}
        </span>
        {selected && (
          <span className="bg-primary text-primary-foreground absolute top-4 right-4 grid size-5 place-items-center rounded-full">
            <Check className="size-3" strokeWidth={3} aria-hidden="true" />
          </span>
        )}
        <span className="text-muted-foreground min-h-9 text-[13px] leading-snug">
          {description}
        </span>
        <span aria-hidden="true" className="flex flex-wrap items-center gap-1.5">
          <span className={cn(buttonVariants({ variant: "create", size: "sm" }))}>
            <Plus aria-hidden="true" />
            New task
          </span>
          <span className={buttonVariants({ size: "sm" })}>Save</span>
          <Badge variant="destructive">
            <Flag aria-hidden="true" />
            Urgent
          </Badge>
        </span>
        <span aria-hidden="true" className="grid grid-cols-4 gap-1.5">
          {BLOCKS.map((b) => (
            <span
              key={b.label}
              className={cn(
                "flex h-12 items-end rounded-[12px] p-2 text-[11px] leading-tight font-semibold",
                b.className,
              )}
            >
              {b.label}
            </span>
          ))}
        </span>
        <span aria-hidden="true" className="flex items-center gap-1.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <span
              key={n}
              className="size-3 rounded-full"
              style={{ background: `var(--chart-${n})` }}
            />
          ))}
        </span>
      </span>
    </label>
  );
}

function WarningList({
  mode,
  warnings,
  onApply,
  derived = false,
}: {
  mode: ColorMode;
  warnings: ContrastWarning[];
  onApply: (warning: ContrastWarning) => void;
  derived?: boolean;
}) {
  const title = mode === "light" ? "Light" : "Dark";
  if (warnings.length === 0) {
    return (
      <p className="bg-tint-success text-tint-success-foreground rounded-tile flex items-center gap-2 self-start px-3.5 py-3 text-sm font-semibold">
        <CheckCircle2 className="size-4" aria-hidden="true" />
        {title}: passes AA
      </p>
    );
  }
  return (
    <div className="bg-muted/50 rounded-tile space-y-3 self-start p-4">
      <p className="text-warning flex items-center gap-2 text-sm font-semibold">
        <TriangleAlert className="size-4" aria-hidden="true" />
        {title}: {warnings.length} {warnings.length === 1 ? "pair fails" : "pairs fail"} AA
      </p>
      <ul className="divide-border/70 divide-y">
        {warnings.map((warning) => (
          <li
            key={`${warning.mode}-${warning.pair}`}
            className="flex flex-wrap items-center gap-3 py-2.5 text-sm first:pt-0 last:pb-0"
          >
            <span
              className="rounded-field ring-foreground/10 flex h-8 w-12 shrink-0 items-center justify-center text-xs font-semibold ring-1"
              style={{ backgroundColor: warning.bg, color: warning.fg }}
              aria-hidden="true"
            >
              Aa
            </span>
            <span className="min-w-0 flex-1 space-y-0.5">
              <span className="block font-medium">{warning.label}</span>
              <span className="text-muted-foreground block text-xs">
                {formatRatio(warning.ratio)}, needs {warning.required}:1 ({warning.fg} on{" "}
                {warning.bg})
                {warning.fix
                  ? `. Try ${ROLE_LABELS[warning.fix.role].toLowerCase()} ${warning.fix.value} for ${formatRatio(warning.fix.ratio)}${derived && warning.fix.mode === "dark" ? " (switches Dark to custom)" : ""}.`
                  : ". Adjust the background or surface colours."}
              </span>
            </span>
            {warning.fix && (
              <Button size="sm" variant="outline" onClick={() => onApply(warning)}>
                Apply fix
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
