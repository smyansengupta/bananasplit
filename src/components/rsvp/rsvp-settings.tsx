"use client";

import {
  Banknote,
  EyeOff,
  ImagePlus,
  Lock,
  Mail,
  MessageSquareText,
  Trash2,
  Users,
} from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { saveRsvpSettings } from "@/app/app/[orgSlug]/calendar/[eventId]/rsvp/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { RSVP_BACKGROUNDS } from "@/lib/rsvp/backgrounds";
import type { RsvpCover } from "@/lib/rsvp/cover";
import {
  formatCents,
  PAY_APP_LABEL,
  PAY_APPS,
  parseDollars,
  shareCents,
  type CostMode,
  type PayApp,
} from "@/lib/rsvp/pay";
import { cn } from "@/lib/utils";

import { BringListEditor, type BringLine } from "./bring-list-editor";
import { PagePreview } from "./page-preview";

export interface RsvpSettingsValue {
  locationDetails: string;
  capacity: number | null;
  waitlist: boolean;
  closed: boolean;
  hideLocation: boolean;
  hideGuests: boolean;
  hideCount: boolean;
  background: string;
  costMode: CostMode;
  /** The amount as typed ("12.50"); EACH: per guest, SPLIT: the total. */
  costText: string;
  costNote: string;
  payTo: Record<PayApp, string>;
}

const PAY_PLACEHOLDER: Record<PayApp, string> = {
  venmo: "@your-venmo",
  cashapp: "$yourcashtag",
  paypal: "paypal.me name",
  zelle: "Email or phone on Zelle",
};

const COST_MODES: { id: CostMode; label: string; hint: string }[] = [
  { id: "NONE", label: "Free", hint: "Nothing to pay." },
  { id: "EACH", label: "Price each", hint: "Every guest pays the same amount." },
  {
    id: "SPLIT",
    label: "Split a total",
    hint: "Enter what it all costs; each guest's share drops as more sign up.",
  },
];

