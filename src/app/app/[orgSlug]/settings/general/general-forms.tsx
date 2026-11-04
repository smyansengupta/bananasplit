"use client";

import { Building2, Camera, ImageUp, Loader2, Trash2 } from "@/components/icons";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import {
  ACCEPTED_IMAGE_TYPES,
  cropToSquare,
  MAX_SOURCE_BYTES,
  type PixelArea,
} from "@/components/images/crop-image";
import { ReminderPicker } from "@/components/meetings/reminder-picker";
import { PulseFields } from "@/components/onboarding/pulse-fields";
import { SavedMark, useSaveOnChange } from "@/components/ui/autosave";
import { Button } from "@/components/ui/button";
import { FieldSelect } from "@/components/ui/field-select";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import type { PulseSettings } from "@/lib/pulse/settings";
import { slugify } from "@/lib/slug";
import { WEEKDAY_NAMES } from "@/lib/tasks/dates";
import type { LogoDisplayValue } from "@/lib/theme/types";
import { timeZoneOptions } from "@/lib/timezones";
import { cn } from "@/lib/utils";

import { savePulseSettingsAction } from "../pulse/actions";
import { SettingsStatus } from "../settings-card";
import { updateLogoDisplay } from "../theme/actions";
import {
  renameOrgSlug,
  updateMeetingReminderDefault,
  updateOrgName,
  updateOrgTimezone,
  updateWeeklyUpdateDay,
} from "./actions";

type Status = { tone: "ok" | "error"; text: string } | null;

const loadCropDialog = () => import("@/components/images/crop-dialog");
const CropDialog = dynamic(loadCropDialog, { ssr: false });

/**
 * One field inside a settings card: its label on top, the "Saved" mark
 * beside it, the control below, and a hint under that. Every field on
 * General saves the moment it changes (text fields when they lose focus or
 * on Enter); there is no Save button.
 */
function Field({
  label,
  htmlFor,
  mark,
  hint,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  mark?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-h-5 items-center justify-between gap-3">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm font-medium">
            {label}
          </label>
        ) : (
          <span className="text-sm font-medium">{label}</span>
        )}
        {mark}
      </div>
      {children}
      {hint && <p className="text-muted-foreground text-[13px]">{hint}</p>}
    </div>
  );
}

/** The error a General action returned, or null when it worked. */
const errorOf = (result: { error?: string | null }) => result.error ?? null;

export function NameField({
  orgId,
  name,
  canEdit,
}: {
  orgId: string;
  name: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(name);
  const { status, error, save } = useSaveOnChange(
    async (next: string) => {
      const result = errorOf(await updateOrgName(orgId, next));
      if (!result) router.refresh();
      return result;
    },
    { initial: name },
  );
  const commit = () => {
    const next = value.trim();
    if (!next) {
      setValue(name);
      return;
    }
    void save(next);
  };
  return (
    <Field label="Name" htmlFor="org-name" mark={<SavedMark status={status} error={error} />}>
      <Input
        id="org-name"
        value={value}
        maxLength={80}
        disabled={!canEdit}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        className="max-w-md"
      />
    </Field>
  );
}

/**
 * The URL, edited in place. Old links keep redirecting and the old URL
 * stays this organization's, so nothing is confirmed: Change saves it and
 * the page moves to the new address.
 */
export function UrlField({
  orgId,
  slug,
  canEdit,
  appOrigin,
}: {
  orgId: string;
  slug: string;
  canEdit: boolean;
  appOrigin: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(slug);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = slugify(value);
  const changed = Boolean(next) && next !== slug;
  const host = appOrigin.replace(/^https?:\/\//, "");

  async function change() {
    if (!changed) return;
    setBusy(true);
    setError(null);
    const result = await renameOrgSlug(orgId, next);
    setBusy(false);
    if (result.error || !result.slug) {
      setError(result.error ?? "Couldn't change the URL.");
      return;
    }
    router.replace(`/app/${result.slug}/settings/general`);
  }

  return (
    <Field
      label="URL"
      htmlFor="org-slug"
      hint={
        error ? (
          <span role="alert" className="text-tint-danger-foreground">
            {error}
          </span>
        ) : changed ? (
          <>
            Old links redirect. The events feed moves to{" "}
            <code className="break-all">
              {appOrigin}/api/public/{next}/events
            </code>
            , so update SUITE_EVENTS_URL on Netlify.
          </>
        ) : canEdit ? undefined : (
          "Only an owner can change it."
        )
      }
    >
      <div className="flex max-w-xl flex-wrap items-center gap-2">
        <span className="bg-muted/60 rounded-field flex h-10 min-w-0 flex-1 items-center gap-0.5 px-3.5 font-mono text-[13px]">
          <span className="text-muted-foreground min-w-0 shrink truncate">{host}/app/</span>
          <input
            id="org-slug"
            value={value}
            disabled={!canEdit || busy}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void change();
              }
              if (e.key === "Escape") setValue(slug);
            }}
            className="min-w-24 flex-1 bg-transparent outline-none disabled:cursor-default"
          />
        </span>
        {canEdit && changed && (
          <Button type="button" variant="outline" disabled={busy} onClick={change}>
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Change
          </Button>
        )}
      </div>
    </Field>
  );
}

