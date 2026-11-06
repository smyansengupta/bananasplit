"use client";

import { useState } from "react";

import { askToTurnOnAction } from "@/app/app/[orgSlug]/meetings/booking/actions";
import { AmbientButton } from "@/components/ambient/ambient-button";
import { Search, Send } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import type { BookingLinkState, BookingPerson } from "@/server/booking/view";

import { CopyButton } from "./copy-button";
import { LinkAction, LinkMenu } from "./link-ambient";
import { WeekBars } from "./week-bars";

/**
 * Everyone's links, three to a row (two on a tablet, one on a phone; the
 * grid goes by its own width, since the sidebar takes some of the page).
 * Each card is a person: their face, their week as a picture, and one
 * action. A click anywhere on a card opens that link's page; Copy link is the
 * button. Yours comes first, with the rest in its menu. Someone who hasn't
 * turned theirs on stays in the grid, quietly, with Ask them in Copy link's
 * place.
 *
 * Past nine people, the links that are on lead, the rest wait behind Show
 * everyone, and a search field finds anyone.
 */

/** How many people show before Show everyone. */
export const GRID_LIMIT = 9;

export const CARD_GRID = "grid grid-cols-1 gap-4.5 @xl:grid-cols-2 @3xl:grid-cols-3";

export function PeopleGrid({
  orgId,
  people,
  mine,
  onEditMine,
}: {
  orgId: string;
  people: readonly BookingPerson[];
  mine: BookingLinkState;
  onEditMine: () => void;
}) {
  const [everyone, setEveryone] = useState(false);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const many = people.length > GRID_LIMIT;
  const found = q
    ? people.filter((p) => `${p.name} ${p.title ?? ""}`.toLowerCase().includes(q))
    : people;
  const shown = q || everyone ? found : found.slice(0, GRID_LIMIT);
  return (
    <section aria-labelledby="everyones-links" className="@container space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="everyones-links" className="heading flex-1 text-[17px]">
          Everyone&apos;s links
        </h2>
        {many && (
          <span className="relative w-full sm:w-60">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              type="search"
              aria-label="Find someone"
              placeholder="Find someone"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 ps-9"
            />
          </span>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nobody here by that name.</p>
      ) : (
        <ul className={CARD_GRID}>
          {shown.map((p) => (
            <li key={p.id}>
              {p.me ? (
                <YourCard orgId={orgId} person={p} link={mine} onEdit={onEditMine} />
              ) : (
                <TheirCard orgId={orgId} person={p} />
              )}
            </li>
          ))}
        </ul>
      )}
      {many && !q && !everyone && (
        <Button variant="ghost" size="sm" onClick={() => setEveryone(true)}>
          Show everyone ({people.length})
        </Button>
      )}
    </section>
  );
}

/** Their face and name. With `href` the name is the card's one link, stretched over all of it. */
function Who({
  person,
  href,
  label,
  quiet = false,
}: {
  person: BookingPerson;
  href?: string;
  label?: string;
  quiet?: boolean;
}) {
  const name = "display-title text-[17px] leading-snug break-words";
  return (
    <>
      <UserAvatar user={person} size="xl" className={cn("shrink-0", quiet && "opacity-60 saturate-50")} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 self-center">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            aria-label={label}
            data-card-link=""
            className={cn(
              name,
              "underline-offset-4 group-hover:underline after:absolute after:inset-0 focus-visible:outline-none",
            )}
          >
            {person.name}
          </a>
        ) : (
          <span className={name}>{person.name}</span>
        )}
        {person.title && <span className="text-muted-foreground text-[13px] break-words">{person.title}</span>}
      </span>
    </>
  );
}

const CARD = "bg-card text-card-foreground edge rounded-card flex h-full flex-col gap-4 p-5";
/** A card you can click: the shadow and the focus ring follow the name's link. */
const OPENS =
  "group hover:shadow-e2 has-[[data-card-link]:focus-visible]:outline-foreground relative transition-shadow duration-200 has-[[data-card-link]:focus-visible]:outline-2 has-[[data-card-link]:focus-visible]:outline-offset-2";
/** The one action, at the foot of a card. */
const FOOT = "border-border/70 mt-auto flex border-t pt-4";

/** "Next free Tomorrow 9 AM", or the hours in a few words when that isn't known. */
function Availability({ line, nextOpen }: { line: string; nextOpen: string | null }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
      <span className="text-muted-foreground">{line}</span>
      {nextOpen && (
        <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap">
          Next free {nextOpen}
        </span>
      )}
    </span>
  );
}

function YourCard({
  orgId,
  person,
  link,
  onEdit,
}: {
  orgId: string;
  person: BookingPerson;
  link: BookingLinkState;
  onEdit: () => void;
}) {
  return (
    <div className={cn(CARD, link.active && OPENS)}>
      <div className="flex min-w-0 items-start gap-3.5">
        <Who person={person} href={link.active ? link.url : undefined} label="Open your meeting link" />
        <LinkMenu
          orgId={orgId}
          link={link}
          name="your meeting link"
          onEdit={onEdit}
          className="relative z-10 -me-1.5 -mt-1"
        />
      </div>
      <WeekBars days={link.week} label={`Your week: ${link.hoursLine}`} className={cn(!link.active && "opacity-50")} />
      <span className="flex flex-wrap items-center gap-2">
        {!link.active ? (
          <Badge variant="secondary">Yours is off</Badge>
        ) : (
          link.openSoon === 0 && <Badge variant="destructive">No open times</Badge>
        )}
        <Availability line={link.hoursLine} nextOpen={link.active ? link.nextOpen : null} />
      </span>
      <div className={FOOT}>
        <LinkAction orgId={orgId} link={link} name="your meeting link" onEdit={onEdit} />
      </div>
    </div>
  );
}

function TheirCard({ orgId, person }: { orgId: string; person: BookingPerson }) {
  const first = person.name.trim().split(/\s+/)[0] || "them";
  const { link } = person;
  if (!link) {
    return (
      <div className={cn(CARD, "bg-card/60")}>
        <div className="flex min-w-0 items-start gap-3.5">
          <Who person={person} quiet />
        </div>
        <WeekBars days={null} />
        <span className="text-muted-foreground text-[13px]">Hasn&apos;t turned theirs on</span>
        {!person.asked && (
          <div className={FOOT}>
            <AmbientButton
              action={{
                key: "ask",
                label: "Ask them",
                icon: Send,
                reason: `Nobody can book ${first} until it's on`,
                ariaLabel: `Ask ${person.name} to turn their link on`,
                run: () => askToTurnOnAction(orgId, person.id),
                done: `Asked ${first}`,
              }}
            />
          </div>
        )}
      </div>
    );
  }
  return (
    <div className={cn(CARD, OPENS)}>
      <div className="flex min-w-0 items-start gap-3.5">
        <Who person={person} href={link.url} label={`Open ${person.name}'s meeting link`} />
      </div>
      <WeekBars days={link.week} label={`${person.name}'s week: ${link.hoursLine}`} />
      <span className="flex flex-wrap items-center gap-2">
        {link.openSoon === 0 && <Badge variant="destructive">No open times</Badge>}
        <Availability line={link.hoursLine} nextOpen={link.nextOpen} />
      </span>
      <div className={FOOT}>
        <CopyButton url={link.url} title={`${person.name}'s meeting link`} />
      </div>
    </div>
  );
}
