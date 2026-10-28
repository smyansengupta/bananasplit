"use client";

import { Building2, Camera, ImageUp, Loader2, Trash2 } from "@/components/icons";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useRef, useState, useTransition } from "react";

import {
  ACCEPTED_IMAGE_TYPES,
  cropToSquare,
  MAX_SOURCE_BYTES,
  type PixelArea,
} from "@/components/images/crop-image";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { slugify } from "@/lib/slug";
import { WEEKDAY_NAMES } from "@/lib/tasks/dates";
import { timeZoneOptions } from "@/lib/timezones";

import { nativeSelectClass, SettingsCard, SettingsStatus } from "../settings-card";
import { renameOrgSlug, updateOrgName, updateOrgTimezone, updateWeeklyUpdateDay } from "./actions";

type Status = { tone: "ok" | "error"; text: string } | null;

const loadCropDialog = () => import("@/components/images/crop-dialog");
const CropDialog = dynamic(loadCropDialog, { ssr: false });

function StatusLine({ status }: { status: Status }) {
  return <SettingsStatus status={status} />;
}

export function NameForm({
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
  const [status, setStatus] = useState<Status>(null);
  const [isPending, startTransition] = useTransition();
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        setStatus(null);
        startTransition(async () => {
          const result = await updateOrgName(orgId, value);
          setStatus(
            result.error
              ? { tone: "error", text: result.error }
              : { tone: "ok", text: "Name saved." },
          );
          if (!result.error) router.refresh();
        });
      }}
    >
      <SettingsCard
        title="Name"
        description="How the organization appears across the app, in emails and on invite pages."
        status={status && <StatusLine status={status} />}
        footer={
          canEdit && (
            <Button type="submit" disabled={isPending || value.trim() === name}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          )
        }
      >
        <Label htmlFor="org-name" className="sr-only">
          Name
        </Label>
        <Input
          id="org-name"
          value={value}
          maxLength={80}
          disabled={!canEdit}
          onChange={(e) => setValue(e.target.value)}
          className="max-w-md"
        />
      </SettingsCard>
    </form>
  );
}

/**
 * The day the weekly update is due. A week is the seven days ending that
 * day, and leads who haven't posted get a reminder that evening.
 */
export function WeeklyUpdateDayForm({
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
  const [status, setStatus] = useState<Status>(null);
  const [isPending, startTransition] = useTransition();
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        setStatus(null);
        startTransition(async () => {
          const result = await updateWeeklyUpdateDay(orgId, value);
          setStatus(
            result.error
              ? { tone: "error", text: result.error }
              : { tone: "ok", text: "Weekly update day saved." },
          );
          if (!result.error) router.refresh();
        });
      }}
    >
      <SettingsCard
        title="Weekly update day"
        description={
          <>
            When everyone&apos;s done / next / blocked update is due. Each week runs{" "}
            {WEEKDAY_NAMES[(value + 1) % 7]} to {WEEKDAY_NAMES[value]}, and leads who haven&apos;t
            posted get a reminder {WEEKDAY_NAMES[value]} evening.
          </>
        }
        status={status && <StatusLine status={status} />}
        footer={
          canEdit && (
            <Button type="submit" disabled={isPending || value === day}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          )
        }
      >
        <Label htmlFor="org-weekly-day" className="sr-only">
          Weekly update day
        </Label>
        <select
          id="org-weekly-day"
          value={value}
          disabled={!canEdit}
          onChange={(e) => setValue(Number(e.target.value))}
          className={`${nativeSelectClass} max-w-md`}
        >
          {WEEKDAY_NAMES.map((name, i) => (
            <option key={name} value={i}>
              {name}
            </option>
          ))}
        </select>
      </SettingsCard>
    </form>
  );
}

export function TimezoneForm({
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
  const [status, setStatus] = useState<Status>(null);
  const [isPending, startTransition] = useTransition();
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        setStatus(null);
        startTransition(async () => {
          const result = await updateOrgTimezone(orgId, value);
          setStatus(
            result.error
              ? { tone: "error", text: result.error }
              : { tone: "ok", text: "Timezone saved." },
          );
          if (!result.error) router.refresh();
        });
      }}
    >
      <SettingsCard
        title="Timezone"
        description="Weeks, reminders, digests and reports follow this zone. Members can override it for themselves in their profile."
        status={status && <StatusLine status={status} />}
        footer={
          canEdit && (
            <Button type="submit" disabled={isPending || value === timezone}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          )
        }
      >
        <Label htmlFor="org-timezone" className="sr-only">
          Timezone
        </Label>
        <select
          id="org-timezone"
          value={value}
          disabled={!canEdit}
          onChange={(e) => setValue(e.target.value)}
          className={`${nativeSelectClass} max-w-md`}
        >
          {!zones.includes(value) && <option value={value}>{value}</option>}
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </SettingsCard>
    </form>
  );
}

