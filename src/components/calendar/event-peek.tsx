"use client";

import {
  ArrowUpRight,
  CalendarClock,
  CalendarX2,
  Globe,
  Lock,
  MapPin,
  Pencil,
  Ticket,
} from "@/components/icons";
import Link from "next/link";

import { RsvpButtons } from "@/components/meetings/rsvp-buttons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHead } from "@/components/ui/dialog";
import { PHONE_FULL_SCREEN } from "@/components/ui/form-dialog";
import { cn } from "@/lib/utils";

import { type CalendarItem, timeRange } from "./item";
import { itemStyle, KIND_META, RSVP_META, SYNC_META, VISIBILITY_META } from "./kinds";
import { shortDay } from "./day-label";

/**
 * Event detail, opened by clicking (or pressing Enter on) an event in the
 * Calendar: the same centred popup every other detail opens in, with the
 * shared header (DialogHead: the black Close in the corner, Edit and Open
 * the full page as round buttons under it). It opens on click, never on
 * hover: an admin drags chips between days, and a card under the pointer
 * mid-drag is in the way.
 *
 * It answers "what is this" and lets you answer the invitation. The full
 * page (/meetings/<id>) stays for attendees, notes, the sync error and
 * delete, and for links from elsewhere.
 */
export function EventPeek({
  orgId,
  item,
  orgSlug,
  canManage,
  showSync,
  onClose,
  onEdit,
}: {
  /** For answering an invitation right here. */
  orgId?: string;
  item: CalendarItem;
  orgSlug: string;
  canManage: boolean;
  showSync: boolean;
  onClose: () => void;
  onEdit: (item: CalendarItem) => void;
}) {
  const kind = KIND_META[item.kind];
  const visibility = VISIBILITY_META[item.visibility];
  const VisIcon = item.visibility === "PUBLIC" ? Globe : Lock;
  const dayKey = item.allDay ? item.start : localKey(new Date(item.start));
  // An invitee answers here, until it's over; tasks have no invitation.
  const canAnswer = Boolean(item.rsvp) && !item.task && new Date(item.end) > new Date();
  const when = `${shortDay(dayKey)}, ${item.allDay ? "All day" : timeRange(item)}`;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        className={cn("flex flex-col gap-0 overflow-hidden p-0 sm:max-w-[480px]", PHONE_FULL_SCREEN)}
      >
        <DialogHead
          className="shrink-0 ps-6 pe-4 pt-4 pb-3"
          title={item.title}
          titleClassName="display-title text-[24px] leading-tight break-words"
          subtitle={<DialogDescription className="text-foreground font-medium">{when}</DialogDescription>}
          onClose={onClose}
          actions={
            <>
              {canManage && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => onEdit(item)}
                  aria-label={`Edit ${item.title}`}
                  title="Edit"
                >
                  <Pencil aria-hidden className="size-4" />
                </Button>
              )}
              <Button variant="outline" size="icon" asChild>
                <Link
                  href={`/app/${orgSlug}/meetings/${item.id}`}
                  aria-label="Open the full page"
                  title="Open the full page: who's coming, notes, delete"
                >
                  <ArrowUpRight aria-hidden className="size-4" />
                </Link>
              </Button>
            </>
          }
        />
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 pt-1 pb-6">
          {item.location && (
            <p className="text-muted-foreground flex items-start gap-1.5 text-sm">
              <MapPin aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span className="break-words">{item.location}</span>
            </p>
          )}

          <div className="flex flex-wrap gap-1.5">
            {/* Its type, beside the other facts (not a label above the title). */}
            <Badge variant="outline">
              <span aria-hidden className="cal-chip__dot" style={itemStyle(item)} />
              {item.meetingType || kind.label}
            </Badge>
            {/* Internal is the default; only Public is worth saying. */}
            {item.visibility === "PUBLIC" && (
              <Badge variant="secondary" title={visibility.hint}>
                <VisIcon aria-hidden className="size-3" />
                {visibility.label}
              </Badge>
            )}
            {item.rsvp && !(orgId && canAnswer) && (
              <Badge
                variant={item.rsvp === "YES" ? "success" : item.rsvp === "NO" ? "outline" : "secondary"}
              >
                <Ticket aria-hidden className="size-3" />
                {RSVP_META[item.rsvp].label}
              </Badge>
            )}
            {showSync && item.syncState === "PENDING" && (
              <Badge variant="outline" title={SYNC_META.PENDING.hint}>
                <CalendarClock aria-hidden className="size-3" />
                {SYNC_META.PENDING.label}
              </Badge>
            )}
            {showSync && item.syncState === "FAILED" && (
              <Badge variant="destructive" title={SYNC_META.FAILED.hint}>
                <CalendarX2 aria-hidden className="size-3" />
                {SYNC_META.FAILED.label}
              </Badge>
            )}
          </div>

          {orgId && canAnswer && (
            <RsvpButtons
              orgId={orgId}
              eventId={item.id}
              title={item.title}
              value={item.rsvp === "PENDING" ? null : (item.rsvp ?? null)}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function localKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
