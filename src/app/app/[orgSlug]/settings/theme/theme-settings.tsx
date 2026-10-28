"use client";

import { Check, CheckCircle2, Flag, Palette, Plus, TriangleAlert } from "@/components/icons";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";

import { OrgBrand } from "@/components/theme/org-brand";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ACCENT_SCALE_NAMES, accentScale, withAccent, type AccentScale } from "@/lib/theme/accent";
import { formatRatio } from "@/lib/theme/color";
import { tokenStyle } from "@/lib/theme/css";
import { contrastWarnings, type ContrastWarning } from "@/lib/theme/contrast";
import {
  deriveDarkRoles,
  deriveTheme,
  TOKEN_NAMES,
  type DerivedTheme,
  type TokenMap,
} from "@/lib/theme/derive";
import {
  CUSTOM_PRESET_ID,
  UNTHEMED_PRESET_ID,
  findPreset,
  presetGlow,
  THEME_PRESETS,
  type ThemePreset,
} from "@/lib/theme/presets";
import {
  DEFAULT_THEME_STYLE,
  sameStyle,
  styleDeclarations,
  TEXT_SIZE_VALUES,
  type ThemeStyle,
} from "@/lib/theme/style";
import {
  ROLE_KEYS,
  ROLE_LABELS,
  type ColorMode,
  type LogoDisplayValue,
  type ThemeModeValue,
  type ThemeRoles,
} from "@/lib/theme/types";
import { cn } from "@/lib/utils";

import { saveThemeStep } from "@/app/onboarding/profile/actions";

import { resetOrgTheme, saveOrgTheme } from "./actions";
import { choiceClass, THEME_SECTION } from "./choice";
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

const MODE_OPTIONS: { value: ThemeModeValue; label: string; hint: string }[] = [
  {
    value: "SYSTEM",
    label: "Match device",
    hint: "Light or dark, following each member's device.",
  },
  { value: "LIGHT", label: "Light", hint: "Light until a member picks otherwise." },
  { value: "DARK", label: "Dark", hint: "Dark until a member picks otherwise." },
];

const LOGO_OPTIONS: { value: LogoDisplayValue; label: string; hint: string }[] = [
  {
    value: "LOGO_AND_NAME",
    label: "Logo and name",
    hint: "A square mark beside the organization name.",
  },
  {
    value: "LOGO_ONLY",
    label: "Logo only",
    hint: "Best for a wordmark that already says the name.",
  },
  { value: "NAME_ONLY", label: "Name only", hint: "No logo in the sidebar or on public pages." },
];

function sameRoles(a: ThemeRoles | null, b: ThemeRoles | null): boolean {
  if (a === null || b === null) return a === b;
  return ROLE_KEYS.every((key) => a[key] === b[key]);
}

function sameDraft(a: ThemeDraft, b: ThemeDraft): boolean {
  return (
    a.preset === b.preset &&
    a.mode === b.mode &&
    a.lockMode === b.lockMode &&
    a.logoDisplay === b.logoDisplay &&
    sameRoles(a.light, b.light) &&
    sameRoles(a.dark, b.dark) &&
    sameStyle(a.style, b.style)
  );
}

