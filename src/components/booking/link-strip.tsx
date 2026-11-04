"use client";

import { useState, type ReactNode } from "react";

import { AmbientButton } from "@/components/ambient/ambient-button";
import { Pencil, Plus } from "@/components/icons";
import { CopyLinkButton } from "@/components/meetings/copy-link-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserAvatar, type UserAvatarUser } from "@/components/user-avatar";
import type { BookingLinkState } from "@/server/booking/view";

import { LinkAmbient } from "./link-ambient";

/**
 * A booking link as a strip across the top of the page, the shape and weight
 * of Video calls on Meetings: who it goes to, its name, its hours in a few
 * words, and the buttons at the right. `children` is anything that belongs
 * under it inside the strip (the Personal page's week).
 */

const STRIP =
  "bg-card text-card-foreground edge rounded-card flex flex-wrap items-center gap-x-4 gap-y-3 px-4.5 py-3";

type Face = UserAvatarUser & { id: string };

/** The most faces a strip shows before it counts the rest. */
const FACES = 4;

function Faces({ people }: { people: readonly Face[] }) {
  const extra = people.length - FACES;
  return (
    <span className="flex shrink-0 items-center">
      {people.slice(0, FACES).map((p) => (
        <UserAvatar key={p.id} user={p} size="lg" className="ring-card -me-2 ring-2 last:me-0" />
      ))}
      {extra > 0 && (
        <span className="text-muted-foreground ps-3.5 text-[13px] font-medium tabular-nums">+{extra}</span>
      )}
    </span>
  );
}

/** Who a shared link goes to, in a few words. */
function whoLine(names: readonly string[]): string {
  if (names.length === 0) return "Nobody hosts it yet";
  if (names.length === 1) return `Goes to ${names[0]}`;
  if (names.length > 3) return `Goes to ${names.length} people, taking turns`;
  return `Goes to ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}, taking turns`;
}

export function LinkStrip({
  orgId,
  link,
  hosts,
  onEdit,
  children,
}: {
  orgId: string;
  link: BookingLinkState;
  hosts: readonly (Face & { name: string })[];
  onEdit: () => void;
  children?: ReactNode;
}) {
  const facts = [
    ...(link.personal ? [] : [whoLine(hosts.map((h) => h.name))]),
    link.lengths,
    link.hoursLine,
  ];
  return (
    <section aria-label={link.title} className={STRIP}>
      {hosts.length > 0 && <Faces people={hosts} />}
      <div className="flex min-w-48 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 text-sm font-semibold break-words">{link.title}</span>
          {!link.active ? (
            <Badge variant="secondary">Off</Badge>
          ) : (
            link.openSoon === 0 && <Badge variant="destructive">No open times</Badge>
          )}
        </span>
        <span className="text-muted-foreground text-[13px]">{facts.join(". ")}.</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <LinkAmbient orgId={orgId} link={link} onEdit={onEdit} className="items-start sm:items-end" />
        <div className="flex items-center gap-2">
          {link.active && <CopyLinkButton url={link.url} title={link.title} />}
          {link.canEdit && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Edit ${link.title}`}
              title="Edit"
              onClick={onEdit}
            >
              <Pencil className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
      {children && <div className="border-border/70 basis-full border-t pt-3.5 pb-1">{children}</div>}
    </section>
  );
}

/** No organization link yet: the strip's place offers to make one, right here. */
export function MakeOrgLinkStrip({
  orgName,
  onMake,
}: {
  orgName: string;
  /** Makes it, then opens its editor. */
  onMake: (title: string) => Promise<{ error?: string } | undefined>;
}) {
  const [title, setTitle] = useState(`Meet ${orgName}`.slice(0, 120));
  return (
    <section aria-label="Organization booking link" className={STRIP}>
      <div className="flex min-w-48 flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold">Organization booking link</span>
        <span className="text-muted-foreground text-[13px]">
          One link for the whole organization. You pick who it goes to.
        </span>
      </div>
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        <Input
          aria-label="Name of the link"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          className="h-8 min-w-0 flex-1 sm:w-56 sm:flex-none"
        />
        <AmbientButton
          action={{
            key: "make",
            label: "Make it",
            icon: Plus,
            tone: "solid",
            reason: "No organization link yet",
            run: () => onMake(title),
          }}
        />
      </div>
    </section>
  );
}
