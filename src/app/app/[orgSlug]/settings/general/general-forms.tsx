"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useRef, useState, useTransition } from "react";

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
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  async function send(method: "POST" | "DELETE", file?: File) {
    setBusy(true);
    setStatus(null);
    try {
      let body: FormData | undefined;
      if (file) {
        body = new FormData();
        body.set("file", file);
      }
      const res = await fetch(`/api/orgs/${encodeURIComponent(orgId)}/logo`, { method, body });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setStatus({ tone: "error", text: data.error ?? "The upload failed." });
      } else {
        setStatus({ tone: "ok", text: method === "POST" ? "Logo updated." : "Logo removed." });
        router.refresh();
      }
    } catch {
      setStatus({ tone: "error", text: "The upload failed. Check your connection." });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="org-logo">Logo</Label>
      <div className="flex flex-wrap items-center gap-3">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP variant
          <img
            src={logoUrl}
            alt={`${orgName} logo`}
            width={64}
            height={64}
            className="size-16 rounded border object-contain"
          />
        ) : (
          <div className="text-muted-foreground flex size-16 items-center justify-center rounded border border-dashed text-xs">
            No logo
          </div>
        )}
        {canEdit && (
          <>
            <input
              ref={input}
              id="org-logo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 4 * 1024 * 1024) {
                  setStatus({ tone: "error", text: "Logos are limited to 4 MB." });
                  return;
                }
                void send("POST", file);
              }}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              {busy ? "Uploading…" : logoUrl ? "Replace" : "Upload"}
            </Button>
            {logoUrl && (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void send("DELETE")}>
                Remove
              </Button>
            )}
          </>
        )}
      </div>
      <p className="text-muted-foreground text-xs">
        PNG, JPEG or WebP up to 4 MB. It is resized and re-encoded (location data removed). Shown in
        the sidebar and the organization switcher.
      </p>
      <StatusLine status={status} />
    </div>
  );
}
