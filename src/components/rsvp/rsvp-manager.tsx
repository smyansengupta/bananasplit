"use client";

import {
  Banknote,
  Check,
  Copy,
  ExternalLink,
  Hourglass,
  Printer,
  PowerOff,
  ScanLine,
  Ticket,
  Users,
} from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  turnOffRsvpPage,
  turnOnRsvpPage,
} from "@/app/app/[orgSlug]/calendar/[eventId]/rsvp/actions";
import { BackLink } from "@/components/back-link";
import { ItemMenu } from "@/components/item-menu";
import { PageHeader } from "@/components/page-header";
import { BlockCard } from "@/components/ui/block-card";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Gauge } from "@/components/ui/meters";
import { Segmented } from "@/components/ui/segmented";
import { IconChip, Stat, StatStrip } from "@/components/ui/stat";
import { toast } from "@/components/ui/toaster";
import type { RsvpCover } from "@/lib/rsvp/cover";
import { formatCents } from "@/lib/rsvp/pay";
import { cn } from "@/lib/utils";

import type { BringLine } from "./bring-list-editor";
import { PagePreview } from "./page-preview";
import { RsvpGuests, type RsvpGuest } from "./rsvp-guests";
import { RsvpSettings, type RsvpSettingsValue } from "./rsvp-settings";

/**
 * An event's RSVP page (Calendar > RSVP pages in a club): its link,
 * the numbers, and two tabs, Guests (the list, check-in, payments, moving
 * people) and Page (how it looks, what it costs, the bring list, what it
 * shows). Before the page is on, one card explains it and turns it on.
 */

export interface RsvpManagerLinks {
  back: { href: string; label: string };
  /** Where the event's title, time and place are edited. */
  edit: string;
  door: string;
  flyer: string;
}

export interface RsvpManagerProps {
  orgId: string;
  event: { id: string; title: string; when: string; location: string | null; ended: boolean };
  page: {
    enabled: boolean;
    url: string | null;
    cover: RsvpCover | null;
    settings: RsvpSettingsValue;
  };
  guests: RsvpGuest[];
  items: BringLine[];
  /** Split the cost: one guest's share now, or null when it's free. */
  owes: number | null;
  messaging: { email: "org" | "platform"; texts: boolean };
  links: RsvpManagerLinks;
  initialTab?: "guests" | "page";
}