export function TimezoneField({
  orgId,
  timezone,
  canEdit,
}: {
  orgId: string;
  timezone: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const zones = useMemo(() => timeZoneOptions(), []);
  const [value, setValue] = useState(timezone);
  const { status, error, save } = useSaveOnChange(
    async (next: string) => {
      const result = errorOf(await updateOrgTimezone(orgId, next));
      if (!result) router.refresh();
      return result;
    },
    { initial: timezone },
  );
  return (
    <Field
      label="Timezone"
      htmlFor="org-timezone"
      mark={<SavedMark status={status} error={error} />}
      hint="Members can override it in their profile."
    >
      <FieldSelect
        id="org-timezone"
        value={value}
        disabled={!canEdit}
        onChange={(e) => {
          setValue(e.target.value);
          void save(e.target.value);
        }}
        className="w-full max-w-md"
      >
        {!zones.includes(value) && <option value={value}>{value}</option>}
        {zones.map((z) => (
          <option key={z} value={z}>
            {z}
          </option>
        ))}
      </FieldSelect>
    </Field>
  );
}

const LOGO_DISPLAY_OPTIONS: { value: LogoDisplayValue; label: string }[] = [
  { value: "LOGO_AND_NAME", label: "Logo and name" },
  { value: "LOGO_ONLY", label: "Logo" },
  { value: "NAME_ONLY", label: "Name" },
];

/** How the picture shows in the sidebar and on public pages, right under the picture. */
export function LogoDisplayField({
  orgId,
  value: initial,
}: {
  orgId: string;
  value: LogoDisplayValue;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const { status, error, save } = useSaveOnChange(
    async (next: LogoDisplayValue) => {
      const result = await updateLogoDisplay(orgId, next);
      if ("ok" in result && result.ok) {
        router.refresh();
        return null;
      }
      return "error" in result && result.error ? result.error : "Couldn't save.";
    },
    { initial },
  );
  return (
    <Field label="In the sidebar" mark={<SavedMark status={status} error={error} />}>
      <div className="-mx-1 max-w-full overflow-x-auto px-1 pb-1">
        <Segmented
          label="How the logo shows"
          value={value}
          onSelect={(v) => {
            setValue(v as LogoDisplayValue);
            void save(v as LogoDisplayValue);
          }}
          options={LOGO_DISPLAY_OPTIONS}
        />
      </div>
    </Field>
  );
}

/**
 * The reminders a new meeting starts with (OrgSettings.meetingReminderMinutes),
 * saved as each one is toggled. Meetings that exist keep their own.
 */
export function MeetingRemindersField({
  orgId,
  minutes,
  canEdit,
}: {
  orgId: string;
  minutes: number[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(minutes);
  const { status, error, save } = useSaveOnChange(async (next: number[]) => {
    const result = errorOf(await updateMeetingReminderDefault(orgId, next));
    if (!result) router.refresh();
    return result;
  });
  return (
    <Field
      label="Meeting reminders"
      mark={<SavedMark status={status} error={error} />}
      hint="Default for new meetings."
    >
      <ReminderPicker
        id="org-meeting-reminders"
        value={value}
        onChange={(next) => {
          setValue(next);
          void save(next);
        }}
        disabled={!canEdit}
      />
    </Field>
  );
}

/** Monday first, as the pulse day reads. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/**
 * The day the weekly update is due, Mon to Sun as buttons. A week is the
 * seven days ending that day, and leads who haven't posted get a reminder
 * that evening.
 */
export function WeeklyUpdateDayField({
  orgId,
  day,
  canEdit,
}: {
  orgId: string;
  day: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(day);
  const { status, error, save } = useSaveOnChange(
    async (next: number) => {
      const result = errorOf(await updateWeeklyUpdateDay(orgId, next));
      if (!result) router.refresh();
      return result;
    },
    { initial: day },
  );
  return (
    <Field
      label="Weekly update due"
      mark={<SavedMark status={status} error={error} />}
      hint={`Leads who haven't posted get a reminder ${WEEKDAY_NAMES[value]} evening.`}
    >
      <fieldset disabled={!canEdit} className="-mx-1 max-w-full overflow-x-auto px-1 pb-1">
        <Segmented
          label="Weekly update day"
          value={String(value)}
          onSelect={(v) => {
            setValue(Number(v));
            void save(Number(v));
          }}
          options={WEEK_ORDER.map((d) => ({
            value: String(d),
            label: WEEKDAY_NAMES[d]!.slice(0, 3),
            title: WEEKDAY_NAMES[d],
          }))}
        />
      </fieldset>
    </Field>
  );
}

/**
 * The weekly pulse (was its own Admin panel page): on or off, then its
 * day, time, audience and channels, each saved as it changes.
 */
export function PulseField({
  orgId,
  orgSlug,
  initial,
  canEdit,
}: {
  orgId: string;
  orgSlug: string;
  initial: PulseSettings;
  canEdit: boolean;
}) {
  const id = useId();
  const [value, setValue] = useState(initial);
  const { status, error, save } = useSaveOnChange(async (next: PulseSettings) => {
    const result = await savePulseSettingsAction(orgId, next);
    return result.ok ? null : (result.error ?? "Couldn't save.");
  });
  const change = (next: PulseSettings) => {
    setValue(next);
    void save(next);
  };
  return (
    <div id="pulse" className="flex scroll-mt-24 flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <label htmlFor={id} className="text-sm font-medium">
            Weekly pulse
          </label>
          <span className="text-muted-foreground text-[13px]">
            A recap of the week.{" "}
            <Link
              href={`/app/${orgSlug}/pulse`}
              className="text-foreground underline underline-offset-4"
            >
              Past weeks
            </Link>
          </span>
        </div>
        <span className="flex items-center gap-3">
          <SavedMark status={status} error={error} />
          <Switch
            id={id}
            checked={value.pulseEnabled}
            disabled={!canEdit}
            onCheckedChange={(on) => change({ ...value, pulseEnabled: on })}
          />
        </span>
      </div>
      {value.pulseEnabled && <PulseFields value={value} onChange={change} disabled={!canEdit} />}
    </div>
  );
}

/**
 * The club picture (Organization.logo): click it (or drop a file on it),
 * crop it to a square, upload the 512px result. Shown in the sidebar, the
 * org switcher, invite and join pages.
 */
export function LogoForm({
  orgId,
  logoUrl,
  orgName,
  canEdit,
  bare = false,
}: {
  orgId: string;
  logoUrl: string | null;
  orgName: string;
  canEdit: boolean;
  /** Onboarding: just the big square to click, no card and no copy. */
  bare?: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<string | null>(null);
  const [cropError, setCropError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!source) return;
    return () => URL.revokeObjectURL(source);
  }, [source]);

  async function send(method: "POST" | "DELETE", file?: Blob): Promise<string | null> {
    setBusy(true);
    setStatus(null);
    try {
      let body: FormData | undefined;
      if (file) {
        body = new FormData();
        body.set("file", file, file.type === "image/webp" ? "club.webp" : "club.jpg");
      }
      const res = await fetch(`/api/orgs/${encodeURIComponent(orgId)}/logo`, { method, body });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return data.error ?? "The upload failed.";
      setStatus({ tone: "ok", text: method === "POST" ? "Saved" : "Removed" });
      router.refresh();
      return null;
    } catch {
      return "The upload failed. Check your connection.";
    } finally {
      setBusy(false);
    }
  }

  function pick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) take(file);
  }

  /** A picked or dropped file: checked, then on to the crop. */
  function take(file: File) {
    if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      setStatus({ tone: "error", text: "Choose a JPEG, PNG or WebP image." });
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setStatus({ tone: "error", text: "That file is too large. Choose one under 25 MB." });
      return;
    }
    setStatus(null);
    setCropError(null);
    setSource(URL.createObjectURL(file));
  }

  async function confirm(area: PixelArea) {
    if (!source) return;
    try {
      const blob = await cropToSquare(source, area);
      const error = await send("POST", blob);
      if (error) setCropError(error);
      else setSource(null);
    } catch (error) {
      setCropError(error instanceof Error ? error.message : "The upload failed.");
    }
  }

  const initials = orgName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  const fileInput = (
    <input
      ref={input}
      id="org-logo"
      type="file"
      accept={ACCEPTED_IMAGE_TYPES.join(",")}
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
      onChange={pick}
    />
  );
  const crop = source && (
    <CropDialog
      imageSrc={source}
      busy={busy}
      error={cropError}
      title="Crop the organization picture"
      shape="rect"
      onCancel={() => setSource(null)}
      onConfirm={confirm}
    />
  );
  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) take(file);
    },
  };

  if (bare) {
    return (
      <div className="flex w-full flex-col items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          onPointerEnter={() => void loadCropDialog()}
          {...dropProps}
          aria-label={logoUrl ? "Change the logo" : "Upload a logo"}
          className={cn(
            "group flex w-full cursor-pointer items-center gap-5 rounded-[24px] border-2 border-dashed p-5 text-left transition-colors disabled:cursor-default",
            dragging
              ? "border-foreground bg-muted"
              : "border-border hover:border-foreground/40 hover:bg-muted/50",
          )}
        >
          <span className="bg-muted ring-foreground/8 grid size-24 flex-none place-items-center overflow-hidden rounded-[22px] ring-1">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP variant
              <img src={logoUrl} alt="" width={96} height={96} className="size-full object-cover" />
            ) : busy ? (
              <Loader2 className="text-muted-foreground size-6 animate-spin" aria-hidden="true" />
            ) : (
              <ImageUp className="text-muted-foreground size-7" aria-hidden="true" />
            )}
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <span className="text-[16px] font-semibold">
              {logoUrl ? "Change logo" : "Drop your logo here"}
            </span>
            <span className="text-muted-foreground text-[13px]">
              {logoUrl ? "Click or drop a new one." : "Or click to choose. PNG, JPG or WebP."}
            </span>
          </span>
        </button>
        <SettingsStatus status={status} />
        {fileInput}
        {crop}
      </div>
    );
  }

  return (
    <Field label="Picture" mark={<SettingsStatus status={status} />}>
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          disabled={!canEdit || busy}
          onClick={() => input.current?.click()}
          onPointerEnter={() => void loadCropDialog()}
          {...(canEdit ? dropProps : {})}
          aria-label={
            logoUrl ? "Change the organization picture" : "Upload an organization picture"
          }
          className={cn(
            "group rounded-tile ring-foreground/6 focus-visible:outline-foreground relative size-20 shrink-0 overflow-hidden ring-1 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-default",
            dragging && "ring-foreground ring-2",
          )}
        >
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP variant
            <img src={logoUrl} alt="" width={80} height={80} className="size-full object-cover" />
          ) : (
            <span className="bg-muted text-foreground grid size-full place-items-center text-xl font-semibold">
              {initials || <Building2 className="size-6" aria-hidden="true" />}
            </span>
          )}
          {canEdit && (
            <span
              className={cn(
                "bg-foreground/50 text-background absolute inset-0 grid place-items-center transition-opacity",
                busy
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
              )}
            >
              {busy ? (
                <Loader2 className="size-5 animate-spin" aria-hidden="true" />
              ) : (
                <Camera className="size-5" aria-hidden="true" />
              )}
            </span>
          )}
        </button>
        {canEdit ? (
          <div className="flex flex-col items-start gap-1.5">
            <p className="text-muted-foreground text-[13px]">
              {logoUrl ? "Click or drop to change." : "Click or drop to add."} JPEG, PNG or WebP.
            </p>
            {logoUrl && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={async () => {
                  const error = await send("DELETE");
                  if (error) setStatus({ tone: "error", text: error });
                }}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                Remove
              </Button>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">Owners and admins can change it.</p>
        )}
        {fileInput}
      </div>
      {crop}
    </Field>
  );
}
