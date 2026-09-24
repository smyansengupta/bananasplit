"use client";

import { Check, CheckCircle2, Palette, TriangleAlert } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useTheme } from "next-themes";
import {
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
  useTransition,
} from "react";

import { OrgBrand } from "@/components/theme/org-brand";
import { Button } from "@/components/ui/button";
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
import { formatRatio } from "@/lib/theme/color";
import { contrastWarnings, type ContrastWarning } from "@/lib/theme/contrast";
import { deriveDarkRoles, deriveTheme, TOKEN_NAMES, type DerivedTheme } from "@/lib/theme/derive";
import {
  CUSTOM_PRESET_ID,
  DEFAULT_PRESET_ID,
  findPreset,
  THEME_PRESETS,
  type ThemePreset,
} from "@/lib/theme/presets";
import {
  ROLE_KEYS,
  ROLE_LABELS,
  type ColorMode,
  type LogoDisplayValue,
  type ThemeModeValue,
  type ThemeRoles,
} from "@/lib/theme/types";
import { cn } from "@/lib/utils";

import { resetOrgTheme, saveOrgTheme } from "./actions";
import { ThemePreview } from "./theme-preview";

// Only admins who open Custom download the editor.
const CustomThemeEditor = dynamic(() => import("./custom-editor"), {
  ssr: false,
  loading: () => <p className="text-muted-foreground text-sm">Loading the editor…</p>,
});