export function RsvpManager(props: RsvpManagerProps) {
  const { orgId, event, page, guests, links } = props;
  const router = useRouter();
  const [tab, setTab] = useState<"guests" | "page">(props.initialTab ?? "guests");
  const [pending, start] = useTransition();
  const [confirmEl, confirm] = useConfirm();
  const [copied, setCopied] = useState(false);

  const going = guests.filter((g) => g.status === "GOING");
  const waiting = guests.filter((g) => g.status === "WAITLIST").length;
  const checkedIn = going.filter((g) => g.checkedIn).length;
  const capacity = page.settings.capacity;
  const collected = going
    .filter((g) => g.paid.confirmed)
    .reduce((sum, g) => sum + (g.paid.cents ?? props.owes ?? 0), 0);
  const paidCount = going.filter((g) => g.paid.confirmed).length;

  function turnOn() {
    start(async () => {
      const result = await turnOnRsvpPage(orgId, event.id);
      if (result.error) {
        toast({ title: "Couldn't turn on the page", description: result.error });
        return;
      }
      toast({
        title: "Your RSVP page is live",
        description: "Share the link to start taking sign-ups.",
      });
      router.refresh();
    });
  }

  async function turnOff() {
    const ok = await confirm({
      title: "Turn off the RSVP page?",
      description:
        "The link stops working and nobody new can sign up. Everyone already signed up stays on the list, and turning it back on brings the same link back.",
      confirmLabel: "Turn off",
      run: async () => (await turnOffRsvpPage(orgId, event.id)).error,
    });
    if (ok) router.refresh();
  }

  async function copyLink() {
    if (!page.url) return;
    try {
      await navigator.clipboard.writeText(page.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Couldn't copy", description: page.url });
    }
  }

  const header = (
    <PageHeader
      title="RSVP page"
      description={`${event.title} · ${event.when}`}
      actions={
        page.enabled && page.url ? (
          <>
            <Button variant="outline" asChild>
              <Link href={links.door}>
                <ScanLine aria-hidden="true" />
                Check in guests
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <a href={page.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden="true" />
                Open page
              </a>
            </Button>
            <ItemMenu
              label="More RSVP page actions"
              items={[
                {
                  label: "Print a flyer",
                  icon: Printer,
                  onSelect: () => window.open(links.flyer, "_blank", "noopener"),
                },
                {
                  label: "Turn off the page",
                  icon: PowerOff,
                  onSelect: () => void turnOff(),
                  destructive: true,
                  separated: true,
                },
              ]}
            />
          </>
        ) : null
      }
    />
  );

  return (
    <div className="mx-auto max-w-5xl space-y-7">
      {confirmEl}
      <BackLink href={links.back.href} label={links.back.label} />
      {header}

      {!page.enabled && (
        <section className="bg-card text-card-foreground ring-foreground/6 edge rounded-card overflow-hidden ring-1">
          <div className="grid gap-6 p-6 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-center">
            <div className="space-y-3">
              <IconChip icon={Ticket} size="md" />
              <h2 className="display-title text-[23px]">
                {page.url ? "This RSVP page is off" : "Let anyone sign up with a link"}
              </h2>
              <p className="text-muted-foreground max-w-prose text-sm leading-relaxed">
                {page.url
                  ? "Turn it back on and the same link works again. Everyone who signed up is still on the list below."
                  : "A public page for this event: the time and place with a map, who's hosting and who's going, and a sign-up form. Split the cost, hand out a bring list, give every guest an invite link and a QR ticket, and check them in at the door."}
              </p>
              <Button onClick={turnOn} disabled={pending}>
                <Ticket aria-hidden="true" />
                {pending
                  ? "Turning on…"
                  : page.url
                    ? "Turn the page back on"
                    : "Turn on the RSVP page"}
              </Button>
            </div>
            <PagePreview
              cover={page.cover}
              background={page.settings.background}
              title={event.title}
            />
          </div>
        </section>
      )}

      {page.enabled && page.url && (
        <div className="bg-card text-card-foreground ring-foreground/6 edge flex flex-wrap items-center gap-3 rounded-full py-1.5 ps-5 pe-1.5 ring-1">
          <span className="text-muted-foreground text-[13px] font-medium">Link</span>
          <a
            href={page.url}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 flex-1 truncate text-[15px] font-medium underline-offset-4 hover:underline"
          >
            {page.url.replace(/^https?:\/\//, "")}
          </a>
          <Button variant="secondary" size="sm" onClick={() => void copyLink()}>
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      )}

      {(page.enabled || guests.length > 0) && (
        <>
          <div
            className={cn(
              "grid gap-[18px]",
              capacity && "md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] md:items-center",
            )}
          >
            {capacity ? (
              <BlockCard
                tone="goal"
                kicker={
                  page.settings.closed
                    ? "Sign-ups closed"
                    : event.ended
                      ? "Event ended"
                      : "Taking sign-ups"
                }
                title={going.length >= capacity ? "Full" : "Spots taken"}
                figure={`${going.length} of ${capacity}`}
                figureLabel={
                  going.length >= capacity
                    ? page.settings.waitlist
                      ? "New sign-ups join the waitlist"
                      : "Registration is closed"
                    : `${capacity - going.length} ${capacity - going.length === 1 ? "spot" : "spots"} left`
                }
                aside={<Gauge value={(going.length / capacity) * 100} size={132} />}
                className="min-h-0"
              />
            ) : null}
            <StatStrip className={cn(capacity && "md:pl-4")}>
              <Stat
                icon={Users}
                value={going.length}
                label={capacity ? "Going" : "Going · no limit"}
              />
              <Stat
                icon={Hourglass}
                value={waiting}
                label={page.settings.waitlist ? "On the waitlist" : "Waitlist off"}
              />
              {props.owes !== null && (
                <Stat
                  icon={Banknote}
                  value={formatCents(collected)}
                  label={`${paidCount} of ${going.length} paid · ${formatCents(props.owes)} each`}
                />
              )}
              <Stat
                icon={ScanLine}
                value={checkedIn}
                label={going.length ? `Checked in of ${going.length}` : "Checked in"}
              />
            </StatStrip>
          </div>

          <Segmented
            label="RSVP page sections"
            value={tab}
            onSelect={(v) => setTab(v as "guests" | "page")}
            options={[
              {
                value: "guests",
                label: `Guests (${guests.filter((g) => g.status !== "CANCELLED").length})`,
              },
              { value: "page", label: "Page settings" },
            ]}
          />

          {tab === "guests" ? (
            <RsvpGuests
              orgId={orgId}
              eventId={event.id}
              eventTitle={event.title}
              guests={guests}
              canAdd={page.enabled}
              shareUrl={page.url}
              owes={props.owes}
            />
          ) : (
            <RsvpSettings
              orgId={orgId}
              eventId={event.id}
              title={event.title}
              location={event.location}
              cover={page.cover}
              initial={page.settings}
              messaging={props.messaging}
              editHref={links.edit}
              going={going.length}
              items={props.items}
            />
          )}
        </>
      )}
    </div>
  );
}
