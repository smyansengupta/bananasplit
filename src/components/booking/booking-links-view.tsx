"use client";

import { Plus } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  cancelBookingByHostAction,
  createOrgLinkAction,
} from "@/app/app/[orgSlug]/meetings/booking/actions";
import { Button } from "@/components/ui/button";
import {
  FormDialog,
  FormDialogBody,
  FormDialogFoot,
  FormDialogHead,
  FormField,
} from "@/components/ui/form-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { safeTimeZone } from "@/lib/calendar/dates";
import { runAction } from "@/lib/run-action";
import type {
  BookingLinkState,
  BookingMember,
  BookingPerson,
  BookingRow,
} from "@/server/booking/view";

import { ComingUp } from "./coming-up";
import { LinkDialog } from "./link-dialog";
import { LinkStrip, MakeOrgLinkStrip } from "./link-strip";
import { PeopleGrid } from "./people-grid";
import { WeekBars } from "./week-bars";

/** How many organization links show as strips before More links. */
const STRIPS = 2;

/**
 * Meetings > Booking links. Two different pages (docs/features/booking.md):
 *
 * An organization: its link as a strip across the top (the shape of Video
 * calls on Meetings), everyone's own links under it three to a row, then
 * what's booked. A Personal space: your link as the strip, your week as a
 * picture inside it, then what's booked.
 *
 * Each link opens its editor as the app's centered dialog (LinkDialog, the
 * New event dialog's look).
 */
export function BookingLinksView({
  orgId,
  orgSlug,
  orgName,
  personalSpace,
  orgLinksAllowed,
  crmOn,
  isAdmin,
  mine,
  orgLinks,
  people,
  upcoming,
  members,
  pipelines,
  timeZones,
  orgTimeZone,
  openOnArrival,
}: {
  orgId: string;
  orgSlug: string;
  orgName: string;
  personalSpace: boolean;
  orgLinksAllowed: boolean;
  crmOn: boolean;
  isAdmin: boolean;
  mine: BookingLinkState;
  orgLinks: BookingLinkState[];
  people: BookingPerson[];
  upcoming: BookingRow[];
  members: BookingMember[];
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
  const [more, setMore] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [cancelling, setCancelling] = useState<BookingRow | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const open = all.find((l) => l.id === editing) ?? null;
  const memberOf = new Map(members.map((m) => [m.id, m]));
  const hostsOf = (l: BookingLinkState) =>
    l.hostIds.flatMap((id) => {
      const m = memberOf.get(id);
      return m ? [m] : [];
    });

  /** Makes an organization link and opens its editor. */
  const make = async (title: string) => {
    const r = await runAction(() => createOrgLinkAction(orgId, title));
    if (!r) return undefined;
    if (!r.ok) return { error: r.error };
    router.refresh();
    setEditing(r.id);
    return {};
  };
  const create = async () => {
    setBusy(true);
    const r = await make(newTitle);
    setBusy(false);
    if (!r) return;
    if (r.error) return toast({ title: r.error, tone: "error" });
    setCreating(false);
    setNewTitle("");
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

  const strips = more ? orgLinks : orgLinks.slice(0, STRIPS);
  const hidden = orgLinks.length - strips.length;
  return (
    <div className="space-y-7.5">
      {personalSpace ? (
        <LinkStrip orgId={orgId} link={mine} hosts={hostsOf(mine)} onEdit={() => setEditing(mine.id)}>
          <WeekBars days={mine.week} label={`Your week: ${mine.hoursLine}`} large />
        </LinkStrip>
      ) : orgLinksAllowed ? (
        <div className="space-y-2.5">
          {orgLinks.length === 0 ? (
            <MakeOrgLinkStrip orgName={orgName} onMake={make} />
          ) : (
            <>
              {strips.map((l) => (
                <LinkStrip
                  key={l.id}
                  orgId={orgId}
                  link={l}
                  hosts={hostsOf(l)}
                  onEdit={() => setEditing(l.id)}
                />
              ))}
              <div className="flex flex-wrap items-center gap-1">
                {hidden > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setMore(true)}>
                    More links ({hidden})
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setCreating(true)}>
                  <Plus aria-hidden="true" />
                  New link
                </Button>
              </div>
            </>
          )}
        </div>
      ) : (
        isAdmin && (
          <p className="text-muted-foreground text-[13px]">
            One shared link for the whole organization comes with the CRM.{" "}
            <Link
              href={`/app/${orgSlug}/integrations/crm`}
              className="text-foreground underline underline-offset-2"
            >
              Add the CRM
            </Link>
          </p>
        )
      )}

      {!personalSpace && (
        <PeopleGrid
          orgId={orgId}
          people={people}
          mine={mine}
          onEditMine={() => setEditing(mine.id)}
        />
      )}

      <ComingUp
        orgId={orgId}
        orgSlug={orgSlug}
        items={upcoming}
        timeZone={safeTimeZone(orgTimeZone)}
        onCancel={setCancelling}
      />

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

      {/* New task's window, sized down to the one field; the whole screen on a phone. */}
      <FormDialog open={creating} onOpenChange={setCreating} className="sm:max-w-lg">
        <FormDialogHead
          title="New booking link"
          description="You host it to start. Add hosts and hours next."
        />
        <FormDialogBody>
          <FormField label="Name" htmlFor="new-link-title">
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
          </FormField>
        </FormDialogBody>
        <FormDialogFoot>
          <Button variant="outline" onClick={() => setCreating(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !newTitle.trim()} onClick={create}>
            Create booking link
          </Button>
        </FormDialogFoot>
      </FormDialog>

      <FormDialog
        open={Boolean(cancelling)}
        onOpenChange={(v) => !v && setCancelling(null)}
        className="sm:max-w-lg"
      >
        <FormDialogHead
          title={`Cancel with ${cancelling?.guestName ?? ""}?`}
          description="It comes off the calendar and they get an email saying it's cancelled."
        />
        <FormDialogBody>
          <FormField label="A note for them (optional)" htmlFor="cancel-note">
            <Textarea
              id="cancel-note"
              rows={3}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </FormField>
        </FormDialogBody>
        <FormDialogFoot>
          <Button variant="outline" onClick={() => setCancelling(null)}>
            Keep it
          </Button>
          <Button variant="destructive" disabled={busy} onClick={cancel}>
            Cancel the meeting
          </Button>
        </FormDialogFoot>
      </FormDialog>
    </div>
  );
}