function Card({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card text-card-foreground ring-foreground/6 edge rounded-card space-y-4 p-6 ring-1">
      <div className="space-y-1">
        <h2 className="heading text-[17px]">{title}</h2>
        {description && <p className="text-muted-foreground text-sm">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function SwitchRow({
  id,
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-0.5">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        <p className="text-muted-foreground text-xs leading-relaxed">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

/**
 * The privacy switches, made big on purpose: each is its own tile with a
 * bold label, and the tile lights up when it's on, so what the public page
 * hides is obvious at a glance.
 */
function PrivacyTile({
  id,
  icon: Icon,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  icon: typeof Lock;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "rounded-tile flex cursor-pointer items-start gap-3.5 border-2 p-4 transition-colors",
        checked ? "border-primary bg-primary/6" : "hover:bg-muted/50 border-border",
      )}
    >
      <span
        className={cn(
          "grid size-10 flex-none place-items-center rounded-full",
          checked ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 space-y-1">
        <span className="block text-base leading-snug font-bold">{label}</span>
        <span className="text-muted-foreground block text-sm leading-relaxed">{description}</span>
      </span>
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="mt-1" />
    </label>
  );
}

export function RsvpSettings({
  orgId,
  eventId,
  title,
  location,
  cover,
  initial,
  messaging,
  editHref,
  going,
  items,
}: {
  orgId: string;
  eventId: string;
  title: string;
  location: string | null;
  cover: RsvpCover | null;
  initial: RsvpSettingsValue;
  messaging: { email: "org" | "platform"; texts: boolean };
  /** Where the event's own details (title, time, place) are edited. */
  editHref: string;
  /** How many are going, for the split preview. */
  going: number;
  items: BringLine[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [capacityText, setCapacityText] = useState(
    initial.capacity ? String(initial.capacity) : "",
  );
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const limited = value.capacity !== null;
  const dirty =
    JSON.stringify(value) !== JSON.stringify(initial) ||
    (limited && capacityText !== String(initial.capacity ?? ""));

  function set<K extends keyof RsvpSettingsValue>(key: K, v: RsvpSettingsValue[K]) {
    setValue((prev) => ({ ...prev, [key]: v }));
  }

  const costCents = value.costMode === "NONE" ? null : parseDollars(value.costText);
  const sample = Math.max(going, 1);
  const costPreview =
    value.costMode === "NONE" || costCents === null
      ? null
      : value.costMode === "EACH"
        ? `${formatCents(costCents)} from each guest`
        : `${formatCents(costCents)} total: ${formatCents(shareCents("SPLIT", costCents, sample) ?? costCents)} each with ${sample} going, ${formatCents(shareCents("SPLIT", costCents, Math.max(sample, 10) * 2) ?? costCents)} each with ${Math.max(sample, 10) * 2}`;

  function save() {
    const capacity = limited ? Number.parseInt(capacityText, 10) : null;
    if (limited && (!Number.isFinite(capacity) || (capacity ?? 0) < 1)) {
      toast({
        title: "Set how many spots",
        description: "Enter a number of 1 or more, or turn off Limit spots.",
      });
      return;
    }
    if (value.costMode !== "NONE" && (costCents === null || costCents < 1)) {
      toast({
        title: "Set the amount",
        description: "Enter dollars like 12 or 12.50, or pick Free.",
      });
      return;
    }
    start(async () => {
      // costText goes as cents; the action's schema drops the text itself.
      const result = await saveRsvpSettings(orgId, eventId, {
        ...value,
        capacity,
        locationDetails: value.locationDetails.trim() || null,
        costCents,
        costNote: value.costNote.trim() || null,
        payTo: value.payTo,
      });
      if (result.error) {
        toast({ title: "Couldn't save", description: result.error });
        return;
      }
      toast({ title: "RSVP page saved" });
      router.refresh();
    });
  }

  async function uploadCover(file: File) {
    setUploading(true);
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch(`/api/orgs/${orgId}/events/${eventId}/cover`, {
        method: "POST",
        body,
      });
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        toast({
          title: "Couldn't upload the cover",
          description: json.error ?? "Try another image.",
        });
        return;
      }
      router.refresh();
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeCover() {
    setUploading(true);
    try {
      const response = await fetch(`/api/orgs/${orgId}/events/${eventId}/cover`, {
        method: "DELETE",
      });
      if (!response.ok) toast({ title: "Couldn't remove the cover" });
      router.refresh();
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
      <div className="space-y-5">
        <Card
          title="Look"
          description="The square image at the top of the page, and what's behind it."
        >
          <div className="flex flex-wrap items-center gap-4">
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element -- a stored WebP variant
              <img
                src={cover.s480}
                alt="Cover"
                className="rounded-tile size-24 border object-cover"
              />
            ) : (
              <span className="bg-muted text-muted-foreground rounded-tile grid size-24 place-items-center border border-dashed">
                <ImagePlus className="size-6" aria-hidden="true" />
              </span>
            )}
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  <ImagePlus aria-hidden="true" />
                  {uploading ? "Uploading…" : cover ? "Change cover" : "Upload cover"}
                </Button>
                {cover && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={uploading}
                    onClick={() => void removeCover()}
                  >
                    <Trash2 aria-hidden="true" />
                    Remove
                  </Button>
                )}
              </div>
              <p className="text-muted-foreground text-xs">
                JPEG, PNG or WebP up to 4 MB. Shown square.
              </p>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadCover(file);
                }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Page glow</p>
            <div
              className="grid grid-cols-4 gap-2 sm:grid-cols-8"
              role="radiogroup"
              aria-label="Page glow"
            >
              {RSVP_BACKGROUNDS.map((b) => {
                const active = value.background === b.id;
                const unavailable = b.id === "cover" && !cover;
                return (
                  <button
                    key={b.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={unavailable}
                    title={unavailable ? "Upload a cover first" : b.label}
                    onClick={() => set("background", b.id)}
                    className="group flex flex-col items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span
                      className={cn(
                        "rounded-field block aspect-square w-full border",
                        b.swatch,
                        active
                          ? "ring-primary ring-2 ring-offset-2 ring-offset-(--card)"
                          : "group-hover:ring-border group-hover:ring-2",
                      )}
                    />
                    <span
                      className={cn(
                        "text-[11px]",
                        active ? "font-semibold" : "text-muted-foreground",
                      )}
                    >
                      {b.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </Card>

        <Card
          title="Spots"
          description="How many people can come, and what happens when it fills up."
        >
          <div className="space-y-4">
            <SwitchRow
              id="rsvp-limit"
              label="Limit spots"
              description="Off means anyone can sign up."
              checked={limited}
              onChange={(on) => {
                set("capacity", on ? Number.parseInt(capacityText, 10) || 50 : null);
                if (on && !capacityText) setCapacityText("50");
              }}
            />
            {limited && (
              <div className="flex items-center gap-2 ps-0.5">
                <Input
                  id="rsvp-capacity"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={100000}
                  value={capacityText}
                  onChange={(e) => {
                    setCapacityText(e.target.value);
                    const n = Number.parseInt(e.target.value, 10);
                    if (Number.isFinite(n) && n >= 1) set("capacity", n);
                  }}
                  className="w-28"
                  aria-label="Number of spots"
                />
                <span className="text-muted-foreground text-sm">spots</span>
              </div>
            )}
            <SwitchRow
              id="rsvp-waitlist"
              label="Waitlist when full"
              description="New sign-ups wait in line; when a spot opens, the next person gets it and an email."
              checked={value.waitlist}
              onChange={(v) => set("waitlist", v)}
              disabled={!limited}
            />
            <SwitchRow
              id="rsvp-open"
              label="Taking sign-ups"
              description="Turn off to close registration without hiding the page."
              checked={!value.closed}
              onChange={(v) => set("closed", !v)}
            />
          </div>
        </Card>

        <Card
          title="Getting there"
          description="The address comes from the event. Add how to find the room once people are in the building."
        >
          <div className="bg-muted rounded-field flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
            <span className={cn("min-w-0 truncate", !location && "text-muted-foreground")}>
              {location ?? "No location set"}
            </span>
            <Link
              href={editHref}
              className="shrink-0 text-xs font-semibold underline-offset-4 hover:underline"
            >
              Edit event
            </Link>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rsvp-directions">How to find it</Label>
            <Textarea
              id="rsvp-directions"
              rows={3}
              maxLength={1000}
              value={value.locationDetails}
              onChange={(e) => set("locationDetails", e.target.value)}
              placeholder="Room 204 on the second floor. Take the east elevator; we'll have a sign on the door."
            />
          </div>
        </Card>

        <Card
          title="Split the cost"
          description="Pizza, a cabin, tickets: guests chip in straight to you. No fees, no money through Bananasplit."
        >
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Cost">
            {COST_MODES.map((m) => {
              const active = value.costMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => set("costMode", m.id)}
                  className={cn(
                    "rounded-tile flex flex-col items-start gap-1 border-2 p-3 text-left transition-colors",
                    active ? "border-primary bg-primary/6" : "border-border hover:bg-muted/50",
                  )}
                >
                  <span className="text-sm font-bold">{m.label}</span>
                  <span className="text-muted-foreground text-xs leading-relaxed">{m.hint}</span>
                </button>
              );
            })}
          </div>
          {value.costMode !== "NONE" && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
                <div className="space-y-1.5">
                  <Label htmlFor="rsvp-cost">
                    {value.costMode === "EACH" ? "Price per guest" : "Total to split"}
                  </Label>
                  <div className="relative">
                    <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm">
                      $
                    </span>
                    <Input
                      id="rsvp-cost"
                      inputMode="decimal"
                      value={value.costText}
                      onChange={(e) => set("costText", e.target.value)}
                      placeholder={value.costMode === "EACH" ? "5" : "120"}
                      className="ps-6"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rsvp-cost-note">What it&apos;s for</Label>
                  <Input
                    id="rsvp-cost-note"
                    maxLength={120}
                    value={value.costNote}
                    onChange={(e) => set("costNote", e.target.value)}
                    placeholder="Pizza and drinks"
                  />
                </div>
              </div>
              {costPreview && (
                <p className="bg-muted rounded-field flex items-center gap-2 px-3.5 py-2.5 text-sm">
                  <Banknote className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                  {costPreview}
                </p>
              )}
              <div className="space-y-2">
                <p className="text-sm font-medium">Where guests pay you</p>
                <p className="text-muted-foreground text-xs">
                  Fill in any you use. Guests get a button that opens the app with their share
                  filled in, then tap &ldquo;I&apos;ve paid&rdquo; and you tick them off.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {PAY_APPS.map((app) => (
                    <div key={app} className="space-y-1">
                      <Label htmlFor={`rsvp-pay-${app}`} className="text-xs">
                        {PAY_APP_LABEL[app]}
                      </Label>
                      <Input
                        id={`rsvp-pay-${app}`}
                        value={value.payTo[app]}
                        onChange={(e) => set("payTo", { ...value.payTo, [app]: e.target.value })}
                        placeholder={PAY_PLACEHOLDER[app]}
                        autoComplete="off"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card
          title="Bring list"
          description="What you need people to bring or help with. Guests claim lines on the page, and everyone sees what's covered."
        >
          <BringListEditor orgId={orgId} eventId={eventId} initial={items} />
        </Card>

        <Card title="Privacy" description="What the public page keeps to itself.">
          <div className="grid gap-3">
            <PrivacyTile
              id="rsvp-hide-location"
              icon={Lock}
              label="Hide the address until people sign up"
              description="The address, directions and map only show to people who registered. Everyone else sees “Location shared after you sign up.”"
              checked={value.hideLocation}
              onChange={(v) => set("hideLocation", v)}
            />
            <PrivacyTile
              id="rsvp-hide-guests"
              icon={Users}
              label="Hide who's going"
              description="Don't list guests' names on the page. Names are always shortened, like “Maya P.”"
              checked={value.hideGuests}
              onChange={(v) => set("hideGuests", v)}
            />
            <PrivacyTile
              id="rsvp-hide-count"
              icon={EyeOff}
              label="Hide how many are going"
              description="No head count or spots-left number on the page (this hides the names too)."
              checked={value.hideCount}
              onChange={(v) => set("hideCount", v)}
            />
          </div>
        </Card>

        {/* Only while there's something to save, pinned to the bottom of the screen. */}
        {dirty && (
          <div className="bg-popover text-popover-foreground ring-foreground/6 shadow-e2 sticky bottom-[calc(var(--shell-bottom,0px)+0.75rem)] flex items-center justify-end gap-3 rounded-full p-2 ps-5 ring-1">
            <span className="text-muted-foreground me-auto text-sm">Unsaved changes</span>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => {
                setValue(initial);
                setCapacityText(initial.capacity ? String(initial.capacity) : "");
              }}
            >
              Discard
            </Button>
            <Button disabled={pending} onClick={save}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        )}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-4">
        <div className="space-y-2">
          <p className="text-muted-foreground text-[13px] font-medium">Preview</p>
          <PagePreview cover={cover} background={value.background} title={title} />
        </div>
        <div className="bg-card ring-foreground/6 edge rounded-tile space-y-3 p-4 text-sm ring-1">
          <p className="font-medium">What guests get</p>
          <p className="text-muted-foreground flex gap-2 text-xs leading-relaxed">
            <Mail className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              A confirmation email, then reminders a day and an hour before.{" "}
              {messaging.email === "org"
                ? "Sent from your organization's email sender."
                : "Sent as your organization via Bananasplit until you connect your own sender in Admin panel › Integrations."}
            </span>
          </p>
          <p className="text-muted-foreground flex gap-2 text-xs leading-relaxed">
            <MessageSquareText className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              {messaging.texts
                ? "A text with each reminder, to the number they signed up with."
                : "Text reminders switch on once text messaging is set up for Bananasplit; numbers are collected now."}
            </span>
          </p>
        </div>
      </aside>
    </div>
  );
}
