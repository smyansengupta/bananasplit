"use client";

import { Plus } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog, FormDialogBody, FormDialogFoot, FormDialogHead } from "@/components/ui/form-dialog";
import type { BookingLinkState } from "@/server/booking/view";

import { LinkAction, LinkMenu } from "./link-ambient";

/** Who a shared link goes to, in a few words. */
function whoLine(names: readonly string[]): string {
  if (names.length === 0) return "Nobody hosts it yet";
  if (names.length === 1) return `Goes to ${names[0]}`;
  if (names.length > 3) return `Goes to ${names.length} people, taking turns`;
  return `Goes to ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}, taking turns`;
}

/**
 * The organization's other links ("Coffee with the president"), one window
 * behind the strip's quiet "2 more links", with New link at its foot. Each
 * row follows the same rule as the rest of the page: one action, the rest in
 * its menu.
 */
export function OtherLinks({
  orgId,
  links,
  hostNames,
  canMake,
  open,
  onOpenChange,
  onEdit,
  onNew,
}: {
  orgId: string;
  links: readonly BookingLinkState[];
  hostNames: (link: BookingLinkState) => string[];
  canMake: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} className="sm:max-w-xl">
      <FormDialogHead title="More links" description="Shared links anyone here can send." />
      <FormDialogBody>
        <ul className="divide-border/70 divide-y">
          {links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
              <div className="flex min-w-0 flex-[1_1_14rem] flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 text-sm font-semibold break-words">{l.title}</span>
                  {!l.active && <Badge variant="secondary">Off</Badge>}
                </span>
                <span className="text-muted-foreground text-[13px]">
                  {whoLine(hostNames(l))}. {l.lengths}.
                </span>
              </div>
              <div className="flex items-center gap-2">
                <LinkAction orgId={orgId} link={l} name={l.title} onEdit={() => onEdit(l.id)} />
                <LinkMenu orgId={orgId} link={l} name={l.title} onEdit={() => onEdit(l.id)} />
              </div>
            </li>
          ))}
        </ul>
      </FormDialogBody>
      <FormDialogFoot>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Close
        </Button>
        {canMake && (
          <Button onClick={onNew}>
            <Plus aria-hidden="true" />
            New link
          </Button>
        )}
      </FormDialogFoot>
    </FormDialog>
  );
}
