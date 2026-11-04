"use client";

import {
  Banknote,
  Check,
  Copy,
  Hourglass,
  Printer,
  PowerOff,
  ScanLine,
  Ticket,
  Users,
} from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import {
  turnOffRsvpPage,
  turnOnRsvpPage,
} from "@/app/app/[orgSlug]/calendar/[eventId]/rsvp/actions";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/page-header";
import { BlockCard } from "@/components/ui/block-card";
import { Button } from "@/components/ui/button";
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
  /** Just made (?new=1): open on the page's settings with its link copied. */
  justCreated?: boolean;
  /** Its ambient buttons (a full event's Open a waitlist, Add seats), under the header. */
  ambient?: React.ReactNode;
}

export function RsvpManager(props: RsvpManagerProps) {
  const { orgId, event, page, guests, links } = props;
  const router = useRouter();
  const [tab, setTab] = useState<"guests" | "page">(
    props.initialTab ?? (props.justCreated ? "page" : "guests"),
  );
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);
  // A page made a moment ago opens on its settings, and its link is already
  // on the clipboard, ready to paste into the group chat.
  useEffect(() => {
    if (!props.justCreated || !page.url) return;
    navigator.clipboard?.writeText(page.url).then(
      () => toast({ title: "Link copied" }),
      () => undefined,
    );
    // Drop ?new=1, so a reload doesn't copy it again.
    router.replace(window.location.pathname, { scroll: false });
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      toast({ title: "Page is live" });
      router.refresh();
    });
  }

  /** Turns the page off at once, with Undo (the same link comes back on). */
  function turnOff() {
    start(async () => {
      const result = await turnOffRsvpPage(orgId, event.id);
      if (result.error) {
        toast({ title: result.error, tone: "error" });
        return;
      }
      router.refresh();
      toast({
        title: "Page off",
        action: {
          label: "Undo",
          run: async () => {
            const back = await turnOnRsvpPage(orgId, event.id);
            if (back.error) return back.error;
            router.refresh();
          },
        },
      });
    });
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
      title="Sign-ups"
      description={event.when}
      actions={
        page.enabled && page.url ? (
          <>
            <Button variant="outline" asChild>
              <Link href={links.door}>
                <ScanLine aria-hidden="true" />
                Door mode
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <a href={links.flyer} target="_blank" rel="noopener noreferrer">
                <Printer aria-hidden="true" />
                Flyer
              </a>
            </Button>
            <Button variant="ghost" onClick={turnOff} disabled={pending}>
              <PowerOff aria-hidden="true" />
              Turn off
            </Button>
          </>
        ) : null
      }
    />
  );

  return (
    <div className="mx-auto max-w-5xl space-y-7">
      <BackLink href={links.back.href} label={links.back.label} />
      {header}
      {props.ambient}

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
                  ? "Turn it back on and the same link works."
                  : "A public sign-up page with a map, waitlist, tickets and check-in."}
              </p>
              <Button onClick={turnOn} disabled={pending}>
                <Ticket aria-hidden="true" />
                {pending ? "Turning on…" : "Turn on"}
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
          <a
            href={page.url}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 flex-1 text-[15px] font-medium break-all underline-offset-4 hover:underline"
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
                title={going.length >= capacity ? "Full" : "Spots taken"}
                figure={`${going.length} of ${capacity}`}
                figureLabel={
                  page.settings.closed
                    ? "Sign-ups closed"
                    : event.ended
                      ? "Event ended"
                      : going.length >= capacity
                        ? page.settings.waitlist
                          ? "Waitlist open"
                          : "Registration closed"
                        : `${capacity - going.length} ${capacity - going.length === 1 ? "spot" : "spots"} left`
                }
                aside={<Gauge value={(going.length / capacity) * 100} size={132} />}
                className="min-h-0"
              />
            ) : null}
            <StatStrip className={cn(capacity && "md:pl-4")}>
              {!capacity && <Stat icon={Users} value={going.length} label="Going" />}
              {page.settings.waitlist && (
                <Stat icon={Hourglass} value={waiting} label="Waitlisted" />
              )}
              {props.owes !== null && (
                <Stat
                  icon={Banknote}
                  value={formatCents(collected)}
                  label={`${paidCount} of ${going.length} paid, ${formatCents(props.owes)} each`}
                />
              )}
              <Stat icon={ScanLine} value={checkedIn} label="Checked in" />
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
              { value: "page", label: "Page" },
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