export function ThemeSettings({
  orgId,
  orgSlug,
  orgName,
  logo,
  hasLogo,
  initial,
  isDefault,
  personalThemeName = null,
}: {
  orgId: string;
  orgSlug: string;
  orgName: string;
  logo: unknown;
  hasLogo: boolean;
  initial: ThemeDraft;
  isDefault: boolean;
  /** The viewer's own theme, which is what they see instead of this one. */
  personalThemeName?: string | null;
}) {
  const { setTheme, resolvedTheme } = useTheme();
  const router = useRouter();
  const [usingOwn, setUsingOwn] = useState(personalThemeName !== null);
  const [switching, startSwitch] = useTransition();
  const [draft, setDraft] = useState<ThemeDraft>(initial);
  const [saved, setSaved] = useState<ThemeDraft>(initial);
  const [savedIsDefault, setSavedIsDefault] = useState(isDefault);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [previewApp, setPreviewApp] = useState(false);
  const [isPending, startTransition] = useTransition();
  // Radio groups are named per instance: a page Next keeps hidden (Activity)
  // or a streamed copy must not share a group with the visible one.
  const groupId = useId();
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  // The whole-app preview ends when this page is hidden or left.
  useLayoutEffect(() => () => setPreviewApp(false), []);

  const dirty = !sameDraft(draft, saved);
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

  function update(patch: Partial<ThemeDraft>) {
    setStatus(null);
    setDraft((current) => {
      const next = { ...current, ...patch };
      if (next.mode === "SYSTEM") next.lockMode = false;
      return next;
    });
  }

  function choosePreset(preset: ThemePreset) {
    update({ preset: preset.id, light: preset.light, dark: preset.dark });
  }

  function chooseCustom() {
    update({ preset: CUSTOM_PRESET_ID });
  }

  function applyFix(warning: ContrastWarning) {
    const fix = warning.fix;
    if (!fix) return;
    // The accent is Look and feel's while it overrides the palette.
    if (fix.role === "accent" && draft.style.accent) {
      if (fix.mode === "light") update({ style: { ...draft.style, accent: fix.value } });
      return;
    }
    if (fix.mode === "light") {
      update({ preset: CUSTOM_PRESET_ID, light: { ...draft.light, [fix.role]: fix.value } });
    } else {
      const dark = draft.dark ?? deriveDarkRoles(draft.light);
      update({ preset: CUSTOM_PRESET_ID, dark: { ...dark, [fix.role]: fix.value } });
    }
  }

  function save() {
    setStatus(null);
    startTransition(async () => {
      try {
        const result = await saveOrgTheme(orgId, draft);
        if (!result.ok) {
          setStatus({ kind: "error", text: result.error });
          return;
        }
        const presetId = findPreset(draft.preset) ? draft.preset : CUSTOM_PRESET_ID;
        const stored = { ...draft, preset: presetId };
        setDraft(stored);
        setSaved(stored);
        setSavedIsDefault(false);
        setPreviewApp(false);
        // The admin sees the mode they just chose (a mode picked earlier
        // from the user menu would otherwise keep winning in this browser).
        if (!usingOwn)
          setTheme(draft.mode === "LIGHT" ? "light" : draft.mode === "DARK" ? "dark" : "system");
        const count = result.warnings.length;
        setStatus({
          kind: "ok",
          text:
            count === 0
              ? "Saved. The theme passes WCAG AA in light and dark."
              : `Saved with ${count} contrast ${count === 1 ? "warning" : "warnings"}.`,
        });
      } catch {
        setStatus({ kind: "error", text: "The theme could not be saved. Try again." });
      }
    });
  }

  function reset() {
    setStatus(null);
    startTransition(async () => {
      try {
        const result = await resetOrgTheme(orgId);
        if (!result.ok) {
          setStatus({ kind: "error", text: result.error });
          return;
        }
        const defaults = findPreset(UNTHEMED_PRESET_ID)!;
        const next: ThemeDraft = {
          preset: UNTHEMED_PRESET_ID,
          mode: "LIGHT",
          lockMode: false,
          logoDisplay: "LOGO_AND_NAME",
          light: defaults.light,
          dark: defaults.dark,
          style: DEFAULT_THEME_STYLE,
        };
        setDraft(next);
        setSaved(next);
        setSavedIsDefault(true);
        setPreviewApp(false);
        setStatus({ kind: "ok", text: "Reset to the default theme." });
      } catch {
        setStatus({ kind: "error", text: "The theme could not be reset. Try again." });
      }
    });
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
      <WholeAppPreview enabled={previewApp} tokens={tokens} accents={accents} style={draft.style} />

      <section aria-labelledby="theme-presets" className={THEME_SECTION}>
        <SectionHeading id="theme-presets" title="Palette">
          Start from a preset, or choose Custom to pick each colour. Every preset passes WCAG AA in
          light and dark, and each card shows it in the mode you&apos;re in.
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
              badge={
                savedPreset === preset.id
                  ? "In use"
                  : preset.id === UNTHEMED_PRESET_ID
                    ? "Default"
                    : null
              }
              selected={draft.preset === preset.id}
              onSelect={() => choosePreset(preset)}
            />
          ))}
          <PresetCard
            group={`${groupId}-preset`}
            name="Custom"
            description="Your own five colours for light, and optionally dark."
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
            Pick the five roles. Everything else (borders, muted text, hover states, charts, success
            and warning colours) is derived from them.
          </SectionHeading>
          <CustomThemeEditor
            light={draft.light}
            dark={draft.dark}
            onChange={({ light, dark }) => update({ preset: CUSTOM_PRESET_ID, light, dark })}
          />
        </section>
      )}

      <section aria-labelledby="theme-look" className={THEME_SECTION}>
        <SectionHeading id="theme-look" title="Look and feel">
          Fine-tune the palette: your own accent colour for highlights, badges and charts, the glow,
          plus corners, text size and fonts. These apply to everyone, on every page of the
          organization.
        </SectionHeading>
        <LookAndFeel
          groupId={`${groupId}-look`}
          style={draft.style}
          paletteAccent={draft.light.accent}
          paletteGlow={presetGlow(draft.preset) ?? draft.light.accent}
          tokens={tokens}
          onChange={(style) => update({ style })}
        />
      </section>

      <section aria-labelledby="theme-preview" className={THEME_SECTION}>
        <SectionHeading id="theme-preview" title="Preview">
          Your colours on a mini Overview, in light and dark. Unsaved changes show here first.
        </SectionHeading>
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
        <div className="bg-muted/40 rounded-tile flex items-center gap-3 p-3">
          <Switch id="preview-app" checked={previewApp} onCheckedChange={setPreviewApp} />
          <Label htmlFor="preview-app" className="font-normal">
            Preview on the whole app until I save or leave this page
          </Label>
        </div>
      </section>

      <section aria-labelledby="theme-contrast" className={THEME_SECTION} aria-live="polite">
        <SectionHeading id="theme-contrast" title="Contrast check">
          WCAG AA: 4.5:1 for text, 3:1 for the focus ring and chart colours. A theme that fails can
          still be saved, but some members may struggle to read it.
        </SectionHeading>
        {warnings.length === 0 ? (
          <p className="bg-tint-success text-tint-success-foreground rounded-tile flex items-center gap-2 px-3.5 py-3 text-sm font-semibold">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Passes WCAG AA in light and dark.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <WarningList mode="light" warnings={lightWarnings} onApply={applyFix} />
            <WarningList
              mode="dark"
              warnings={darkWarnings}
              onApply={applyFix}
              derived={draft.dark === null}
            />
          </div>
        )}
      </section>

      <section aria-labelledby="theme-mode" className={THEME_SECTION}>
        <SectionHeading id="theme-mode" title="Light and dark mode">
          The mode members see until they pick their own in the user menu.
        </SectionHeading>
        <OptionGroup
          name={`${groupId}-mode`}
          labelledBy="theme-mode"
          options={MODE_OPTIONS}
          value={draft.mode}
          onChange={(mode) => update({ mode })}
        />
        <div className="bg-muted/40 rounded-tile flex items-start gap-3 p-3.5">
          <Switch
            id="lock-mode"
            checked={draft.lockMode}
            disabled={draft.mode === "SYSTEM"}
            onCheckedChange={(lockMode) => update({ lockMode })}
            aria-describedby="lock-mode-hint"
          />
          <div className="space-y-0.5">
            <Label htmlFor="lock-mode">Lock the mode for everyone</Label>
            <p id="lock-mode-hint" className="text-muted-foreground text-xs">
              {draft.mode === "SYSTEM"
                ? "Choose Light or Dark to lock it."
                : `Members always see ${draft.mode === "LIGHT" ? "light" : "dark"} mode and cannot switch.`}
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="theme-logo" className={THEME_SECTION}>
        <SectionHeading id="theme-logo" title="Logo display">
          How the logo shows in the sidebar and on the organization&apos;s public poll and invite
          pages.{" "}
          {hasLogo ? (
            <>
              Change the logo in{" "}
              <Link
                href={`/app/${orgSlug}/settings/general`}
                className="text-foreground font-medium underline underline-offset-4"
              >
                General
              </Link>
              .
            </>
          ) : (
            <>
              No logo yet: upload one in{" "}
              <Link
                href={`/app/${orgSlug}/settings/general`}
                className="text-foreground font-medium underline underline-offset-4"
              >
                General
              </Link>
              . Until then the sidebar shows the organization&apos;s initials in the primary colour.
            </>
          )}
        </SectionHeading>
        <OptionGroup
          name={`${groupId}-logo`}
          labelledBy="theme-logo"
          options={LOGO_OPTIONS}
          value={draft.logoDisplay}
          onChange={(logoDisplay) => update({ logoDisplay })}
        />
        <div className="bg-sidebar text-sidebar-foreground rounded-tile ring-foreground/6 w-64 p-3 ring-1">
          <OrgBrand name={orgName} logo={logo} display={draft.logoDisplay} />
        </div>
      </section>

      {/* The one commit for the whole page: a floating bar that stays in reach. */}
      <div className="glass-light text-foreground sticky bottom-[calc(var(--shell-bottom,0px)+1rem)] z-10 flex flex-wrap items-center gap-2 rounded-[1.75rem] p-2 sm:rounded-full">
        <Button onClick={save} disabled={isPending || !dirty}>
          {isPending ? "Saving…" : "Save theme"}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setDraft(saved);
            setStatus(null);
            setPreviewApp(false);
          }}
          disabled={isPending || !dirty}
        >
          Discard changes
        </Button>
        <ResetButton disabled={isPending || savedIsDefault} onConfirm={reset} />
        {status && (
          <p
            role="status"
            className={cn(
              "px-2 text-sm font-medium",
              status.kind === "error"
                ? "text-destructive"
                : warnings.length > 0
                  ? "text-warning"
                  : "text-success",
            )}
          >
            {status.text}
          </p>
        )}
        {!status && dirty && (
          <p className="text-muted-foreground inline-flex items-center gap-2 px-2 text-sm">
            <span aria-hidden="true" className="bg-glow size-2 rounded-full" />
            Unsaved changes
          </p>
        )}
        {status?.kind === "ok" && usingOwn && (
          <p className="text-warning flex flex-wrap items-center gap-2 px-2 text-sm">
            Everyone else sees it now. You still see your own theme ({personalThemeName}).
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={switching}
              onClick={() =>
                startSwitch(async () => {
                  const result = await saveThemeStep(null);
                  if (!result.ok) return;
                  setUsingOwn(false);
                  setTheme(
                    saved.mode === "LIGHT" ? "light" : saved.mode === "DARK" ? "dark" : "system",
                  );
                  setStatus({ kind: "ok", text: "Saved. You see the organization theme now too." });
                  router.refresh();
                })
              }
            >
              Show me the organization theme
            </Button>
          </p>
        )}
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
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <h2 id={id} className="heading text-[17px]">
        {title}
      </h2>
      <p className="text-muted-foreground max-w-prose text-sm">{children}</p>
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
          <span className="heading truncate text-[17px]">{name}</span>
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
          <span className={buttonVariants({ variant: "create", size: "sm" })}>
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