export function SlugForm({
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
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(slug);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const next = slugify(value);

  return (
    <SettingsCard
      title="URL"
      description={
        canEdit
          ? "Old links keep working: the current URL redirects to the new one."
          : "Only an owner can change the URL."
      }
      footer={
        canEdit && (
          <Dialog
            open={open}
            onOpenChange={(o) => {
              setOpen(o);
              setError(null);
              setValue(slug);
            }}
          >
            <DialogTrigger asChild>
              <Button variant="outline">Change URL</Button>
            </DialogTrigger>
            <DialogContent>
              <form
                className="space-y-4"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  setError(null);
                  startTransition(async () => {
                    const result = await renameOrgSlug(orgId, next);
                    if (result.error || !result.slug) {
                      setError(result.error ?? "Could not change the URL.");
                      return;
                    }
                    setOpen(false);
                    router.replace(`/app/${result.slug}/settings/general`);
                  });
                }}
              >
                <DialogHeader>
                  <DialogTitle>Change the organization URL</DialogTitle>
                  <DialogDescription>
                    Old links keep working: the current URL redirects to the new one. The old URL is
                    reserved for this organization forever, so no one else can take it.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-1.5">
                  <Label htmlFor="new-slug">New URL</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-sm">/app/</span>
                    <Input
                      id="new-slug"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                </div>
                {next !== slug && (
                  <div className="bg-muted/60 rounded-tile space-y-1.5 p-3 text-[13px]">
                    <p>
                      The public events feed moves to{" "}
                      <code className="break-all">
                        {appOrigin}/api/public/{next}/events
                      </code>
                      .
                    </p>
                    <p>
                      If your website reads it (SUITE_EVENTS_URL in the website&apos;s Netlify
                      settings), update that value; the old feed URL redirects meanwhile.
                    </p>
                  </div>
                )}
                {error && (
                  <p
                    role="alert"
                    className="bg-tint-danger text-tint-danger-foreground rounded-tile p-3 text-sm"
                  >
                    {error}
                  </p>
                )}
                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isPending || !next || next === slug}>
                    {isPending ? "Changing…" : "Change URL"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )
      }
    >
      <p className="bg-muted/60 rounded-field px-3.5 py-2.5 font-mono text-[13px] break-all">
        {appOrigin}/app/{slug}
      </p>
    </SettingsCard>
  );
}

/**
 * The club picture (Organization.logo): pick a file, crop it to a square,
 * upload the 512px result. Shown in the sidebar, the org switcher, invite
 * and join pages.
 */
export function LogoForm({
  orgId,
  logoUrl,
  orgName,
  canEdit,
}: {
  orgId: string;
  logoUrl: string | null;
  orgName: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<string | null>(null);
  const [cropError, setCropError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

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
      setStatus({
        tone: "ok",
        text: method === "POST" ? "Organization picture updated." : "Organization picture removed.",
      });
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
    if (!file) return;
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

  return (
    <SettingsCard
      title="Organization picture"
      description="Your organization's profile picture: the sidebar, the organization switcher, and the page people see when they join."
      status={status && <StatusLine status={status} />}
    >
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          disabled={!canEdit || busy}
          onClick={() => input.current?.click()}
          onPointerEnter={() => void loadCropDialog()}
          aria-label={
            logoUrl ? "Change the organization picture" : "Upload an organization picture"
          }
          className="group rounded-tile ring-foreground/6 focus-visible:outline-foreground relative size-20 shrink-0 overflow-hidden ring-1 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-default"
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
            <span className="bg-foreground/50 text-background absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              <Camera className="size-5" aria-hidden="true" />
            </span>
          )}
        </button>
        {canEdit ? (
          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => input.current?.click()}
                onFocus={() => void loadCropDialog()}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ImageUp className="size-4" aria-hidden="true" />
                )}
                {logoUrl ? "Change picture" : "Upload picture"}
              </Button>
              {logoUrl && (
                <Button
                  variant="ghost"
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
            <p className="text-muted-foreground text-[13px]">
              JPEG, PNG or WebP. You&apos;ll crop it to a square; location data is removed.
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">Owners and admins can change it.</p>
        )}
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
      </div>
      {source && (
        <CropDialog
          imageSrc={source}
          busy={busy}
          error={cropError}
          title="Crop the organization picture"
          shape="rect"
          onCancel={() => setSource(null)}
          onConfirm={confirm}
        />
      )}
    </SettingsCard>
  );
}