export interface ThemeDraft {
  preset: string;
  mode: ThemeModeValue;
  lockMode: boolean;
  logoDisplay: LogoDisplayValue;
  light: ThemeRoles;
  /** null = derived from light. */
  dark: ThemeRoles | null;
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
  { value: "LOGO_AND_NAME", label: "Logo and name", hint: "A square mark beside the org name." },
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
    sameRoles(a.dark, b.dark)
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
}: {
  orgId: string;
  orgSlug: string;
  orgName: string;
  logo: unknown;
  hasLogo: boolean;
  initial: ThemeDraft;
  isDefault: boolean;
}) {
  const [draft, setDraft] = useState<ThemeDraft>(initial);
  const [saved, setSaved] = useState<ThemeDraft>(initial);
  const [savedIsDefault, setSavedIsDefault] = useState(isDefault);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [previewApp, setPreviewApp] = useState(false);
  const [isPending, startTransition] = useTransition();
  // Radio groups are named per instance: a page Next keeps hidden (Activity)
  // or a streamed copy must not share a group with the visible one.
  const groupId = useId();
  // The whole-app preview ends when this page is hidden or left.
  useLayoutEffect(() => () => setPreviewApp(false), []);

  const dirty = !sameDraft(draft, saved);
  const tokens = useMemo(() => deriveTheme(draft.light, draft.dark), [draft.light, draft.dark]);
  // The fix search re-derives the theme many times: keep typing responsive.
  const deferredLight = useDeferredValue(draft.light);
  const deferredDark = useDeferredValue(draft.dark);
  const warnings = useMemo(
    () => contrastWarnings(deferredLight, deferredDark),
    [deferredLight, deferredDark],
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
        const defaults = findPreset(DEFAULT_PRESET_ID)!;
        const next: ThemeDraft = {
          preset: DEFAULT_PRESET_ID,
          mode: "SYSTEM",
          lockMode: false,
          logoDisplay: "LOGO_AND_NAME",
          light: defaults.light,
          dark: defaults.dark,
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

  return (
    <div className="space-y-10">
      <WholeAppPreview enabled={previewApp} tokens={tokens} />

      <section aria-labelledby="theme-presets" className="space-y-3">
        <SectionHeading id="theme-presets" title="Palette">
          Start from a preset, or choose Custom to pick each colour. Every preset passes WCAG AA in
          light and dark.
        </SectionHeading>
        <div
          role="radiogroup"
          aria-labelledby="theme-presets"
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
        >
          {THEME_PRESETS.map((preset) => (
            <PresetCard
              key={preset.id}
              group={`${groupId}-preset`}
              name={preset.name}
              description={preset.description}
              light={preset.light}
              dark={preset.dark}
              selected={draft.preset === preset.id}
              onSelect={() => choosePreset(preset)}
            />
          ))}
          <PresetCard
            group={`${groupId}-preset`}
            name="Custom"
            description="Your own five colours for light, and optionally dark."
            light={draft.light}
            dark={draft.dark ?? deriveDarkRoles(draft.light)}
            selected={isCustom}
            onSelect={chooseCustom}
            icon
          />
        </div>
      </section>

      {isCustom && (
        <section aria-labelledby="theme-custom" className="space-y-3">
          <SectionHeading id="theme-custom" title="Custom colours">
            Pick the five roles. Everything else (borders, muted text, hover states, charts, success
            and warning colours) is derived from them.
          </SectionHeading>
          <div className="rounded-xl border p-4">
            <CustomThemeEditor
              light={draft.light}
              dark={draft.dark}
              onChange={({ light, dark }) => update({ preset: CUSTOM_PRESET_ID, light, dark })}
            />
          </div>
        </section>
      )}

      <section aria-labelledby="theme-preview" className="space-y-3">
        <SectionHeading id="theme-preview" title="Preview">
          Unsaved changes show here first.
        </SectionHeading>
        <div className="grid gap-4 lg:grid-cols-2">
          <ThemePreview tokens={tokens.light} mode="light" orgName={orgName} />
          <ThemePreview tokens={tokens.dark} mode="dark" orgName={orgName} />
        </div>
        <div className="flex items-center gap-3">
          <Switch id="preview-app" checked={previewApp} onCheckedChange={setPreviewApp} />
          <Label htmlFor="preview-app" className="font-normal">
            Preview on the whole app until I save or leave this page
          </Label>
        </div>
      </section>

      <section aria-labelledby="theme-contrast" className="space-y-3" aria-live="polite">
        <SectionHeading id="theme-contrast" title="Contrast check">
          WCAG AA: 4.5:1 for text, 3:1 for the focus ring and chart colours. A theme that fails can
          still be saved, but some members may struggle to read it.
        </SectionHeading>
        {warnings.length === 0 ? (
          <p className="text-success flex items-center gap-2 text-sm font-medium">
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

      <section aria-labelledby="theme-mode" className="space-y-3">
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
        <div className="flex items-start gap-3 rounded-lg border p-3">
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

      <section aria-labelledby="theme-logo" className="space-y-3">
        <SectionHeading id="theme-logo" title="Logo display">
          How the logo shows in the sidebar and on the org&apos;s public poll and invite pages.{" "}
          {hasLogo ? (
            <>
              Change the logo in{" "}
              <Link
                href={`/app/${orgSlug}/settings/general`}
                className="text-primary underline underline-offset-4"
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
                className="text-primary underline underline-offset-4"
              >
                General
              </Link>
              . Until then the sidebar shows the org&apos;s initials in the primary colour.
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
        <div className="bg-sidebar text-sidebar-foreground w-64 rounded-lg border p-3">
          <OrgBrand name={orgName} logo={logo} display={draft.logoDisplay} />
        </div>
      </section>

      <div className="bg-background/95 supports-backdrop-filter:bg-background/80 sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
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
              "text-sm",
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
        {!status && dirty && <p className="text-muted-foreground text-sm">Unsaved changes</p>}
      </div>
    </div>
  );
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
      <h2 id={id} className="text-base font-semibold">
        {title}
      </h2>
      <p className="text-muted-foreground max-w-prose text-sm">{children}</p>
    </div>
  );
}

function Swatches({ roles, label }: { roles: ThemeRoles; label: string }) {
  return (
    <div
      className="flex h-6 overflow-hidden rounded-md border"
      role="img"
      aria-label={`${label}: ${ROLE_KEYS.map((key) => `${ROLE_LABELS[key]} ${roles[key]}`).join(", ")}`}
    >
      {ROLE_KEYS.map((key) => (
        <span key={key} className="flex-1" style={{ backgroundColor: roles[key] }} />
      ))}
    </div>
  );
}

function PresetCard({
  group,
  name,
  description,
  light,
  dark,
  selected,
  onSelect,
  icon = false,
}: {
  group: string;
  name: string;
  description: string;
  light: ThemeRoles;
  dark: ThemeRoles;
  selected: boolean;
  onSelect: () => void;
  icon?: boolean;
}) {
  return (
    <label
      className={cn(
        "bg-card text-card-foreground has-focus-visible:ring-ring/50 relative flex cursor-pointer flex-col gap-3 rounded-xl border p-4 transition-colors has-focus-visible:ring-3",
        selected ? "border-primary ring-primary ring-1" : "hover:border-foreground/30",
      )}
    >
      <input type="radio" name={group} checked={selected} onChange={onSelect} className="sr-only" />
      <span className="flex items-center gap-2 pr-6">
        {icon && <Palette className="text-muted-foreground size-4" aria-hidden="true" />}
        <span className="font-medium">{name}</span>
      </span>
      {selected && (
        <span className="bg-primary text-primary-foreground absolute top-3 right-3 flex size-5 items-center justify-center rounded-full">
          <Check className="size-3" aria-hidden="true" />
        </span>
      )}
      <span className="text-muted-foreground text-xs">{description}</span>
      <span className="grid gap-1.5">
        <Swatches roles={light} label="Light" />
        <Swatches roles={dark} label="Dark" />
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
    <div role="radiogroup" aria-labelledby={labelledBy} className="grid gap-2 sm:grid-cols-3">
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            "has-focus-visible:ring-ring/50 flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-sm has-focus-visible:ring-3",
            value === option.value && "border-primary ring-primary ring-1",
          )}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="accent-primary mt-0.5 size-4 shrink-0"
          />
          <span className="space-y-0.5">
            <span className="block font-medium">{option.label}</span>
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
      <div className="self-start rounded-lg border p-3">
        <p className="text-success flex items-center gap-2 text-sm font-medium">
          <CheckCircle2 className="size-4" aria-hidden="true" />
          {title}: passes AA
        </p>
      </div>
    );
  }
  return (
    <div className="border-warning/40 bg-warning/5 space-y-3 self-start rounded-lg border p-3">
      <p className="text-warning flex items-center gap-2 text-sm font-medium">
        <TriangleAlert className="size-4" aria-hidden="true" />
        {title}: {warnings.length} {warnings.length === 1 ? "pair fails" : "pairs fail"} AA
      </p>
      <ul className="space-y-3">
        {warnings.map((warning) => (
          <li
            key={`${warning.mode}-${warning.pair}`}
            className="flex flex-wrap items-center gap-3 text-sm"
          >
            <span
              className="flex h-8 w-12 shrink-0 items-center justify-center rounded-md border text-xs font-semibold"
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
            Everyone goes back to the default colours, the device&apos;s light or dark mode, and the
            logo beside the name. You can pick a theme again at any time.
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
 * The optional whole-app preview: writes the draft's tokens (for the mode
 * the viewer is in) as inline custom properties on <html>, which beat both
 * globals.css and the org's <style>. Everything it set is removed when it is
 * switched off, on save, on discard and when the page unmounts.
 */
function WholeAppPreview({ enabled, tokens }: { enabled: boolean; tokens: DerivedTheme }) {
  const { resolvedTheme } = useTheme();
  const mode: ColorMode = resolvedTheme === "dark" ? "dark" : "light";
  const active = tokens[mode];

  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    for (const name of TOKEN_NAMES) root.style.setProperty(`--${name}`, active[name]);
    return () => {
      for (const name of TOKEN_NAMES) root.style.removeProperty(`--${name}`);
    };
  }, [enabled, active]);

  return null;
}
