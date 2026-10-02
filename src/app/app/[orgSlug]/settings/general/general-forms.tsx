"use client";

import { Building2, Camera, ImageUp, Loader2, Trash2 } from "lucide-react";
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
import { timeZoneOptions } from "@/lib/timezones";
import { SUCCESS_TEXT } from "@/lib/status-tones";

import { renameOrgSlug, updateOrgName, updateOrgTimezone } from "./actions";

type Status = { tone: "ok" | "error"; text: string } | null;

const loadCropDialog = () => import("@/components/images/crop-dialog");
const CropDialog = dynamic(loadCropDialog, { ssr: false });

function StatusLine({ status }: { status: Status }) {
  if (!status) return null;
  return (
    <p
      role="status"
      className={status.tone === "error" ? "text-destructive text-sm" : `text-sm ${SUCCESS_TEXT}`}
    >
      {status.text}
    </p>
  );
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
      className="space-y-2"
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
      <Label htmlFor="org-name">Name</Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id="org-name"
          value={value}
          maxLength={80}
          disabled={!canEdit}
          onChange={(e) => setValue(e.target.value)}
          className="max-w-sm"
        />
        {canEdit && (
          <Button type="submit" variant="outline" disabled={isPending || value.trim() === name}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        )}
      </div>
      <StatusLine status={status} />
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
      className="space-y-2"
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
      <Label htmlFor="org-timezone">Timezone</Label>
      <div className="flex flex-wrap gap-2">
        <select
          id="org-timezone"
          value={value}
          disabled={!canEdit}
          onChange={(e) => setValue(e.target.value)}
          className="border-input bg-background h-9 w-full max-w-sm rounded-md border px-3 text-sm"
        >
          {!zones.includes(value) && <option value={value}>{value}</option>}
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
        {canEdit && (
          <Button type="submit" variant="outline" disabled={isPending || value === timezone}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        )}
      </div>
      <p className="text-muted-foreground text-xs">
        Weeks, reminders, digests and reports follow this zone. Members can override it for
        themselves in their profile.
      </p>
      <StatusLine status={status} />
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
    <div className="space-y-2">
      <Label>URL</Label>
      <div className="flex flex-wrap items-center gap-2">
        <code className="bg-muted rounded px-2 py-1 text-sm">
          {appOrigin}/app/{slug}
        </code>
        {canEdit && (
          <Dialog
            open={open}
            onOpenChange={(o) => {
              setOpen(o);
              setError(null);
              setValue(slug);
            }}
          >
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                Change URL
              </Button>
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
                  <div className="flex items-center gap-1">
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
                  <div className="bg-muted space-y-1 rounded-md p-3 text-xs">
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
                {error && <p className="text-destructive text-sm">{error}</p>}
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
        )}
      </div>
      {!canEdit && (
        <p className="text-muted-foreground text-xs">Only an owner can change the URL.</p>
      )}
    </div>
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
      setStatus({ tone: "ok", text: method === "POST" ? "Club picture updated." : "Club picture removed." });
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
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">Club picture</h2>
        <p className="text-muted-foreground text-xs">
          Your club&apos;s profile picture: the sidebar, the organization switcher, and the page
          people see when they join.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          disabled={!canEdit || busy}
          onClick={() => input.current?.click()}
          onPointerEnter={() => void loadCropDialog()}
          aria-label={logoUrl ? "Change the club picture" : "Upload a club picture"}
          className="group focus-visible:ring-ring/50 relative size-20 shrink-0 overflow-hidden rounded-2xl border outline-none focus-visible:ring-3 disabled:cursor-default"
        >
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP variant
            <img src={logoUrl} alt="" width={80} height={80} className="size-full object-cover" />
          ) : (
            <span className="bg-primary/10 text-primary grid size-full place-items-center text-xl font-semibold">
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
                size="sm"
                disabled={busy}
                onClick={() => input.current?.click()}
                onFocus={() => void loadCropDialog()}
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <ImageUp className="size-3.5" aria-hidden="true" />}
                {logoUrl ? "Change picture" : "Upload picture"}
              </Button>
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
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  Remove
                </Button>
              )}
            </div>
            <p className="text-muted-foreground text-xs">
              JPEG, PNG or WebP. You&apos;ll crop it to a square; location data is removed.
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">Owners and admins can change it.</p>
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
      <StatusLine status={status} />
      {source && (
        <CropDialog
          imageSrc={source}
          busy={busy}
          error={cropError}
          title="Crop the club picture"
          shape="rect"
          onCancel={() => setSource(null)}
          onConfirm={confirm}
        />
      )}
    </section>
  );
}
