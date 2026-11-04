"use client";

import {
  CalendarClock,
  Copy,
  ExternalLink,
  Pencil,
  Plus,
  TriangleAlert,
  Users,
} from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  cancelBookingByHostAction,
  createOrgLinkAction,
  takeBookingAction,
} from "@/app/app/[orgSlug]/meetings/booking/actions";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHead } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { hoursSummary } from "@/lib/booking/hours";
import { runAction } from "@/lib/run-action";
import type { BookingLinkState } from "@/server/booking/view";

import { LinkDialog } from "./link-dialog";

export interface UpcomingBooking {
  id: string;
  eventId: string;
  guestName: string;
  guestEmail: string;
  startsAt: string;
  endsAt: string;
  linkTitle: string;
  hostId: string;
  hostName: string;
  verified: boolean;
  needsHost: boolean;
  mine: boolean;
}

/**
 * Meetings > Booking links: your link on top, the organization's under it
 * (with the CRM), then what's booked. Each link opens its editor as the
 * app's centered dialog (LinkDialog, the New event dialog's look).
 */
export function BookingLinksView({
  orgId,
  orgSlug,
  personalSpace,
  orgLinksAllowed,
  crmOn,
  isAdmin,
  mine,
  orgLinks,
  upcoming,
  members,
  pipelines,
  timeZones,
  orgTimeZone,
  openOnArrival,
}: {
  orgId: string;
  orgSlug: string;
  personalSpace: boolean;
  orgLinksAllowed: boolean;
  crmOn: boolean;
  isAdmin: boolean;
  mine: BookingLinkState;
  orgLinks: BookingLinkState[];
  upcoming: UpcomingBooking[];
  members: { id: string; name: string }[];
  pipelines: { id: string; name: string }[];
  timeZones: string[];
  orgTimeZone: string;
  openOnArrival: string | null;
}) {
  const router = useRouter();
  const all = [mine, ...orgLinks];
  const [editing, setEditing] = useState<string | null>(
    openOnArrival && all.some((l) => l.id === openOnArrival) ? openOnArrival : null,
  );
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [cancelling, setCancelling] = useState<UpcomingBooking | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const names = new Map(members.map((m) => [m.id, m.name]));
  const open = all.find((l) => l.id === editing) ?? null;

  const create = async () => {
    setBusy(true);
    const r = await runAction(() => createOrgLinkAction(orgId, newTitle));
    setBusy(false);
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    setCreating(false);
    setNewTitle("");
    router.refresh();
    setEditing(r.id);
  };
  const cancel = async () => {
    if (!cancelling) return;
    setBusy(true);
    const r = await runAction(() => cancelBookingByHostAction(orgId, cancelling.id, note));
    setBusy(false);
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    toast({ title: `Cancelled. ${cancelling.guestName.split(" ")[0]} has been told.` });
    setCancelling(null);
    setNote("");
    router.refresh();
  };
  const take = async (b: UpcomingBooking) => {
    const r = await runAction(() => takeBookingAction(orgId, b.id));
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    toast({ title: `It's yours. ${b.guestName.split(" ")[0]} has been told.` });
    router.refresh();
  };

  const needsHost = upcoming.filter((b) => b.needsHost);
  return (
    <div className="space-y-7.5">
      {needsHost.length > 0 && isAdmin && (
        <section aria-labelledby="needs-host" className="space-y-3">
          <h2 id="needs-host" className="heading flex items-center gap-2 text-[17px]">
            <TriangleAlert className="text-tint-danger-foreground size-4" aria-hidden="true" />
            Needs a host
          </h2>
          <BookingList items={needsHost} orgSlug={orgSlug} onCancel={setCancelling} onTake={take} isAdmin />
        </section>
      )}

      <section aria-labelledby="your-link" className="space-y-3">
        <h2 id="your-link" className="heading text-[17px]">
          Your booking link
        </h2>
        <LinkCard
          link={mine}
          lines={[
            `${[mine.durationMin, ...mine.durations].join(", ")} minutes`,
            mine.hours ? hoursSummary(mine.hours) : "Your availability",
          ]}
          onEdit={() => setEditing(mine.id)}
        />
      </section>

      {!personalSpace && (
        <section aria-labelledby="org-links" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="org-links" className="heading flex-1 text-[17px]">
              Organization links
            </h2>
            {orgLinksAllowed && (
              <Button variant="outline" onClick={() => setCreating(true)}>
                <Plus aria-hidden="true" />
                New booking link
              </Button>
            )}
          </div>
          {!orgLinksAllowed ? (
            <p className="text-muted-foreground text-sm">
              Shared links that anyone here can send, booked with one host or several taking turns, come with
              the CRM.{" "}
              {isAdmin ? (
                <Link href={`/app/${orgSlug}/integrations/crm`} className="text-foreground underline underline-offset-2">
                  Add the CRM
                </Link>
              ) : (
                "Ask an owner or admin to add it."
              )}
            </p>
          ) : orgLinks.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No organization links yet"
              description="One link for the whole organization, like Coffee with the president. Pick one host or several taking turns."
            />
          ) : (
            <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {orgLinks.map((l) => {
                const hosts = l.hostIds.map((h) => names.get(h)).filter(Boolean) as string[];
                return (
                  <li key={l.id}>
                    <LinkCard
                      link={l}
                      lines={[
                        `${[l.durationMin, ...l.durations].join(", ")} minutes with ${hosts.join(", ") || "nobody yet"}${hosts.length > 1 ? ", taking turns" : ""}`,
                        l.hours ? hoursSummary(l.hours) : "The hosts' availability",
                      ]}
                      onEdit={l.canEdit ? () => setEditing(l.id) : undefined}
                    />
                  </li>
                );
              })}
            </ul>
          )}
          {orgLinksAllowed && crmOn && (
            <p className="text-muted-foreground text-[13px]">
              Bookings on these links also add the guest to the CRM once they confirm their email.
            </p>
          )}
        </section>
      )}

      <section aria-labelledby="booked" className="space-y-3">
        <h2 id="booked" className="heading flex items-center gap-2 text-[17px]">
          Coming up {upcoming.length > 0 && <Badge variant="secondary">{upcoming.length}</Badge>}
        </h2>
        {upcoming.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="Nothing booked yet"
            description="Share your link. What people book goes straight onto your calendar and into your Inbox."
          />
        ) : (
          <BookingList
            items={upcoming.filter((b) => !b.needsHost || !isAdmin)}
            orgSlug={orgSlug}
            onCancel={setCancelling}
            onTake={take}
            isAdmin={isAdmin}
          />
        )}
      </section>

      {open && (
        <LinkDialog
          key={open.id}
          orgId={orgId}
          link={open}
          members={members}
          pipelines={pipelines}
          timeZones={timeZones}
          orgTimeZone={orgTimeZone}
          crmOn={crmOn}
          onOpenChange={(v) => !v && setEditing(null)}
        />
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent showCloseButton={false} className="gap-4 sm:max-w-lg">
          <DialogHead className="-me-2 -mt-2" title="New booking link">
            <DialogDescription className="sr-only">A booking link for the organization.</DialogDescription>
          </DialogHead>
          <div className="grid gap-1.5">
            <Label htmlFor="new-link-title">Name</Label>
            <Input
              id="new-link-title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. Coffee with the president"
              maxLength={120}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTitle.trim()) void create();
              }}
            />
            <p className="text-muted-foreground text-xs">You host it to start. Add hosts and hours next.</p>
          </div>
          <DialogFooter>
            <Button disabled={busy || !newTitle.trim()} onClick={create}>
              Create booking link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(cancelling)} onOpenChange={(v) => !v && setCancelling(null)}>
        <DialogContent showCloseButton={false} className="gap-4 sm:max-w-lg">
          <DialogHead className="-me-2 -mt-2" title={`Cancel with ${cancelling?.guestName ?? ""}?`}>
            <DialogDescription>
              It comes off the calendar and they get an email saying it&apos;s cancelled.
            </DialogDescription>
          </DialogHead>
          <div className="grid gap-1.5">
            <Label htmlFor="cancel-note">A note for them (optional)</Label>
            <Textarea id="cancel-note" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <DialogFooter className="flex items-center justify-between sm:justify-between">
            <Button variant="ghost" onClick={() => setCancelling(null)}>
              Keep it
            </Button>
            <Button variant="destructive" disabled={busy} onClick={cancel}>
              Cancel the meeting
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LinkCard({ link, lines, onEdit }: { link: BookingLinkState; lines: string[]; onEdit?: () => void }) {
  return (
    <div className="bg-card text-card-foreground edge rounded-card flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <span className="heading min-w-0 flex-1 truncate text-[15px]">{link.title}</span>
        {!link.active ? (
          <Badge variant="secondary">Off</Badge>
        ) : link.openSoon === 0 ? (
          <Badge variant="destructive">No open times</Badge>
        ) : (
          <Badge variant="success">Open</Badge>
        )}
        {onEdit && (
          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${link.title}`} title="Edit" onClick={onEdit}>
            <Pencil className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>
      <div className="text-muted-foreground space-y-0.5 text-sm">
        {lines.map((l) => (
          <p key={l}>{l}</p>
        ))}
        {link.active && link.openSoon === 0 && (
          <p className="text-tint-danger-foreground">Nobody can book it in the next two weeks. Check its hours.</p>
        )}
        <p>{link.booked === 1 ? "1 booked" : `${link.booked} booked`}</p>
      </div>
      <CopyLink url={link.url} />
    </div>
  );
}

function CopyLink({ url }: { url: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <code className="bg-muted min-w-0 flex-1 truncate rounded-lg px-2 py-1 text-xs">{url}</code>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Copy the link"
        title="Copy"
        onClick={async () => {
          await navigator.clipboard.writeText(url).catch(() => undefined);
          toast({ title: "Copied" });
        }}
      >
        <Copy className="size-4" aria-hidden="true" />
      </Button>
      <Button asChild variant="ghost" size="icon-sm" title="Open">
        <a href={url} target="_blank" rel="noreferrer" aria-label="Open">
          <ExternalLink className="size-4" aria-hidden="true" />
        </a>
      </Button>
    </div>
  );
}

function BookingList({
  items,
  orgSlug,
  onCancel,
  onTake,
  isAdmin,
}: {
  items: UpcomingBooking[];
  orgSlug: string;
  onCancel: (b: UpcomingBooking) => void;
  onTake: (b: UpcomingBooking) => void;
  isAdmin: boolean;
}) {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <ul className="bg-card edge rounded-card divide-border divide-y">
      {items.map((b) => (
        <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="min-w-0 flex-1">
            <Link href={`/app/${orgSlug}/meetings/${b.eventId}`} className="font-semibold underline-offset-4 hover:underline">
              {b.guestName}
            </Link>
            <p className="text-muted-foreground truncate text-[13px]">
              {fmt(b.startsAt)}, {b.linkTitle}
              {b.mine ? "" : `, with ${b.hostName}`}. {b.guestEmail}
            </p>
          </div>
          {!b.verified && <Badge variant="outline">Email not confirmed yet</Badge>}
          {b.needsHost && isAdmin && (
            <Button size="sm" onClick={() => onTake(b)}>
              Take it
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => onCancel(b)}>
            Cancel
          </Button>
        </li>
      ))}
    </ul>
  );
}
