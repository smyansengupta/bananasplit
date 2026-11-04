"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { saveBookingLinkAction } from "@/app/app/[orgSlug]/meetings/booking/actions";
import { AmbientButton, type AmbientAction } from "@/components/ambient/ambient-button";
import { Ellipsis, Users } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toaster";
import { runAction } from "@/lib/run-action";
import type { BookingLinkState } from "@/server/booking/view";

import { CopyButton } from "./copy-button";

/**
 * What a link offers, wherever it's drawn. Exactly one thing shows: Copy link,
 * or in its place the ambient button when something needs doing first (what
 * shows comes from the page: linkAmbient, src/lib/ambient/booking.ts). The
 * rest (Open, Edit, Turn off) waits in one quiet menu.
 */

export function LinkAction({
  orgId,
  link,
  name,
  onEdit,
}: {
  orgId: string;
  link: BookingLinkState;
  /** What the button is about, for screen readers ("your meeting link"). */
  name: string;
  onEdit: () => void;
}) {
  const need = link.ambient[0];
  if (!need) return link.active ? <CopyButton url={link.url} title={name} /> : null;
  const action: AmbientAction =
    need.kind === "add-host"
      ? { key: need.kind, label: "Add a host", icon: Users, tone: "spark", reason: need.reason, open: onEdit }
      : {
          key: need.kind,
          label: "Turn it on",
          tone: "solid",
          reason: need.reason,
          ariaLabel: `Turn on ${name}`,
          run: () => saveBookingLinkAction(orgId, link.id, { active: true }),
        };
  return <AmbientButton key={action.key} action={action} className="relative z-10" />;
}

export function LinkMenu({
  orgId,
  link,
  name,
  onEdit,
  className,
  children,
}: {
  orgId: string;
  link: BookingLinkState;
  name: string;
  onEdit: () => void;
  className?: string;
  /** More items for the end of the menu. */
  children?: ReactNode;
}) {
  const router = useRouter();
  if (!link.active && !link.canEdit && !children) return null;
  const turnOff = async () => {
    const r = await runAction(() => saveBookingLinkAction(orgId, link.id, { active: false }));
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    router.refresh();
  };
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className={className} aria-label={`More for ${name}`} title="More">
          <Ellipsis className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {link.active && (
          <DropdownMenuItem asChild>
            <a href={link.url} target="_blank" rel="noreferrer">
              Open
            </a>
          </DropdownMenuItem>
        )}
        {link.canEdit && <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>}
        {link.canEdit && link.active && <DropdownMenuItem onSelect={() => void turnOff()}>Turn off</DropdownMenuItem>}
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