function OptionGroup<T extends string>({
  name,
  labelledBy,
  options,
  value,
  onChange,
}: {
  name: string;
  labelledBy: string;
  options: { value: T; label: string; hint: string }[];
  value: T;
  onChange: (value: T) => void;
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
            className="accent-foreground mt-0.5 size-4 shrink-0"
          />
          <span className="space-y-0.5">
            <span className="block font-semibold">{option.label}</span>
            <span className="text-muted-foreground block text-xs">{option.hint}</span>
          </span>
        </label>
      ))}
    </div>
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

function ResetButton({ disabled, onConfirm }: { disabled: boolean; onConfirm: () => void }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" disabled={disabled}>
          Reset to default
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset the theme?</DialogTitle>
          <DialogDescription>
            Everyone goes back to the default colours (Graphite) in light mode, and the logo
            beside the name. You can pick a theme again at any time.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="destructive" onClick={onConfirm}>
              Reset theme
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The optional whole-app preview: writes the draft's tokens and accent
 * scale (for the mode the viewer is in) and its Look and feel as inline
 * custom properties on <html>, which beat both globals.css and the org's
 * <style>. Everything it set is removed when it is switched off, on save,
 * on discard and when the page unmounts.
 */
function WholeAppPreview({
  enabled,
  tokens,
  accents,
  style,
}: {
  enabled: boolean;
  tokens: DerivedTheme;
  accents: { light: AccentScale; dark: AccentScale };
  style: ThemeStyle;
}) {
  const { resolvedTheme } = useTheme();
  const mode: ColorMode = resolvedTheme === "dark" ? "dark" : "light";
  const active = tokens[mode];
  const scale = accents[mode];

  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    const look = styleDeclarations(style);
    for (const name of TOKEN_NAMES) root.style.setProperty(`--${name}`, active[name]);
    for (const name of ACCENT_SCALE_NAMES) root.style.setProperty(`--color-${name}`, scale[name]);
    for (const [name, value] of Object.entries(look)) root.style.setProperty(name, value);
    root.style.fontSize = TEXT_SIZE_VALUES[style.textSize];
    return () => {
      for (const name of TOKEN_NAMES) root.style.removeProperty(`--${name}`);
      for (const name of ACCENT_SCALE_NAMES) root.style.removeProperty(`--color-${name}`);
      for (const name of Object.keys(look)) root.style.removeProperty(name);
      root.style.removeProperty("font-size");
    };
  }, [enabled, active, scale, style]);

  return null;
}
