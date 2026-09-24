"use client";

import { useId, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { deriveDarkRoles } from "@/lib/theme/derive";
import { DEFAULT_PRESET } from "@/lib/theme/presets";
import {
  ROLE_HINTS,
  ROLE_KEYS,
  ROLE_LABELS,
  type ColorMode,
  type RoleKey,
  type ThemeRoles,
} from "@/lib/theme/types";
import { HEX_RE } from "@/lib/theme/hex";
import { cn } from "@/lib/utils";

/**
 * The custom palette editor (lazy-loaded: only admins who pick Custom
 * download it). A colour picker plus a hex field per role, for Light and
 * Dark. Dark is derived from Light until the admin customises it.
 *
 * The hex field accepts only /^#[0-9a-f]{6}$/i (the same rule the save
 * action and the renderer enforce); anything else is shown as invalid and
 * never leaves this component.
 */
export default function CustomThemeEditor({
  light,
  dark,
  onChange,
}: {
  light: ThemeRoles;
  dark: ThemeRoles | null;
  onChange: (next: { light: ThemeRoles; dark: ThemeRoles | null }) => void;
}) {
  const derivedDark = deriveDarkRoles(light);

  function setRole(mode: ColorMode, role: RoleKey, value: string) {
    if (mode === "light") onChange({ light: { ...light, [role]: value }, dark });
    else onChange({ light, dark: { ...(dark ?? derivedDark), [role]: value } });
  }

  return (
    <Tabs defaultValue="light" className="gap-4">
      <TabsList>
        <TabsTrigger value="light">Light</TabsTrigger>
        <TabsTrigger value="dark">Dark</TabsTrigger>
      </TabsList>
      <TabsContent value="light" className="space-y-3">
        {ROLE_KEYS.map((role) => (
          <RoleField
            key={role}
            mode="light"
            role={role}
            value={light[role]}
            onChange={(value) => setRole("light", role, value)}
          />
        ))}
      </TabsContent>
      <TabsContent value="dark" className="space-y-3">
        <div className="flex items-start gap-3 rounded-lg border p-3">
          <Switch
            id="derive-dark"
            checked={dark === null}
            onCheckedChange={(auto) => onChange({ light, dark: auto ? null : derivedDark })}
          />
          <div className="space-y-0.5">
            <Label htmlFor="derive-dark">Derive dark from light</Label>
            <p className="text-muted-foreground text-xs">
              Dark mode uses a near-black page and lightens your primary and accent until they read
              on it. Turn this off to pick every dark colour yourself.
            </p>
          </div>
        </div>
        {ROLE_KEYS.map((role) => (
          <RoleField
            key={role}
            mode="dark"
            role={role}
            value={(dark ?? derivedDark)[role]}
            disabled={dark === null}
            onChange={(value) => setRole("dark", role, value)}
          />
        ))}
      </TabsContent>
    </Tabs>
  );
}

function RoleField({
  mode,
  role,
  value,
  disabled = false,
  onChange,
}: {
  mode: ColorMode;
  role: RoleKey;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [text, setText] = useState(value);
  // Follow outside changes (an applied contrast fix, the picker): the
  // "adjust state while rendering" pattern, no effect.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setText(value);
  }
  const invalid = !HEX_RE.test(text);
  const label = `${ROLE_LABELS[role]} (${mode})`;

  return (
    <div className="grid gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr] sm:items-center">
      <div>
        <Label htmlFor={`${id}-hex`}>{ROLE_LABELS[role]}</Label>
        <p className="text-muted-foreground text-xs">{ROLE_HINTS[role]}</p>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} colour picker`}
          value={HEX_RE.test(value) ? value : DEFAULT_PRESET[mode][role]}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value.toLowerCase())}
          className="border-input size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <Input
          id={`${id}-hex`}
          value={text}
          disabled={disabled}
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
          onBlur={() => setText(value)}
          className={cn("w-28 font-mono text-sm", invalid && "border-destructive")}
        />
        {invalid && (
          <p id={`${id}-error`} className="text-destructive text-xs">
            Use #rrggbb
          </p>
        )}
      </div>
    </div>
  );
}
